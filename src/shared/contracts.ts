export interface RequestContext { requestId: string; signal: AbortSignal }
export interface TimeRange { startSeconds: number; endSeconds: number }
export type TrackVersion = 'studio' | 'live' | 'cover' | 'instrumental' | 'remix' | 'unknown'
export interface ProviderTrackRef {
  providerId: string
  songId: string
  /** Original provider fields, including the display version, stay here. */
  identity: Record<string, string | number | null>
}
export interface Track {
  id: string
  title: string
  artists: string[]
  album: string | null
  version: TrackVersion
  /** Raw explicit version label or title tag; null means no preserved evidence. */
  versionDisplay: string | null
  durationSeconds: number | null
  artworkAssetId: string | null
  audioAssetId: string | null
  sources: ProviderTrackRef[]
}
export interface MediaProbe {
  durationSeconds: number | null
  durationReliable: boolean
  codec: string
  sampleRate: number | null
  channels: number | null
  bitDepth: number | null
  bitrate: number | null
  width: number | null
  height: number | null
}
export interface AssetRecord {
  id: string
  kind: 'audio' | 'image'
  hash: string
  byteLength: number
  media: MediaProbe
  parentAssetId: string | null
  sourceTimeMap?: import('./audio-export').SourceTimeMap
}
export interface AppError { code: string; message: string; moduleId: string; requestId: string | null }
export interface JobSnapshot<T> {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number | null
  result: T | null
  error: AppError | null
}
interface JobEvent {
  type: 'jobs.updated'
  contractVersion: 1
  resourceId: string
  requestId: string
  payload: JobSnapshot<unknown>
}
export type AppEvent = JobEvent | { type: 'search.updated'; contractVersion: 1; resourceId: string; requestId: string; payload: import('./providers').SearchSnapshot }
export interface MusicAppApi {
  library: {
    list(): Promise<import('./library').LibrarySnapshot>
    importFiles(): Promise<import('zod').infer<typeof import('./schemas').ImportResultSchema>>
    importFolder(): Promise<import('zod').infer<typeof import('./schemas').ImportResultSchema>>
    importDroppedFiles(files: File[]): Promise<import('zod').infer<typeof import('./schemas').ImportResultSchema>>
    setFavorite(trackId: string, favorite: boolean): Promise<void>
    createPlaylist(name: string): Promise<import('./library').Playlist>
    updatePlaylist(id: string, trackIds: string[]): Promise<void>
    deletePlaylist(id: string): Promise<void>
    removeTrack(id: string): Promise<void>
  }
  search: {
    run(query: import('./providers').SearchQuery, requestId: string, options?: import('./providers').SearchOptions): Promise<import('./providers').SearchResult>
    cancel(requestId: string): Promise<void>
    providers(): Promise<string[]>
  }
  playback: {
    resolve(track: Track, options: { quality: string; strict: boolean }, requestId: string): Promise<import('./player').PlaybackResource>
    cancel(requestId: string): Promise<void>
  }
  effects: Record<string, never>
  export: {
    capabilities(): Promise<import('./audio-export').ExportCapabilities>
    start(edit: import('./audio-export').AudioEdit, options: import('./audio-export').AudioExportOptions): Promise<string>
    preview(edit: import('./audio-export').AudioEdit, requestId: string): Promise<AssetRecord>
    cancelPreview(requestId: string): Promise<void>
    get(jobId: string): Promise<import('zod').infer<typeof import('./schemas').AudioExportJobSchema>>
  }
  jobs: {
    get(jobId: string): Promise<JobSnapshot<unknown>>
    cancel(jobId: string): Promise<void>
  }
  settings: { read(): Promise<import('./settings').AppSettings>; update(patch: import('./settings').SettingsPatch): Promise<import('./settings').AppSettings> }
  modules: { list(): Promise<import('./app-modules').AppModule[]> }
  extensions: {
    list(): Promise<import('./extensions').ExtensionManifest[]>
    importScript(): Promise<import('./extensions').ExtensionManifest | null>
    enable(id: string, enabled: boolean): Promise<void>
    test(id: string, ref: ProviderTrackRef, quality: string, requestId: string): Promise<import('./player').PlaybackResource>
    dispose(id: string): Promise<void>
  }
  assets: { get(assetId: string): Promise<AssetRecord>; url(assetId: string): string }
  onEvent(listener: (event: AppEvent) => void): () => void
}

declare global { interface Window { musicApp: MusicAppApi } }
