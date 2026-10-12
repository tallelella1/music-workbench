import { createHash, randomBytes, randomInt } from 'node:crypto'
import { z } from 'zod'
import type { SearchPage, SearchProvider, SearchQuery } from '../../../shared/providers'
import { SearchQuerySchema } from '../../../shared/providers'
import { artistSchema, duration, identityValue, ProviderFailure, requestJson, searchPage, songIdSchema, track, hostSearchFetch } from '../search-common'
const requestEnvelope = z.object({ code: z.literal(0), data: z.object({ body: z.object({ song: z.object({ list: z.array(z.unknown()) }) }), meta: z.object({ sum: z.unknown().optional() }).optional() }) })
const envelope = z.object({ code: z.literal(0), req: z.unknown().optional(), 'music.search.SearchCgiService': z.unknown().optional() })
const song = z.object({ mid: songIdSchema, title: z.string().min(1), title_extra: z.string().optional(), singer: artistSchema, interval: z.unknown().optional(), id: z.unknown().optional(), file: z.object({ media_mid: z.string().min(1) }), album: z.object({ name: z.unknown().optional(), mid: z.unknown().optional() }).optional() })
export function parseTxSearch(input: unknown, query: SearchQuery): SearchPage {
  const outer = envelope.safeParse(input)
  if (!outer.success) throw new ProviderFailure('error', 'QQ 音乐响应结构无效或来源拒绝请求')
  const parsed = requestEnvelope.safeParse(outer.data['music.search.SearchCgiService'] ?? outer.data.req)
  if (!parsed.success) throw new ProviderFailure('error', 'QQ 音乐响应结构无效或来源拒绝请求')
  const items = parsed.data.data.body.song.list
  const tracks = items.flatMap((value) => {
    const parsedSong = song.safeParse(value)
    if (!parsedSong.success) return []
    const item = parsedSong.data
    return [track('tx', item.mid, item.title, item.singer.map((artist) => artist.name), item.album?.name, duration(item.interval), {
      originalTitle: item.title, title_extra: item.title_extra ?? null, id: identityValue(item.id), media_mid: item.file.media_mid, albumMid: identityValue(item.album?.mid)
    }, item.title_extra)]
  })
  return searchPage(tracks, parsed.data.data.meta?.sum, items.length, query)
}
// Fixed LX adapter SHA ad95d5091c9ed689fa72b5e5c849df65f5a679ce; anonymous client signature.
function sign(text: string): string {
  const hash = createHash('sha1').update(text).digest('hex')
  const pick = (indices: number[]) => indices.map((index) => hash[index]).join('')
  const scramble = [89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179]
  const middle = Buffer.from(scramble.map((value, i) => value ^ Number.parseInt(hash.slice(i * 2, i * 2 + 2), 16))).toString('base64').replace(/[\\/+=]/g, '')
  return `zzc${pick([23, 14, 6, 36, 16, 40, 7, 19])}${middle}${pick([16, 1, 32, 12, 19, 27, 8, 5])}`.toLowerCase()
}
export function createTxSearch(fetcher: typeof fetch = hostSearchFetch): SearchProvider {
  return { id: 'tx', async search(input, ctx) {
    const query = SearchQuerySchema.parse(input)
    const body = JSON.stringify({ comm: { _channelid: '0', _os_version: '6.2.9200-2', ct: '19', cv: '2151', guid: '1F70E520B2EAA7D25E11760783C53CA9', patch: '118', psrf_access_token_expiresAt: 0, psrf_qqaccess_token: '', psrf_qqopenid: '', psrf_qqunionid: '', tmeAppID: 'qqmusic', tmeLoginType: 0, uin: '0', wid: '7223299733393904640' },
      'music.search.SearchCgiService': { module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicDesktop', param: { grp: 1, num_per_page: query.pageSize, page_num: query.page, query: query.text, remoteplace: 'txt.newclient.top', search_type: 0, searchid: randomBytes(16).toString('hex').toUpperCase() + String(randomInt(100000)).padStart(5, '0') } } })
    return parseTxSearch(await requestJson(fetcher, `https://u.y.qq.com/cgi-bin/musics.fcg?sign=${sign(body)}`, { method: 'POST', signal: ctx.signal, headers: { 'Content-Type': 'application/json', 'User-Agent': 'QQMusic 14090508(android 12)' }, body }), query)
  } }
}
