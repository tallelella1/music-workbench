import { afterEach, expect, test, vi } from 'vitest'
import { SearchService } from '../../src/main/search/search-service'
import { ProviderRegistry } from '../../src/main/providers/registry'
import { makeTrack } from '../helpers/fixtures'
import type { SearchSnapshot } from '../../src/shared/providers'
import { createIpcRouter } from '../../src/main/ipc'
import { TaskService } from '../../src/main/jobs/task-service'
import { requestJson, hostSearchFetch } from '../../src/main/providers/search-common'

const query = { text: '周杰伦', page: 1, pageSize: 20, authRevision: '0' }
const ctx = (requestId = 'r1', signal = new AbortController().signal) => ({ requestId, signal })
const page = (id = 'wy:fixture-track') => ({ tracks: [makeTrack({ id, title: '晴天', version: 'unknown' })], total: 21, nextPage: 2 })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

test('cancelled searches wait for owned transport cleanup without waiting for arbitrary provider promises', async () => {
  const registry = new ProviderRegistry(); const abort = new AbortController()
  let entered!: () => void; const started = new Promise<void>(done => { entered = done })
  let cleaned!: () => void; const cleanup = new Promise<void>(done => { cleaned = done })
  const fetcher: typeof fetch = async (_url, init) => {
    entered()
    return new Promise((_done, fail) => init!.signal!.addEventListener('abort', () => {
      void cleanup.then(() => fail(init!.signal!.reason))
    }, { once: true }))
  }
  vi.stubGlobal('fetch', fetcher)
  registry.registerSearch({ id: 'wy', search: async (_query, ctx) => { await requestJson(hostSearchFetch, 'https://fixture.invalid/search', { signal: ctx.signal }); return page() } })
  let settled = false
  const pending = new SearchService(registry).search(query, ctx('cleanup', abort.signal)).finally(() => { settled = true })
  void pending.catch(() => {})
  await started; abort.abort()
  try { await new Promise(done => setTimeout(done, 25)); expect(settled).toBe(false) }
  finally { cleaned() }
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})

test('cancelled multi-source searches drain every owned transport before rejecting', async () => {
  const registry = new ProviderRegistry(); const abort = new AbortController()
  let started = 0; let release!: () => void; const cleanup = new Promise<void>(done => { release = done })
  for (const id of ['wy', 'kg']) registry.registerSearch({ id, search: async (_query, ctx) => {
    const fetcher: typeof fetch = async (_url, init) => { started++; return new Promise((_done, fail) => init!.signal!.addEventListener('abort', () => {
      void (id === 'wy' ? Promise.resolve() : cleanup).then(() => fail(init!.signal!.reason))
    }, { once: true })) }
    vi.stubGlobal('fetch', fetcher)
    await requestJson(hostSearchFetch, 'https://fixture.invalid/search', { signal: ctx.signal }); return page()
  } })
  let settled = false
  const pending = new SearchService(registry).search(query, ctx('multi-cleanup', abort.signal)).finally(() => { settled = true }); void pending.catch(() => {})
  await Promise.resolve(); expect(started).toBe(2); abort.abort()
  try { await new Promise(done => setTimeout(done, 25)); expect(settled).toBe(false) }
  finally { release() }
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})

test('one timed-out source does not erase completed results or delay their update', async () => {
  vi.useFakeTimers()
  const registry = new ProviderRegistry()
  registry.registerSearch({ id: 'wy', search: async () => page() })
  registry.registerSearch({ id: 'kg', search: () => new Promise(() => {}) })
  const updates: SearchSnapshot[] = []
  const service = new SearchService(registry, (state) => updates.push(state))
  const pending = service.search(query, ctx())
  void pending.catch(() => {})
  await vi.advanceTimersByTimeAsync(1)
  expect(updates.at(-1)?.tracks.map((track) => track.id) ?? []).toContain('wy:fixture-track')
  expect(updates.at(-1)?.providers.find((source) => source.providerId === 'kg')?.status).toBe('loading')
  await vi.advanceTimersByTimeAsync(7999)
  const result = await pending
  expect(result.tracks.map((track) => track.id)).toContain('wy:fixture-track')
  expect(result.providers.find((source) => source.providerId === 'kg')?.status).toBe('timeout')
})

test('cancellation rejects promptly and ignores providers that resolve late', async () => {
  const registry = new ProviderRegistry()
  let finish!: (value: ReturnType<typeof page>) => void
  registry.registerSearch({ id: 'wy', search: () => new Promise((resolve) => { finish = resolve }) })
  const updates: SearchSnapshot[] = []
  const service = new SearchService(registry, (state) => updates.push(state))
  const abort = new AbortController()
  const pending = service.search(query, ctx('old', abort.signal))
  await Promise.resolve()
  abort.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  const length = updates.length
  finish(page('wy:late')); await Promise.resolve(); await Promise.resolve()
  expect(updates).toHaveLength(length)
  expect((await service.search(query, ctx('new'), { providerIds: [] })).tracks).toEqual([])
})

