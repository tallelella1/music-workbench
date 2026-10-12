import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { MusicAppApi } from '../shared/contracts'
import { AppErrorSchema, AppEventSchema, IpcRequestSchema, IpcResponseSchema, JobSnapshotSchema, LibrarySnapshotSchema, PlaylistSchema, ImportResultSchema, AssetRecordSchema, type IpcRequest } from '../shared/schemas'
import { z } from 'zod'
import { AppSettingsSchema, SettingsPatchSchema } from '../shared/settings'
import { AppModuleSchema } from '../shared/app-modules'
import { PlaybackResourceSchema } from '../shared/player'
import { SearchResultSchema } from '../shared/schemas'
import { ExtensionManifestSchema } from '../shared/extensions'
import { ExportCapabilitiesSchema } from '../shared/audio-export'
import { AudioExportJobSchema } from '../shared/schemas'
const nullSchema = z.null()
function request(method: string, params: unknown): Promise<unknown> {
  return invoke(IpcRequestSchema.parse({ method, params, requestId: crypto.randomUUID() }))
}

async function invoke(request: IpcRequest): Promise<unknown> {
  const input = IpcRequestSchema.safeParse(request)
  if (!input.success) throw AppErrorSchema.parse({
    code: 'INVALID_REQUEST', message: '无效的请求', moduleId: 'preload', requestId: request.requestId
  })
  const response = IpcResponseSchema.parse(await ipcRenderer.invoke('music:request', input.data))
  // contextBridge drops custom Error properties; a rejected DTO retains the contract.
  if (!response.ok) throw response.error
  return response.result
}

const api: MusicAppApi = {
  library: {
    async list() { return LibrarySnapshotSchema.parse(await request('library.list', {})) },
    async importFiles() { return ImportResultSchema.parse(await request('library.importFiles', {})) },
    async importFolder() { return ImportResultSchema.parse(await request('library.importFolder', {})) },
    async importDroppedFiles(files) {
      if (!Array.isArray(files) || files.length > 10000) throw new TypeError('无效的文件列表')
      const paths = files.map((file) => webUtils.getPathForFile(file))
      if (paths.some((path) => !path)) throw new TypeError('只能导入本地文件')
      const tokens = z.array(z.string().uuid()).parse(await ipcRenderer.invoke('music:drop-files', paths))
      return ImportResultSchema.parse(await request('library.importDrop', { tokens }))
    },
    async setFavorite(trackId, favorite) { nullSchema.parse(await request('library.setFavorite', { trackId, favorite })) },
    async createPlaylist(name) { return PlaylistSchema.parse(await request('library.createPlaylist', { name })) },
    async updatePlaylist(id, trackIds) { nullSchema.parse(await request('library.updatePlaylist', { id, trackIds })) },
    async deletePlaylist(id) { nullSchema.parse(await request('library.deletePlaylist', { id })) },
    async removeTrack(id) { nullSchema.parse(await request('library.removeTrack', { id })) }
  }, search: {
    async run(query, requestId, options = {}) { return SearchResultSchema.parse(await invoke(IpcRequestSchema.parse({ method: 'search.run', requestId, params: { query, ...options } }))) },
    async cancel(requestId) { nullSchema.parse(await request('search.cancel', { requestId })) },
    async providers() { return z.array(z.string().min(1).max(256)).max(20).parse(await request('search.providers', {})) }
  }, playback: {
    async resolve(track, options, requestId) { return PlaybackResourceSchema.parse(await invoke(IpcRequestSchema.parse({ method: 'playback.resolve', requestId, params: { track, options } }))) },
    async cancel(requestId) { nullSchema.parse(await request('playback.cancel', { requestId })) }
  }, effects: {}, export: {
    async capabilities() { return ExportCapabilitiesSchema.parse(await request('export.capabilities', {})) },
    async start(edit, options) { return z.string().uuid().parse(await request('export.start', { edit, options })) },
    async preview(edit, requestId) { return AssetRecordSchema.parse(await invoke(IpcRequestSchema.parse({ method: 'export.preview', requestId, params: { edit } }))) },
    async cancelPreview(requestId) { nullSchema.parse(await request('export.cancelPreview', { requestId })) },
    async get(jobId) { return AudioExportJobSchema.parse(await request('export.get', { jobId })) }
  },
  jobs: {
    async get(jobId) {
      return JobSnapshotSchema.parse(await invoke({ method: 'jobs.get', requestId: crypto.randomUUID(), params: { jobId } }))
    },
    async cancel(jobId) {
      const result = await invoke({ method: 'jobs.cancel', requestId: crypto.randomUUID(), params: { jobId } })
      if (result !== null) throw new Error('无效的任务响应')
    }
  },
  settings: {
    async read() { return AppSettingsSchema.parse(await request('settings.read', {})) },
    async update(patch) { return AppSettingsSchema.parse(await request('settings.update', { patch: SettingsPatchSchema.parse(patch) })) }
  },
  modules: { async list() { return z.array(AppModuleSchema).parse(await request('modules.list', {})) } },
  extensions: {
    async list() { return z.array(ExtensionManifestSchema).max(20).parse(await request('extensions.list', {})) },
    async importScript() { return ExtensionManifestSchema.nullable().parse(await request('extensions.importScript', {})) },
    async enable(id, enabled) { nullSchema.parse(await request('extensions.enable', { id, enabled })) },
    async test(id, ref, quality, requestId) { return PlaybackResourceSchema.parse(await invoke(IpcRequestSchema.parse({ method: 'extensions.test', requestId, params: { id, ref, quality } }))) },
    async dispose(id) { nullSchema.parse(await request('extensions.dispose', { id })) }
  }, assets: {
    async get(assetId) { return AssetRecordSchema.parse(await request('assets.get', { assetId })) },
    url(assetId) { return `music-asset://asset/${z.string().uuid().parse(assetId)}` }
  },
  onEvent(listener) {
    if (typeof listener !== 'function') throw new TypeError('事件监听器必须是函数')
    const receive = (_event: Electron.IpcRendererEvent, input: unknown) => {
      const parsed = AppEventSchema.safeParse(input)
      if (parsed.success) listener(parsed.data)
    }
    ipcRenderer.on('music:event', receive)
    return () => { ipcRenderer.removeListener('music:event', receive) }
  }
}

contextBridge.exposeInMainWorld('musicApp', api)
