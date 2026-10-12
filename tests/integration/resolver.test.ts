import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runtimeBinary } from '../../src/main/assets/media-probe'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeAudioFile, makeTrack } from '../helpers/fixtures'
import { AssetRegistry } from '../../src/main/assets/asset-registry'
import { StorageRepository } from '../../src/main/storage/repository'
import { MediaResourceRegistry } from '../../src/main/assets/media-protocol'
import { ProviderRegistry } from '../../src/main/providers/registry'
import type { ResolvedAudio, PlaybackProvider } from '../../src/shared/providers'
import { SearchService } from '../../src/main/search/search-service'
import { requestJson, hostSearchFetch } from '../../src/main/providers/search-common'

let directory: string; let server: Server; let base: string
const httpRequests = new Map<string, number>()
const ctx = () => ({ requestId: crypto.randomUUID(), signal: new AbortController().signal })
const ref = (id: string) => ({ providerId: id, songId: '1', identity: {} })
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'complete-audio-'))
  const bytes = new Map<string, Buffer>()
  for (const duration of [20, 30]) bytes.set(`/${duration}.wav`, await readFile(await makeAudioFile({ directory, name: `${duration}.wav`, durationSeconds: duration, toneHz: 440 })))
  await promisify(execFile)(runtimeBinary('ffmpeg'), ['-v', 'error', '-i', join(directory, '20.wav'), '-c:a', 'libmp3lame', '-b:a', '128k', join(directory, '20.mp3')], { windowsHide: true })
  bytes.set('/20.mp3', await readFile(join(directory, '20.mp3')))
  // Header duration claims twenty seconds, actual PCM is only one second.
  bytes.set('/broken.wav', bytes.get('/20.wav')!.subarray(0, 44 + 44100 * 2))
  server = createServer((request, response) => {
    httpRequests.set(request.url!, (httpRequests.get(request.url!) ?? 0) + 1)
    if (request.url!.startsWith('/delayed/') || request.url!.startsWith('/blocked/')) {
      const body = bytes.get('/20.wav')!
      setTimeout(() => response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': body.length }).end(body), request.url!.startsWith('/blocked/') ? 2000 : 600)
      return
    }
    if (request.url === '/protected.wav' && request.headers.authorization !== 'Bearer host-only') { response.writeHead(401).end(); return }
    const body = bytes.get(request.url === '/protected.wav' ? '/20.wav' : request.url!)
    if (!body) { response.writeHead(404).end(); return }
    response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': body.length }); response.end(body)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => { await new Promise<void>((done) => server.close(() => done())); await rm(directory, { recursive: true, force: true }) })
function audio(path = '/20.wav', overrides: Partial<ResolvedAudio> = {}): ResolvedAudio { return { url: base + path, headers: {}, expiresAt: null, declaredQuality: '128k', preview: false, expectedDurationSeconds: null, ...overrides } }
async function modules() {
  const completeness = await import('../../src/main/playback/completeness').catch(() => null)
  const resolver = await import('../../src/main/playback/resolver').catch(() => null)
  expect(completeness, 'real completeness checker must exist').not.toBeNull(); expect(resolver).not.toBeNull()
  return { ...completeness!, ...resolver! }
}
test('real complete twenty second songs pass; preview, truncated, unknown and inconsistent media fail', async () => {
  const { checkCompleteness } = await modules()
  const track = makeTrack({ durationSeconds: 20 })
  const full = await checkCompleteness(track, audio(), ctx())
  expect(full.accepted).toBe(true); expect(full.probe.durationSeconds).toBeCloseTo(20, 2)
  expect((await checkCompleteness(track, audio('/20.wav', { preview: true }), ctx())).accepted).toBe(false)
  expect((await checkCompleteness(makeTrack({ durationSeconds: 180 }), audio('/30.wav'), ctx())).accepted).toBe(false)
  expect((await checkCompleteness(makeTrack({ durationSeconds: null }), audio(), ctx())).accepted).toBe(false)
  expect((await checkCompleteness(track, audio('/broken.wav'), ctx())).accepted).toBe(false)
  expect((await checkCompleteness(track, audio('/20.wav', { expectedDurationSeconds: 180 }), ctx())).accepted).toBe(false)
  // Official LX plain URL supplies preview=null, strong full-media evidence is still required.
  expect((await checkCompleteness(track, audio('/20.wav', { preview: null }), ctx())).accepted).toBe(true)
})
function provider(id: string, resolve: PlaybackProvider['resolve'], qualities = ['128k']): PlaybackProvider { return { id, capabilities: () => ({ contractMajor: 1, platformIds: [id], qualities, fullTrack: true, offlineEditable: false }), resolve } }
function media() { return new MediaResourceRegistry(new AssetRegistry(new StorageRepository(directory), join(directory, 'artwork'))) }
test('failure advances once to second source and opaque proxy keeps credentials host-only', async () => {
  const { PlaybackResolver } = await modules(); const registry = new ProviderRegistry(); const resources = media()
  registry.registerPlayback(provider('one', async () => { throw new Error('https://secret/?token=private') }))
  registry.registerPlayback(provider('two', async () => audio('/protected.wav', { headers: { authorization: 'Bearer host-only' } })))
  const resolver = new PlaybackResolver(registry, resources)
  const resource = await resolver.resolve(makeTrack({ durationSeconds: 20, sources: [ref('one'), ref('two')] }), { quality: '128k', strict: true }, ctx())
  expect(resource.url).toMatch(/^media:\/\/remote\//); expect(JSON.stringify(resource)).not.toMatch(/host-only|secret|127\.0\.0\.1/)
  const response = await resources.handle(new Request(resource.url, { headers: { range: 'bytes=-100' } }), 'null')
  expect(response.status).toBe(206); expect((await response.arrayBuffer()).byteLength).toBe(100)
  expect(resource.actualQuality).toMatch(/pcm_s16le.*44100.*16/)
  expect(resolver.trace(ctx().requestId)).toEqual([])
})
test('strict quality does not downgrade; relaxed quality reports actual decoded attributes', async () => {
  const { PlaybackResolver } = await modules(); const registry = new ProviderRegistry()
  registry.registerPlayback(provider('one', async () => audio()))
  const resolver = new PlaybackResolver(registry, media()); const track = makeTrack({ durationSeconds: 20, sources: [ref('one')] })
  await expect(resolver.resolve(track, { quality: 'flac', strict: true }, ctx())).rejects.toThrow()
  const resource = await resolver.resolve(track, { quality: 'flac', strict: false }, ctx())
  expect(resource.actualQuality).toMatch(/pcm_s16le/)
})
test('six distinct combinations maximum and total deadline cancel uncooperative sources', async () => {
  const { PlaybackResolver } = await modules(); const registry = new ProviderRegistry(); let calls = 0
  for (const id of ['one', 'two', 'three', 'four']) registry.registerPlayback(provider(id, async () => { calls++; throw new Error('failed') }, ['128k', '320k', 'flac']))
  const track = makeTrack({ durationSeconds: 20, sources: ['one', 'two', 'three', 'four', 'one'].map(ref) })
  const resolver = new PlaybackResolver(registry, media())
  await expect(resolver.resolve(track, { quality: 'flac', strict: false }, ctx())).rejects.toThrow(); expect(calls).toBe(6)
  const hanging = new ProviderRegistry(); hanging.registerPlayback(provider('one', async () => new Promise(() => {})))
  const start = Date.now()
  await expect(new PlaybackResolver(hanging, media(), { budgetMs: 60 }).resolve(track, { quality: '128k', strict: true }, ctx())).rejects.toThrow(/预算|超时/)
  expect(Date.now() - start).toBeLessThan(1000)
})

test('fallback cancellation waits for the owned search transport cleanup', async () => {
  const { PlaybackResolver } = await modules(); const registry = new ProviderRegistry(); const abort = new AbortController()
  let started!: () => void; const entered = new Promise<void>(done => { started = done })
  let release!: () => void; const cleanup = new Promise<void>(done => { release = done })
  registry.registerSearch({ id: 'wy', search: async (_query, context) => {
    const fetcher: typeof fetch = async (_url, init) => { started(); return new Promise((_done, fail) => init!.signal!.addEventListener('abort', () => {
      void cleanup.then(() => fail(init!.signal!.reason))
    }, { once: true })) }
    vi.stubGlobal('fetch', fetcher)
    await requestJson(hostSearchFetch, 'https://fixture.invalid/search', { signal: context.signal }); return { tracks: [], total: 0, nextPage: null }
  } })
  const search = new SearchService(registry)
  const resolver = new PlaybackResolver(registry, media(), { candidates: async (_track, context) => (await search.search({ text: 'fallback', page: 1, pageSize: 20, authRevision: '0' }, context)).tracks })
  let settled = false
  const pending = resolver.resolve(makeTrack({ durationSeconds: 20 }), { quality: '128k', strict: true }, { requestId: crypto.randomUUID(), signal: abort.signal }).finally(() => { settled = true }); void pending.catch(() => {})
  await entered; abort.abort()
  try { await new Promise(done => setTimeout(done, 25)); expect(settled).toBe(false) }
  finally { release(); vi.unstubAllGlobals() }
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})
test('expired links are re-resolved and unchecked resources cannot be issued', async () => {
  const { PlaybackResolver } = await modules(); const registry = new ProviderRegistry(); let calls = 0; const resources = media()
  registry.registerPlayback(provider('one', async () => audio('/20.wav', { expiresAt: ++calls === 1 ? Date.now() - 1 : Date.now() + 10000 })))
  const resource = await new PlaybackResolver(registry, resources).resolve(makeTrack({ durationSeconds: 20, sources: [ref('one')] }), { quality: '128k', strict: true }, ctx())
  expect(calls).toBe(2); expect(resource.expiresAt).toBeGreaterThan(Date.now())
  await expect(resources.issueRemote(audio(), resource.probe)).rejects.toThrow(/验证/)
})

test('expiry during real media verification refreshes once and verifies the fresh bytes', async () => {
  const { PlaybackResolver } = await modules(); const registry = new ProviderRegistry(); const resources = media(); let calls = 0
  registry.registerPlayback(provider('one', async () => ++calls === 1
    ? audio('/delayed/refresh', { expiresAt: Date.now() + 300 })
    : audio('/20.mp3', { expiresAt: Date.now() + 10000 })))
  const resolver = new PlaybackResolver(registry, resources); const context = ctx()
  const result = await resolver.resolve(makeTrack({ durationSeconds: 20, sources: [ref('one')] }), { quality: '128k', strict: true }, context)
  expect(calls).toBe(2); expect(httpRequests.get('/delayed/refresh')).toBe(1)
  expect(result.probe.codec).toBe('mp3'); expect(resolver.trace(context.requestId)).toHaveLength(1)
  const response = await resources.handle(new Request(result.url), 'null')
  expect(Buffer.from(await response.arrayBuffer())).toEqual(await readFile(join(directory, '20.mp3')))
})

test('expiry refresh is shared across before-check and during-check expiry; ordinary failures do not retry', async () => {
  const { PlaybackResolver } = await modules(); const track = makeTrack({ durationSeconds: 20, sources: [ref('one')] })
  for (const firstExpired of [false, true]) {
    const registry = new ProviderRegistry(); let calls = 0
    registry.registerPlayback(provider('one', async () => audio(`/delayed/repeated-${firstExpired}`, { expiresAt: Date.now() + (++calls === 1 && firstExpired ? -1 : 300) })))
    await expect(new PlaybackResolver(registry, media()).resolve(track, { quality: '128k', strict: true }, ctx())).rejects.toThrow(/过期/)
    expect(calls).toBe(2)
  }
  const registry = new ProviderRegistry(); let calls = 0
  registry.registerPlayback(provider('one', async () => { calls++; return audio('/broken.wav') }))
  await expect(new PlaybackResolver(registry, media()).resolve(track, { quality: '128k', strict: true }, ctx())).rejects.toThrow()
  expect(calls).toBe(1)
})

test('expiry refresh remains within the total budget and responds to cancellation', async () => {
  const { PlaybackResolver } = await modules(); const track = makeTrack({ durationSeconds: 20, sources: [ref('one')] })
  for (const cancel of [false, true]) {
    const registry = new ProviderRegistry(); let calls = 0; const abort = new AbortController()
    registry.registerPlayback(provider('one', async () => {
      calls++
      if (calls === 2 && cancel) setTimeout(() => abort.abort(new Error('cancel refresh')), 100)
      return audio(calls === 1 ? `/delayed/budget-${cancel}` : `/blocked/budget-${cancel}`, { expiresAt: Date.now() + (calls === 1 ? 300 : 10000) })
    }))
    const started = Date.now()
    await expect(new PlaybackResolver(registry, media(), { budgetMs: 1000 }).resolve(track, { quality: '128k', strict: true }, { requestId: crypto.randomUUID(), signal: abort.signal })).rejects.toThrow(cancel ? /cancel refresh/ : /预算/)
    expect(calls).toBe(2); expect(Date.now() - started).toBeLessThan(1600)
  }
})

test('a declared FLAC or Hi-Res label never substitutes for actual media properties', async () => {
  const { PlaybackResolver } = await modules(); const registry = new ProviderRegistry()
  registry.registerPlayback(provider('one', async (_ref, quality) => audio('/20.mp3', { declaredQuality: quality }), ['flac', 'flac24bit']))
  const track = makeTrack({ durationSeconds: 20, sources: [ref('one')] })
  for (const quality of ['flac', 'flac24bit']) await expect(new PlaybackResolver(registry, media()).resolve(track, { quality, strict: true }, ctx())).rejects.toThrow(/实际媒体|音质/)
})
test('automatic fallback only resolves candidates with all recording identity evidence', async () => {
  const { PlaybackResolver } = await modules(); const registry = new ProviderRegistry(); const resolvedIds: string[] = []
  registry.registerPlayback(provider('two', async (candidate) => { resolvedIds.push(candidate.songId); return audio() }))
  const expected = makeTrack({ title: 'Song (Studio)', versionDisplay: 'Studio', album: 'Album', durationSeconds: 20 })
  const candidate = makeTrack({ ...expected, id: 'candidate', sources: [{ ...ref('two'), songId: 'good' }] })
  const resolver = new PlaybackResolver(registry, media(), { candidates: async () => [
    { ...candidate, artists: ['Other'], sources: [{ ...ref('two'), songId: 'wrong-artist' }] },
    { ...candidate, title: 'Song (Live)', version: 'live', versionDisplay: 'Live', sources: [{ ...ref('two'), songId: 'live' }] },
    { ...candidate, album: null, sources: [{ ...ref('two'), songId: 'missing-album' }] }, candidate
  ] })
  const result = await resolver.resolve(expected, { quality: '128k', strict: true }, ctx())
  expect(result.url).toMatch(/^media:\/\/remote\//); expect(resolvedIds).toEqual(['good'])
})