test('cache separates provider, query, pagination, page size and account revision', async () => {
  const registry = new ProviderRegistry()
  const calls: string[] = []
  for (const id of ['wy', 'extra']) registry.registerSearch({ id, search: async (input) => {
    calls.push(`${id}:${input.text}:${input.page}:${input.pageSize}:${input.authRevision}`)
    return page(`${id}:${input.page}`)
  } })
  const service = new SearchService(registry)
  await service.search(query, ctx()); await service.search(query, ctx('r2'))
  expect(calls).toHaveLength(2)
  await service.search({ ...query, page: 2 }, ctx('r3'), { providerIds: ['wy'] })
  await service.search({ ...query, pageSize: 10 }, ctx('r4'), { providerIds: ['wy'] })
  await service.search({ ...query, text: '屋顶' }, ctx('r5'), { providerIds: ['wy'] })
  await service.search({ ...query, authRevision: '1' }, ctx('r6'))
  expect(calls).toHaveLength(7)
  expect((await service.search(query, ctx('r7'))).tracks.map((track) => track.id)).toEqual(['wy:1', 'extra:1'])
})

test('three consecutive failures pause automatic requests for 60 seconds and manual retry recovers', async () => {
  vi.useFakeTimers()
  const registry = new ProviderRegistry()
  let count = 0
  registry.registerSearch({ id: 'wy', search: async () => { count++; if (count <= 3) throw new Error('private url'); return page() } })
  const service = new SearchService(registry)
  for (let i = 0; i < 3; i++) await service.search(query, ctx(`r${i}`))
  expect((await service.search(query, ctx('paused'))).providers[0].error?.code).toBe('SOURCE_PAUSED')
  expect(count).toBe(3)
  expect((await service.search(query, ctx('manual'), { manualRetry: true })).providers[0].status).toBe('ok')
  expect(count).toBe(4)
  const failureRegistry = new ProviderRegistry()
  let failures = 0
  failureRegistry.registerSearch({ id: 'kg', search: async () => { failures++; throw new Error('fail') } })
  const failing = new SearchService(failureRegistry)
  for (let i = 0; i < 3; i++) await failing.search(query, ctx(`f${i}`))
  await vi.advanceTimersByTimeAsync(59999); await failing.search(query, ctx('early')); expect(failures).toBe(3)
  await vi.advanceTimersByTimeAsync(1); await failing.search(query, ctx('later')); expect(failures).toBe(4)
})

test('same-title live and studio identities stay separate and cache results are owned copies', async () => {
  const registry = new ProviderRegistry()
  registry.registerSearch({ id: 'extra', search: async () => ({ tracks: [makeTrack({ id: 'extra:live', title: '晴天', version: 'live', versionDisplay: '(Live)' }), makeTrack({ id: 'extra:studio', title: '晴天', version: 'studio', versionDisplay: '(Studio)' })], total: 2, nextPage: null }) })
  const service = new SearchService(registry)
  const result = await service.search(query, ctx())
  expect(result.tracks.map((track) => track.id)).toEqual(['extra:live', 'extra:studio'])
  result.tracks[0].title = 'mutated'
  expect((await service.search(query, ctx('next'))).tracks[0].title).toBe('晴天')
})

test('named search IPC validates input, rejects untrusted senders, and maps requestId cancellation', async () => {
  const registry = new ProviderRegistry()
  registry.registerSearch({ id: 'wy', search: () => new Promise(() => {}) })
  const trusted = { webContents: {}, frame: {}, url: 'file:///app/index.html' }
  const route = createIpcRouter(new TaskService(), () => trusted, undefined, new SearchService(registry))
  await expect(route(trusted, { method: 'search.providers', requestId: 'p', params: {} })).resolves.toEqual(['wy'])
  await expect(route(trusted, { method: 'search.run', requestId: 'invalid', params: { query: { ...query, page: 0 } } })).rejects.toThrow('无效的请求')
  await expect(route(trusted, { method: 'search.run', requestId: 'invalid', params: { query, url: 'http://evil' } })).rejects.toThrow('无效的请求')
  await expect(route({ ...trusted, frame: {} }, { method: 'search.providers', requestId: 'x', params: {} })).rejects.toThrow('请求来源')
  const pending = route(trusted, { method: 'search.run', requestId: 'running', params: { query } })
  await expect(route(trusted, { method: 'search.run', requestId: 'running', params: { query } })).rejects.toThrow('重复搜索请求')
  await route(trusted, { method: 'search.cancel', requestId: 'cancel', params: { requestId: 'running' } })
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})
test('cancelled requests do not trip the source failure circuit', async () => {
  const registry = new ProviderRegistry()
  let count = 0
  registry.registerSearch({ id: 'wy', search: async () => { count++; return count <= 3 ? new Promise(() => {}) : page() } })
  const service = new SearchService(registry)
  for (let i = 0; i < 3; i++) {
    const abort = new AbortController()
    const pending = service.search(query, ctx(`cancel-${i}`, abort.signal))
    await Promise.resolve(); abort.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  }
  expect((await service.search(query, ctx('healthy'))).providers[0].status).toBe('ok')
})
test('failures completed from overlapping searches still count toward the source circuit', async () => {
  vi.useFakeTimers()
  const registry = new ProviderRegistry()
  const fail: ((error: Error) => void)[] = []
  registry.registerSearch({ id: 'wy', search: () => new Promise((_resolve, reject) => fail.push(reject)) })
  const service = new SearchService(registry)
  const pending = [1, 2, 3].map((i) => service.search({ ...query, text: `词${i}` }, ctx(`overlap-${i}`)))
  await Promise.resolve()
  for (let i = 0; i < 3; i++) { fail[i](new Error('failure')); await pending[i] }
  const paused = service.search(query, ctx('paused-after-overlap'))
  await vi.advanceTimersByTimeAsync(8000)
  expect((await paused).providers[0].error?.code).toBe('SOURCE_PAUSED')
})
