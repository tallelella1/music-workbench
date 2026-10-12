import { IpcRequestSchema, JobSnapshotSchema, LibrarySnapshotSchema, PlaylistSchema, ImportResultSchema, AssetRecordSchema } from '../shared/schemas'
import type { TaskService } from './jobs/task-service'
import type { LibraryService } from './library/library-service'
import type { AssetRegistry } from './assets/asset-registry'
import type { MediaResourceRegistry } from './assets/media-protocol'
import { PlaybackResourceSchema } from '../shared/player'
import { SearchResultSchema } from '../shared/schemas'
import type { SearchService } from './search/search-service'
import type { PlaybackResolver } from './playback/resolver'
import type { LXHost } from './extensions/lx-host'
import { ExtensionManifestSchema } from '../shared/extensions'
import type { AudioExportService } from './export/audio-export-service'
import { ExportCapabilitiesSchema } from '../shared/audio-export'
import { AudioExportJobSchema } from '../shared/schemas'
import { z } from 'zod'
import type { SettingsService } from './settings/settings-service'
import { AppSettingsSchema } from '../shared/settings'
import { AppModuleSchema, type AppModuleRegistry } from '../shared/app-modules'
export interface LibraryHost {
  library: LibraryService
  assets: AssetRegistry
  media?: MediaResourceRegistry
  choosePaths(folder: boolean): Promise<string[]>
  consumeDropTokens(tokens: string[]): string[]
  resolver?: PlaybackResolver
  extensions?: LXHost
  chooseScript?(): Promise<string | null>
  exporter?: AudioExportService
  settings?: SettingsService
  modules?: AppModuleRegistry
  capabilities?: string[]
  applySettings?(): Promise<void>
}

/** Electron supplies these object identities; renderer input never supplies them. */
export interface IpcSender { webContents: object; frame: object | null; url: string }

