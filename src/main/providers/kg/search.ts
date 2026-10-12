import { z } from 'zod'
import type { SearchPage, SearchProvider, SearchQuery } from '../../../shared/providers'
import { SearchQuerySchema } from '../../../shared/providers'
import { artistSchema, decodeName, duration, identityValue, ProviderFailure, requestJson, searchPage, songIdSchema, track, hostSearchFetch } from '../search-common'
const envelope = z.object({ error_code: z.literal(0), data: z.object({ lists: z.array(z.unknown()), total: z.unknown().optional() }) })
const song = z.object({ Audioid: songIdSchema, OriSongName: z.string().min(1), Singers: artistSchema, Suffix: z.string().optional(), AlbumName: z.unknown().optional(), AlbumID: z.unknown().optional(), Duration: z.unknown().optional(), FileHash: z.unknown().optional(), MixSongID: z.unknown().optional() })
export function parseKgSearch(input: unknown, query: SearchQuery): SearchPage {
  const parsed = envelope.safeParse(input)
  if (!parsed.success) throw new ProviderFailure('error', '酷狗响应结构无效或来源拒绝请求')
  const tracks = parsed.data.data.lists.flatMap((value) => {
    const parsedSong = song.safeParse(value)
    if (!parsedSong.success) return []
    const item = parsedSong.data
    return [track('kg', item.Audioid, decodeName(`${item.OriSongName}${item.Suffix ? ` ${item.Suffix}` : ''}`), item.Singers.map((artist) => decodeName(artist.name)), typeof item.AlbumName === 'string' ? decodeName(item.AlbumName) : null, duration(item.Duration), {
      originalTitle: item.OriSongName, originalSuffix: item.Suffix ?? null, FileHash: identityValue(item.FileHash), MixSongID: identityValue(item.MixSongID), AlbumID: identityValue(item.AlbumID)
    }, item.Suffix)]
  })
  return searchPage(tracks, parsed.data.data.total, parsed.data.data.lists.length, query)
}
export function createKgSearch(fetcher: typeof fetch = hostSearchFetch): SearchProvider {
  return { id: 'kg', async search(input, ctx) {
    const query = SearchQuerySchema.parse(input)
    const url = new URL('https://songsearch.kugou.com/song_search_v2')
    url.search = new URLSearchParams({ platform: 'AndroidFilter', iscorrection: '1', keyword: query.text, hifiquality: '0', pagesize: String(query.pageSize), PrivilegeFilter: '0', page: String(query.page) }).toString()
    return parseKgSearch(await requestJson(fetcher, url.href, { signal: ctx.signal }), query)
  } }
}
