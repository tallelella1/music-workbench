const { build } = require('esbuild')
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

async function main() {
const argument = process.argv.indexOf('--query')
const queryText = argument < 0 ? '周杰伦' : process.argv[argument + 1]?.trim()
if (!queryText || queryText.length > 200) throw new Error('--query requires 1–200 characters')
const temporary = await mkdtemp(join(tmpdir(), 'music-search-probe-'))
const output = resolve('tests/fixtures/providers')
const observations = new Map<string, Record<string, unknown>>()
const actualFetch = globalThis.fetch
// Explicit allowlist: retain original parsing evidence, exclude accounts, cookies, URLs and playable links.
const pick = (item: any, keys: string[]) => Object.fromEntries(keys.filter((key) => item && key in item).map((key) => [key, item[key]]))
function sanitize(providerId: string, body: any): unknown {
  if (providerId === 'wy') return { code: body?.code, data: { totalCount: body?.data?.totalCount, resources: body?.data?.resources?.map((row: any) => ({ baseInfo: { simpleSongData: { ...pick(row?.baseInfo?.simpleSongData, ['id', 'name', 'dt']), ar: row?.baseInfo?.simpleSongData?.ar?.map((artist: any) => pick(artist, ['name'])), al: pick(row?.baseInfo?.simpleSongData?.al, ['id', 'name']) } } })) } }
  if (providerId === 'kg') return { error_code: body?.error_code, data: { total: body?.data?.total, lists: body?.data?.lists?.map((row: any) => ({ ...pick(row, ['Audioid', 'OriSongName', 'Suffix', 'AlbumName', 'AlbumID', 'Duration', 'FileHash', 'MixSongID']), Singers: row.Singers?.map((artist: any) => pick(artist, ['name'])) })) } }
  const req = body?.['music.search.SearchCgiService'] ?? body?.req
  return { code: body?.code, req: { code: req?.code, data: { meta: pick(req?.data?.meta, ['sum']), body: { song: { list: req?.data?.body?.song?.list?.map((row: any) => ({ ...pick(row, ['mid', 'id', 'title', 'title_extra', 'interval']), singer: row.singer?.map((artist: any) => pick(artist, ['name'])), album: pick(row.album, ['name', 'mid']), file: pick(row.file, ['media_mid']) })) } } } } }
}
try {
  const bundled = join(temporary, 'providers.mjs')
  await build({ entryPoints: ['src/main/providers/registry.ts'], outfile: bundled, bundle: true, platform: 'node', format: 'esm' })
  globalThis.fetch = async (input, init) => {
    const host = new URL(String(input)).hostname
    const id = host.includes('163.com') ? 'wy' : host.includes('kugou.com') ? 'kg' : 'tx'
    const time = new Date().toISOString()
    const response = await actualFetch(input, init)
    const text = await response.clone().text()
    let data: unknown = null
    try { data = sanitize(id, JSON.parse(text)) } catch { /* Non-JSON is recorded without raw HTML. */ }
    observations.set(id, { kind: 'observed', observedAt: time, providerId: id, query: { text: queryText, page: 1, pageSize: 5, authRevision: '0' }, httpStatus: response.status, contentType: response.headers.get('content-type'), response: data })
    return response
  }
  const { defaultSearchRegistry } = await import(pathToFileURL(bundled).href)
  await mkdir(output, { recursive: true })
  const results = await Promise.all(defaultSearchRegistry().searches().map(async (provider: any) => {
    const start = new Date().toISOString()
    try {
      const page = await provider.search({ text: queryText, page: 1, pageSize: 5, authRevision: '0' }, { requestId: `probe-${provider.id}`, signal: AbortSignal.timeout(8000) })
      const observed = { ...observations.get(provider.id), status: page.tracks.length ? 'ok' : 'empty', count: page.tracks.length, total: page.total, fullPlayback: '尚未解析' }
      await writeFile(join(output, `${provider.id}-search.json`), JSON.stringify(observed, null, 2) + '\n')
      console.log(JSON.stringify({ date: start, providerId: provider.id, httpStatus: observed.httpStatus, status: observed.status, count: page.tracks.length, total: page.total, fullPlayback: '尚未解析' }))
      return observed
    } catch (error: any) {
      const observation = observations.get(provider.id)
      const failure = { ...(observation ?? { kind: 'observed', observedAt: start, providerId: provider.id, query: queryText, httpStatus: null }), status: error.name === 'TimeoutError' ? 'timeout' : error.status ?? 'error', count: 0 }
      console.log(JSON.stringify(failure))
      return failure
    }
  }))
  await writeFile(join(output, 'probe-latest.json'), JSON.stringify({ completedAt: new Date().toISOString(), sources: results }, null, 2) + '\n')
} finally {
  globalThis.fetch = actualFetch
  await rm(temporary, { recursive: true, force: true })
}
}
void main().catch((error) => { console.error(error instanceof Error ? error.message : 'Probe failed'); process.exitCode = 1 })