export function createIpcRouter(tasks: TaskService, getTrustedSender: () => IpcSender | null, host?: LibraryHost, search?: SearchService) {
  const playbackRequests = new Map<string, AbortController>()
  const searchRequests = new Map<string, AbortController>()
  const previewRequests = new Map<string, AbortController>()
  const exportJobs = new Set<string>()
  let closing = false
  const route = async (sender: IpcSender, input: unknown): Promise<unknown> => {
    if (closing) throw new Error('应用正在关闭，拒绝新请求')
    const trusted = getTrustedSender()
    if (!trusted || sender.webContents !== trusted.webContents || !sender.frame ||
        sender.frame !== trusted.frame || sender.url !== trusted.url) {
      throw new Error('请求来源未获授权')
    }
    const parsed = IpcRequestSchema.safeParse(input)
    if (!parsed.success) throw new Error('无效的请求')
    const request = parsed.data
    const ctx = { requestId: request.requestId, signal: new AbortController().signal }
    if (!request.method.startsWith('jobs.') && !request.method.startsWith('search.') && !host) throw new Error('曲库尚未初始化')
    switch (parsed.data.method) {
      case 'settings.read': if (!host?.settings) throw new Error('设置尚未初始化'); return AppSettingsSchema.parse(await host.settings.read())
      case 'settings.update': {
        if (!host?.settings) throw new Error('设置尚未初始化')
        const value = await host.settings.update(parsed.data.params.patch)
        if (parsed.data.params.patch.sourceOrder || parsed.data.params.patch.enabledSources) await host.applySettings?.()
        return AppSettingsSchema.parse(value)
      }
      case 'modules.list': return (host?.modules?.list(host.capabilities ?? []) ?? []).map(module => AppModuleSchema.parse(module))
      case 'export.capabilities': if (!host?.exporter) throw new Error('导出尚未初始化'); return ExportCapabilitiesSchema.parse(await host.exporter.capabilities())
      case 'export.start': {
        if (!host?.exporter) throw new Error('导出尚未初始化')
        const id = z.string().uuid().parse(await host.exporter.start(parsed.data.params.edit, parsed.data.params.options, ctx)); exportJobs.add(id); return id
      }
      case 'export.get': if (!exportJobs.has(parsed.data.params.jobId)) throw new Error('找不到导出任务'); return AudioExportJobSchema.parse(tasks.get(parsed.data.params.jobId))
      case 'export.cancelPreview': previewRequests.get(parsed.data.params.requestId)?.abort(); return null
      case 'export.preview': {
        if (!host?.exporter) throw new Error('导出尚未初始化')
        if (previewRequests.has(request.requestId) || previewRequests.size >= 4) throw new Error('预览请求重复或过多')
        const abort = new AbortController(); previewRequests.set(request.requestId, abort)
        try { return AssetRecordSchema.parse(await host.exporter.renderPreview(parsed.data.params.edit, { requestId: request.requestId, signal: abort.signal })) }
        finally { previewRequests.delete(request.requestId) }
      }
      case 'extensions.list': if (!host?.extensions) throw new Error('音源宿主尚未初始化'); return (await host.extensions.list()).map((manifest) => ExtensionManifestSchema.parse(manifest))
      case 'extensions.importScript': {
        if (!host?.extensions || !host.chooseScript) throw new Error('音源宿主尚未初始化')
        const path = await host.chooseScript(); if (!path) return null
        const before = await host.extensions.list()
        const manifest = ExtensionManifestSchema.parse(await host.extensions.importScript(path, ctx))
        if (host.settings) { const after = await host.extensions.list(); const replaced = before.filter(source => source.enabled && after.some(current => current.id === source.id && !current.enabled)).map(source => source.id); await host.settings.rememberImportedSource(manifest.id, replaced); await host.applySettings?.() }
        return manifest
      }
      case 'extensions.enable': {
        if (!host?.extensions) throw new Error('音源宿主尚未初始化')
        const { id, enabled } = parsed.data.params
        if (host.settings) await host.settings.setSourceEnabled(id, enabled)
        await host.extensions.enable(id, enabled); await host.applySettings?.(); return null
      }
      case 'extensions.dispose': if (!host?.extensions) throw new Error('音源宿主尚未初始化'); await host.extensions.dispose(parsed.data.params.id); return null
      case 'extensions.test': {
        if (!host?.extensions) throw new Error('音源宿主尚未初始化')
        if (playbackRequests.has(request.requestId) || playbackRequests.size >= 20) throw new Error('播放请求重复或过多')
        const abort = new AbortController(); playbackRequests.set(request.requestId, abort)
        try { return PlaybackResourceSchema.parse(await host.extensions.test(parsed.data.params.id, parsed.data.params.ref, parsed.data.params.quality, { requestId: request.requestId, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]) })) }
        finally { playbackRequests.delete(request.requestId) }
      }
      case 'search.providers': if (!search) throw new Error('搜索尚未初始化'); return search.providerIds()
      case 'search.cancel': searchRequests.get(parsed.data.params.requestId)?.abort(); return null
      case 'search.run': {
        if (!search) throw new Error('搜索尚未初始化')
        if (searchRequests.has(request.requestId)) throw new Error('重复搜索请求')
        if (searchRequests.size >= 20) throw new Error('搜索请求过多')
        const abort = new AbortController(); searchRequests.set(request.requestId, abort)
        try { return SearchResultSchema.parse(await search.search(parsed.data.params.query, { requestId: request.requestId, signal: abort.signal }, { providerIds: parsed.data.params.providerIds, manualRetry: parsed.data.params.manualRetry })) }
        finally { searchRequests.delete(request.requestId) }
      }
      case 'playback.cancel': playbackRequests.get(parsed.data.params.requestId)?.abort(); return null
      case 'playback.resolve': {
        const trackId = parsed.data.params.track.id
        if (!host!.media) throw new Error('播放器尚未初始化')
        if (playbackRequests.has(request.requestId) || playbackRequests.size >= 20) throw new Error('播放请求重复或过多')
        const abort = new AbortController(); playbackRequests.set(request.requestId, abort)
        try {
          const track = (await host!.library.list()).tracks.find((value) => value.id === trackId)
          abort.signal.throwIfAborted()
          const selected = track ?? parsed.data.params.track
          if (!track && selected.audioAssetId) throw new Error('本地歌曲已移除，请重新导入')
          const resource = host!.resolver ? await host!.resolver.resolve(selected, parsed.data.params.options, { requestId: request.requestId, signal: abort.signal })
            : track?.audioAssetId ? await host!.media.issueLocal(track.audioAssetId) : (() => { throw new Error('此歌曲没有本地音频，请导入音乐') })()
          abort.signal.throwIfAborted()
          return PlaybackResourceSchema.parse(resource)
        } finally { playbackRequests.delete(request.requestId) }
      }
      case 'jobs.get': return JobSnapshotSchema.parse(tasks.get(parsed.data.params.jobId))
      case 'jobs.cancel': tasks.cancel(parsed.data.params.jobId); return null
      case 'library.list': return LibrarySnapshotSchema.parse(await host!.library.list())
      case 'library.importFiles': return ImportResultSchema.parse(await host!.library.importPaths(await host!.choosePaths(false), ctx))
      case 'library.importFolder': return ImportResultSchema.parse(await host!.library.importPaths(await host!.choosePaths(true), ctx))
      case 'library.importDrop': return ImportResultSchema.parse(await host!.library.importPaths(host!.consumeDropTokens(parsed.data.params.tokens), ctx))
      case 'library.setFavorite': await host!.library.setFavorite(parsed.data.params.trackId, parsed.data.params.favorite); return null
      case 'library.createPlaylist': return PlaylistSchema.parse(await host!.library.createPlaylist(parsed.data.params.name))
      case 'library.updatePlaylist': await host!.library.updatePlaylist(parsed.data.params.id, parsed.data.params.trackIds); return null
      case 'library.deletePlaylist': await host!.library.deletePlaylist(parsed.data.params.id); return null
      case 'library.removeTrack': await host!.library.removeTrack(parsed.data.params.id); return null
      case 'assets.get': return AssetRecordSchema.parse(await host!.assets.get(parsed.data.params.assetId))
    }
  }
  return Object.assign(route, { shutdown(): void {
    closing = true
    for (const requests of [playbackRequests, searchRequests, previewRequests]) {
      for (const controller of requests.values()) controller.abort()
    }
  } })
}
