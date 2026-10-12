import { z } from 'zod'
import { SearchQuerySchema, PlaybackOptionsSchema } from './providers'
import { AudioEditSchema, AudioExportOptionsSchema, SourceTimeMapSchema, AudioExportResultSchema } from './audio-export'
import { SettingsPatchSchema } from './settings'

const identifier = z.string().trim().min(1).max(256)
const nonnegative = z.number().finite().nonnegative()
const positiveInteger = z.number().int().positive()

export const ProviderTrackRefSchema = z.strictObject({
  providerId: identifier,
  songId: identifier,
  identity: z.record(z.string(), z.union([z.string(), z.number().finite(), z.null()]))
})
export const TrackSchema = z.strictObject({
  id: identifier,
  title: z.string().min(1),
  artists: z.array(z.string().min(1)),
  album: z.string().nullable(),
  version: z.enum(['studio', 'live', 'cover', 'instrumental', 'remix', 'unknown']),
  versionDisplay: z.string().nullable().default(null),
  durationSeconds: nonnegative.nullable(),
  artworkAssetId: identifier.nullable(),
  audioAssetId: identifier.nullable(),
  sources: z.array(ProviderTrackRefSchema)
})
export const MediaProbeSchema = z.strictObject({
  durationSeconds: nonnegative.nullable(),
  durationReliable: z.boolean(),
  codec: z.string().min(1),
  sampleRate: positiveInteger.nullable(),
  channels: positiveInteger.nullable(),
  bitDepth: positiveInteger.nullable(),
  bitrate: nonnegative.nullable(),
  width: positiveInteger.nullable(),
  height: positiveInteger.nullable()
}).refine((probe) => !probe.durationReliable || probe.durationSeconds !== null, {
  message: 'Reliable duration requires a measured duration', path: ['durationSeconds']
})
export const AssetRecordSchema = z.strictObject({
  id: identifier,
  kind: z.enum(['audio', 'image']),
  hash: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  media: MediaProbeSchema,
  parentAssetId: identifier.nullable(),
  sourceTimeMap: SourceTimeMapSchema.optional()
})
export const TimeRangeSchema = z.strictObject({
  startSeconds: nonnegative,
  endSeconds: nonnegative
}).refine((range) => range.startSeconds < range.endSeconds, {
  message: 'End must follow start', path: ['endSeconds']
})
// The asset-owning service also checks endSeconds <= measured duration.
export const AppErrorSchema = z.strictObject({
  code: identifier,
  message: z.string().min(1),
  moduleId: identifier,
  requestId: identifier.nullable()
})
export const JobSnapshotSchema = z.strictObject({
  id: identifier,
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']),
  progress: z.number().finite().min(0).max(1).nullable(),
  result: z.unknown().nullable(),
  error: AppErrorSchema.nullable()
})
export const AudioExportJobSchema = JobSnapshotSchema.extend({ result: AudioExportResultSchema.nullable() })
const JobEventSchema = z.strictObject({
  type: z.literal('jobs.updated'),
  contractVersion: z.literal(1),
  resourceId: identifier,
  requestId: identifier,
  payload: JobSnapshotSchema
})
export const SearchPageSchema = z.strictObject({ tracks: z.array(TrackSchema).max(200), total: z.number().int().nonnegative().nullable(), nextPage: positiveInteger.nullable() })
const providerStatus = z.enum(['ok', 'empty', 'timeout', 'rate-limited', 'error'])
export const SearchResultSchema = z.strictObject({ requestId: identifier, tracks: z.array(TrackSchema).max(1000), providers: z.array(z.strictObject({ providerId: identifier, status: providerStatus, error: AppErrorSchema.nullable() })).max(20) })
export const SearchSnapshotSchema = z.strictObject({ requestId: identifier, tracks: z.array(TrackSchema).max(1000), providers: z.array(z.strictObject({ providerId: identifier, status: z.enum(['loading', 'ok', 'empty', 'timeout', 'rate-limited', 'error']), error: AppErrorSchema.nullable(), tracks: z.array(TrackSchema).max(200), page: positiveInteger, total: z.number().int().nonnegative().nullable(), nextPage: positiveInteger.nullable() })).max(20) })
export const SearchEventSchema = z.strictObject({ type: z.literal('search.updated'), contractVersion: z.literal(1), resourceId: identifier, requestId: identifier, payload: SearchSnapshotSchema })
export const AppEventSchema = z.discriminatedUnion('type', [JobEventSchema, SearchEventSchema])
const jobParams = z.strictObject({ jobId: identifier })
const emptyParams = z.strictObject({})
export const IpcRequestSchema = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('settings.read'), requestId: identifier, params: emptyParams }),
  z.strictObject({ method: z.literal('settings.update'), requestId: identifier, params: z.strictObject({ patch: SettingsPatchSchema }) }),
  z.strictObject({ method: z.literal('modules.list'), requestId: identifier, params: emptyParams }),
  z.strictObject({ method: z.literal('export.capabilities'), requestId: identifier, params: emptyParams }),
  z.strictObject({ method: z.literal('export.start'), requestId: identifier, params: z.strictObject({ edit: AudioEditSchema, options: AudioExportOptionsSchema }) }),
  z.strictObject({ method: z.literal('export.preview'), requestId: identifier, params: z.strictObject({ edit: AudioEditSchema }) }),
  z.strictObject({ method: z.literal('export.cancelPreview'), requestId: identifier, params: z.strictObject({ requestId: identifier }) }),
  z.strictObject({ method: z.literal('export.get'), requestId: identifier, params: jobParams }),
  z.strictObject({ method: z.literal('extensions.list'), requestId: identifier, params: emptyParams }),
  z.strictObject({ method: z.literal('extensions.importScript'), requestId: identifier, params: emptyParams }),
  z.strictObject({ method: z.literal('extensions.enable'), requestId: identifier, params: z.strictObject({ id: z.string().uuid(), enabled: z.boolean() }) }),
  z.strictObject({ method: z.literal('extensions.dispose'), requestId: identifier, params: z.strictObject({ id: z.string().uuid() }) }),
  z.strictObject({ method: z.literal('extensions.test'), requestId: identifier, params: z.strictObject({ id: z.string().uuid(), ref: ProviderTrackRefSchema, quality: identifier }) }),
  z.strictObject({ method: z.literal('search.run'), requestId: identifier, params: z.strictObject({ query: SearchQuerySchema, providerIds: z.array(identifier).max(20).optional(), manualRetry: z.boolean().optional() }) }),
  z.strictObject({ method: z.literal('search.cancel'), requestId: identifier, params: z.strictObject({ requestId: identifier }) }),
  z.strictObject({ method: z.literal('search.providers'), requestId: identifier, params: emptyParams }),
  z.strictObject({ method: z.literal('playback.resolve'), requestId: identifier, params: z.strictObject({ track: TrackSchema, options: PlaybackOptionsSchema }) }),
  z.strictObject({ method: z.literal('playback.cancel'), requestId: identifier, params: z.strictObject({ requestId: identifier }) }),
  z.strictObject({ method: z.literal('jobs.get'), requestId: identifier, params: jobParams }),
  z.strictObject({ method: z.literal('jobs.cancel'), requestId: identifier, params: jobParams }),
  z.strictObject({ method: z.literal('library.list'), requestId: identifier, params: emptyParams }),
  z.strictObject({ method: z.literal('library.importFiles'), requestId: identifier, params: emptyParams }),
  z.strictObject({ method: z.literal('library.importFolder'), requestId: identifier, params: emptyParams }),
  z.strictObject({ method: z.literal('library.importDrop'), requestId: identifier, params: z.strictObject({ tokens: z.array(z.string().uuid()).max(10000) }) }),
  z.strictObject({ method: z.literal('library.setFavorite'), requestId: identifier, params: z.strictObject({ trackId: identifier, favorite: z.boolean() }) }),
  z.strictObject({ method: z.literal('library.createPlaylist'), requestId: identifier, params: z.strictObject({ name: z.string().trim().min(1).max(100) }) }),
  z.strictObject({ method: z.literal('library.updatePlaylist'), requestId: identifier, params: z.strictObject({ id: identifier, trackIds: z.array(identifier).max(100000) }) }),
  z.strictObject({ method: z.literal('library.deletePlaylist'), requestId: identifier, params: z.strictObject({ id: identifier }) }),
  z.strictObject({ method: z.literal('library.removeTrack'), requestId: identifier, params: z.strictObject({ id: identifier }) }),
  z.strictObject({ method: z.literal('assets.get'), requestId: identifier, params: z.strictObject({ assetId: z.string().uuid() }) })
])
export type IpcRequest = z.infer<typeof IpcRequestSchema>
export const IpcResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), result: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: AppErrorSchema })
])
export const PlaylistSchema = z.strictObject({ id: z.string().min(1).max(256), name: z.string().trim().min(1).max(100), trackIds: z.array(z.string().min(1).max(256)).max(100000) })
export const LibrarySnapshotSchema = z.strictObject({ schemaVersion: z.literal(1), tracks: z.array(TrackSchema), favorites: z.array(z.string().min(1)), playlists: z.array(PlaylistSchema) }).superRefine((library, ctx) => {
  const ids = new Set(library.tracks.map((track) => track.id))
  if (ids.size !== library.tracks.length || new Set(library.playlists.map((playlist) => playlist.id)).size !== library.playlists.length) ctx.addIssue({ code: 'custom', message: '重复标识' })
  if ([...library.favorites, ...library.playlists.flatMap((playlist) => playlist.trackIds)].some((id) => !ids.has(id))) ctx.addIssue({ code: 'custom', message: '曲目引用无效' })
})
export const ImportResultSchema = z.strictObject({ tracks: z.array(TrackSchema), errors: z.array(AppErrorSchema) })
