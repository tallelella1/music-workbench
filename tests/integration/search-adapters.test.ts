import { afterEach, expect, test, vi } from 'vitest'
import { createWySearch, parseWySearch } from '../../src/main/providers/wy/search'
import { createKgSearch, parseKgSearch } from '../../src/main/providers/kg/search'
import { createTxSearch, parseTxSearch } from '../../src/main/providers/tx/search'
import { createDecipheriv } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { ProviderRegistry } from '../../src/main/providers/registry'
import { SearchService } from '../../src/main/search/search-service'

const query = { text: '周杰伦 & live', page: 2, pageSize: 5, authRevision: '0' }
const ctx = { requestId: 'adapters', signal: new AbortController().signal }
afterEach(() => vi.useRealTimers())
// Synthetic envelope cases; real dated probe fixtures are tested separately.
const samples = [
  { id: 'wy', parse: parseWySearch, create: createWySearch, data: { code: 200, data: { resources: [{ baseInfo: { simpleSongData: { id: 1, name: '晴天 (Live)', ar: [{ name: '周杰伦' }], al: { name: '专辑', id: 2 }, dt: 269000 } } }], totalCount: 11 } }, empty: { code: 200, data: { resources: [], totalCount: 0 } } },
  { id: 'kg', parse: parseKgSearch, create: createKgSearch, data: { error_code: 0, data: { lists: [{ Audioid: 1, OriSongName: '晴天', Suffix: '(Live)', Singers: [{ name: '周杰伦' }], AlbumName: '专辑', AlbumID: '2', FileHash: 'hash', MixSongID: 3, Duration: 269 }], total: 11 } }, empty: { error_code: 0, data: { lists: [], total: 0 } } },
  { id: 'tx', parse: parseTxSearch, create: createTxSearch, data: { code: 0, req: { code: 0, data: { body: { song: { list: [{ mid: '1', id: 99, title: '晴天', title_extra: '(Live)', singer: [{ name: '周杰伦' }], album: { name: '专辑', mid: '2' }, file: { media_mid: 'media' }, interval: 269 }] } }, meta: { sum: 11 } } } }, empty: { code: 0, req: { code: 0, data: { body: { song: { list: [] } }, meta: { sum: 0 } } } } }
]
for (const sample of samples) {
  test(`${sample.id} normalizes identity and version without creating playback or quality evidence`, () => {
    const result = sample.parse(sample.data, query)
    expect(result).toMatchObject({ total: 11, nextPage: 3, tracks: [{ artists: ['周杰伦'], version: 'live', versionDisplay: '(Live)', durationSeconds: 269, audioAssetId: null, artworkAssetId: null, sources: [{ providerId: sample.id, songId: '1' }] }] })
  })
  test(`${sample.id} accepts valid empty but rejects missing envelope and non-success codes`, () => {
    expect(sample.parse(sample.empty, query)).toEqual({ tracks: [], total: 0, nextPage: null })
    expect(() => sample.parse({}, query)).toThrow()
    expect(() => sample.parse({ code: 403, error_code: 403 }, query)).toThrow()
  })
  test(`${sample.id} rejects HTTP 429, non-JSON and transport failures and parses text/plain JSON`, async () => {
    await expect(sample.create(async () => new Response('', { status: 429 })).search(query, ctx)).rejects.toMatchObject({ status: 'rate-limited' })
    await expect(sample.create(async () => new Response('not json')).search(query, ctx)).rejects.toMatchObject({ status: 'error' })
    await expect(sample.create(async () => { throw new TypeError('private network url') }).search(query, ctx)).rejects.toMatchObject({ status: 'error' })
    const result = await sample.create(async () => new Response(JSON.stringify(sample.data), { headers: { 'Content-Type': 'text/plain' } })).search(query, ctx)
    expect(result.tracks[0].version).toBe('live')
  })
  test(`${sample.id} propagates abort signal rather than fabricating empty`, async () => {
    const abort = new AbortController(); abort.abort()
    await expect(sample.create(async (_url, init) => { init?.signal?.throwIfAborted(); return new Response('{}') }).search(query, { ...ctx, signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
  test(`${sample.id} missing song identity is skipped and missing duration is not invented`, () => {
    const raw = structuredClone(sample.data) as any
    const item = sample.id === 'wy' ? raw.data.resources[0].baseInfo.simpleSongData : sample.id === 'kg' ? raw.data.lists[0] : raw.req.data.body.song.list[0]
    delete item[sample.id === 'wy' ? 'dt' : sample.id === 'kg' ? 'Duration' : 'interval']
    expect(sample.parse(raw, query).tracks[0].durationSeconds).toBeNull()
    delete item[sample.id === 'wy' ? 'id' : sample.id === 'kg' ? 'Audioid' : 'mid']
    expect(sample.parse(raw, query).tracks).toEqual([])
  })
  test(`${sample.id} hanging transport becomes an independent eight-second timeout`, async () => {
    vi.useFakeTimers()
    const registry = new ProviderRegistry()
    registry.registerSearch(sample.create(() => new Promise(() => {})))
    const pending = new SearchService(registry).search(query, ctx)
    await vi.advanceTimersByTimeAsync(8000)
    expect((await pending).providers).toMatchObject([{ providerId: sample.id, status: 'timeout' }])
  })
}
test('requests encode Chinese queries with provider pagination and anonymous signatures', async () => {
  const emitted: { url: string; init?: RequestInit }[] = []
  for (const sample of samples) await sample.create(async (url, init) => { emitted.push({ url: String(url), init }); return new Response(JSON.stringify(sample.data)) }).search(query, ctx)
  const params = new URLSearchParams(String(emitted[0].init?.body)).get('params')!
  const cipher = createDecipheriv('aes-128-ecb', 'e82ckenh8dichen8', null)
  const decoded = Buffer.concat([cipher.update(Buffer.from(params, 'hex')), cipher.final()]).toString()
  expect(decoded).toContain('"keyword":"周杰伦 & live"')
  expect(decoded).toContain('"offset":5')
  const kgUrl = new URL(emitted[1].url)
  expect(kgUrl.searchParams.get('keyword')).toBe('周杰伦 & live')
  expect(kgUrl.searchParams.get('page')).toBe('2')
  expect(kgUrl.searchParams.get('pagesize')).toBe('5')
  const tx = JSON.parse(String(emitted[2].init?.body))
  expect(tx['music.search.SearchCgiService'].param).toMatchObject({ query: '周杰伦 & live', page_num: 2, num_per_page: 5 })
  expect(tx.comm.uin).toBe('0')
  expect(new URL(emitted[2].url).searchParams.get('sign')).toMatch(/^zzc[a-z0-9]+$/)
})
test('missing required song identity is skipped; missing duration stays null and unmarked songs stay unknown', () => {
  const result = parseKgSearch({ error_code: 0, data: { lists: [{ Audioid: 1, OriSongName: '晴天', Singers: [{ name: '周杰伦' }] }, { OriSongName: '晴天', Singers: [{ name: '周杰伦' }] }, { Audioid: 2, OriSongName: '晴天' }], total: 3 } }, query)
  expect(result.tracks).toHaveLength(1)
  expect(result.tracks[0]).toMatchObject({ version: 'unknown', versionDisplay: null, durationSeconds: null })
})
for (const sample of samples) test(`${sample.id} dated observed fixture retains actual normalized metadata`, async () => {
  const fixture = JSON.parse(await readFile(`tests/fixtures/providers/${sample.id}-search.json`, 'utf8'))
  expect(fixture.kind).toBe('observed')
  expect(fixture.httpStatus).toBe(200)
  expect(Number.isFinite(Date.parse(fixture.observedAt))).toBe(true)
  const result = sample.parse(fixture.response, fixture.query)
  expect(result.tracks).toHaveLength(5)
  expect(result.tracks[0].artists).toContain('周杰伦')
  expect(result.tracks.every((track) => track.audioAssetId === null)).toBe(true)
  expect(result.tracks[0].sources[0].songId).toBe(sample.id === 'wy' ? '509781655' : sample.id === 'kg' ? '20505418' : '0039MnYb0qxYhV')
})
