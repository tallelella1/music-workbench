import { z } from 'zod'
import type { AppError, RequestContext, Track, ProviderTrackRef } from './contracts'

export const SearchQuerySchema = z.strictObject({
  text: z.string().trim().min(1).max(200), page: z.number().int().min(1).max(10000),
  pageSize: z.number().int().min(1).max(50), authRevision: z.string().min(1).max(128)
})
export type SearchQuery = z.infer<typeof SearchQuerySchema>
export interface SearchPage { tracks: Track[]; total: number | null; nextPage: number | null }
export interface SearchProvider { id: string; search(query: SearchQuery, ctx: RequestContext): Promise<SearchPage> }
export type ProviderStatus = 'ok' | 'empty' | 'timeout' | 'rate-limited' | 'error'
export interface SearchResult { requestId: string; tracks: Track[]; providers: { providerId: string; status: ProviderStatus; error: AppError | null }[] }
export interface SearchSourceState {
  providerId: string; status: ProviderStatus | 'loading'; error: AppError | null
  tracks: Track[]; page: number; total: number | null; nextPage: number | null
}
export interface SearchSnapshot { requestId: string; tracks: Track[]; providers: SearchSourceState[] }
export interface SearchOptions { providerIds?: string[]; manualRetry?: boolean }
export interface PlaybackCapabilities { contractMajor: 1; platformIds: string[]; qualities: string[]; fullTrack: boolean; offlineEditable: boolean }
/** Host only: never a renderer DTO. */
export interface ResolvedAudio { url: string; headers: Record<string, string>; expiresAt: number | null; declaredQuality: string; preview: boolean | null; expectedDurationSeconds: number | null }
export interface PlaybackProvider { id: string; capabilities(): PlaybackCapabilities; resolve(ref: ProviderTrackRef, quality: string, ctx: RequestContext): Promise<ResolvedAudio> }
export const PlaybackOptionsSchema = z.strictObject({ quality: z.enum(['original', '128k', '320k', 'flac', 'flac24bit']), strict: z.boolean() })
export const PlaybackCapabilitiesSchema = z.strictObject({ contractMajor: z.literal(1), platformIds: z.array(z.string().min(1)).max(20), qualities: z.array(z.string().min(1)).max(10), fullTrack: z.boolean(), offlineEditable: z.boolean() })
export const ResolvedAudioSchema = z.strictObject({ url: z.url().max(2048).refine((url) => /^https?:\/\//.test(url) && !new URL(url).username && !new URL(url).password), headers: z.record(z.string().max(256), z.string().max(8192)), expiresAt: z.number().int().nonnegative().nullable(), declaredQuality: z.string().min(1).max(64), preview: z.boolean().nullable(), expectedDurationSeconds: z.number().finite().positive().nullable() })
