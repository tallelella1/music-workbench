import { z } from 'zod'
import type { Track } from '../../shared/contracts'
import type { ProviderStatus, SearchPage, SearchQuery } from '../../shared/providers'
import { inferTrackVersion } from '../../shared/track-version'

export class ProviderFailure extends Error {
  constructor(readonly status: Exclude<ProviderStatus, 'ok' | 'empty'>, message: string) { super(message) }
}
export const songIdSchema = z.union([z.string().trim().min(1), z.number().finite().int().nonnegative()])
export const artistSchema = z.array(z.object({ name: z.string().trim().min(1) })).min(1)
export function duration(value: unknown, scale = 1): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value / scale : null
}
export function identityValue(value: unknown): string | number | null {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : null
}
export function track(providerId: string, songId: string | number, title: string, artists: string[], album: unknown, seconds: number | null, identity: Track['sources'][number]['identity'], label?: string): Track {
  const evidence = inferTrackVersion(title, label ? [label] : [])
  return { id: `${providerId}:${songId}`, title, artists, album: typeof album === 'string' && album ? album : null,
    ...evidence, versionDisplay: label || evidence.versionDisplay, durationSeconds: seconds, artworkAssetId: null, audioAssetId: null,
    sources: [{ providerId, songId: String(songId), identity }] }
}
export function searchPage(tracks: Track[], totalValue: unknown, rawCount: number, query: SearchQuery): SearchPage {
  const total = typeof totalValue === 'number' && Number.isSafeInteger(totalValue) && totalValue >= 0 ? totalValue : null
  return { tracks, total, nextPage: total === null ? rawCount >= query.pageSize ? query.page + 1 : null : query.page * query.pageSize < total ? query.page + 1 : null }
}
export function decodeName(value: string): string {
  const names: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (original, name: string) => {
    if (!name.startsWith('#')) return names[name.toLowerCase()] ?? original
    const code = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10)
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : original
  })
}
const transportWork = new WeakMap<AbortSignal, Set<Promise<unknown>>>()
export const hostSearchFetch: typeof fetch = (input, init) => globalThis.fetch(input, init)
/** Drain host-owned fetch/body cleanup without joining an uncooperative provider. */
export async function waitForSearchCleanup(signal: AbortSignal): Promise<void> {
  await Promise.allSettled([...(transportWork.get(signal) ?? [])])
}
export function requestJson(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const pending = readJson(fetcher, url, init)
  if (!init.signal || fetcher !== hostSearchFetch) return pending
  const signal = init.signal
  let work = transportWork.get(signal)
  if (!work) { work = new Set(); transportWork.set(signal, work) }
  work.add(pending)
  return pending.finally(() => work.delete(pending))
}
async function readJson(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  init.signal?.throwIfAborted()
  let response: Response | undefined
  try {
    response = await fetcher(url, { ...init, redirect: 'error' })
    if (response.status === 429) throw new ProviderFailure('rate-limited', '来源请求过于频繁，请稍后重试')
    if (!response.ok) throw new ProviderFailure('error', `来源响应失败（HTTP ${response.status}）`)
    const text = await response.text()
    init.signal?.throwIfAborted()
    if (text.length > 4_000_000) throw new ProviderFailure('error', '来源响应过大')
    try { return JSON.parse(text) } catch { throw new ProviderFailure('error', '来源响应不是有效 JSON') }
  } catch (error) {
    init.signal?.throwIfAborted()
    if (error instanceof ProviderFailure) throw error
    throw new ProviderFailure('error', '无法连接来源，请重试')
  } finally { await response?.body?.cancel().catch(() => {}) }
}
