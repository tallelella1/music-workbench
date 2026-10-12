import { createCipheriv, createHash } from 'node:crypto'
import { z } from 'zod'
import type { SearchPage, SearchProvider, SearchQuery } from '../../../shared/providers'
import { SearchQuerySchema } from '../../../shared/providers'
import { artistSchema, duration, identityValue, ProviderFailure, requestJson, searchPage, songIdSchema, track, hostSearchFetch } from '../search-common'

const envelope = z.object({ code: z.literal(200), data: z.object({ resources: z.array(z.unknown()), totalCount: z.unknown().optional() }) })
const song = z.object({ id: songIdSchema, name: z.string().min(1), ar: artistSchema, al: z.object({ name: z.unknown().optional(), id: z.unknown().optional() }).optional(), dt: z.unknown().optional() })
export function parseWySearch(input: unknown, query: SearchQuery): SearchPage {
  const parsed = envelope.safeParse(input)
  if (!parsed.success) throw new ProviderFailure('error', '网易云响应结构无效或来源拒绝请求')
  const tracks = parsed.data.data.resources.flatMap((value) => {
    const container = z.object({ baseInfo: z.object({ simpleSongData: z.unknown() }) }).safeParse(value)
    if (!container.success) return []
    const parsedSong = song.safeParse(container.data.baseInfo.simpleSongData)
    if (!parsedSong.success) return []
    const item = parsedSong.data
    return [track('wy', item.id, item.name, item.ar.map((artist) => artist.name), item.al?.name, duration(item.dt, 1000), { originalTitle: item.name, albumId: identityValue(item.al?.id) })]
  })
  return searchPage(tracks, parsed.data.data.totalCount, parsed.data.data.resources.length, query)
}
export function createWySearch(fetcher: typeof fetch = hostSearchFetch): SearchProvider {
  return { id: 'wy', async search(input, ctx) {
    const query = SearchQuerySchema.parse(input)
    const path = '/api/search/song/list/page'
    const text = JSON.stringify({ keyword: query.text, needCorrect: '1', channel: 'typing', offset: query.pageSize * (query.page - 1), scene: 'normal', total: query.page === 1, limit: query.pageSize })
    const digest = createHash('md5').update(`nobody${path}use${text}md5forencrypt`).digest('hex')
    const cipher = createCipheriv('aes-128-ecb', 'e82ckenh8dichen8', null)
    const params = Buffer.concat([cipher.update(`${path}-36cd479b6b5-${text}-36cd479b6b5-${digest}`), cipher.final()]).toString('hex').toUpperCase()
    return parseWySearch(await requestJson(fetcher, 'https://interface.music.163.com/eapi/batch', { method: 'POST', signal: ctx.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', origin: 'https://music.163.com', 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36' }, body: new URLSearchParams({ params }).toString() }), query)
  } }
}
