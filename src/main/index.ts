import { app, BrowserWindow, ipcMain, dialog, protocol } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { StorageRepository } from './storage/repository'
import { AssetRegistry } from './assets/asset-registry'
import { MediaResourceRegistry, assetResponse } from './assets/media-protocol'
import { LibraryService } from './library/library-service'
import { configureMediaRuntime } from './assets/media-probe'
import { pathToFileURL } from 'node:url'
import { createIpcRouter, type LibraryHost } from './ipc'
import { TaskService } from './jobs/task-service'
import { AppErrorSchema, AppEventSchema, IpcRequestSchema } from '../shared/schemas'
import { SearchService } from './search/search-service'
import { defaultSearchRegistry } from './providers/registry'
import { PlaybackResolver } from './playback/resolver'
import { LXHost } from './extensions/lx-host'
import { AudioExportService } from './export/audio-export-service'
import { SettingsService } from './settings/settings-service'
import { builtInModules } from '../shared/app-modules'

let mainWindow: BrowserWindow | null = null
let rendererUrl = ''
let quitting = false
let drained = false
if (process.env.MUSIC_APP_USER_DATA_DIR) app.setPath('userData', process.env.MUSIC_APP_USER_DATA_DIR)
protocol.registerSchemesAsPrivileged(['music-asset', 'media'].map((scheme) => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } })))
configureMediaRuntime(app.isPackaged ? join(process.resourcesPath, 'resources') : join(__dirname, '../../resources'))
const repository = new StorageRepository(app.getPath('userData'))
const settings = new SettingsService(repository)
const assets = new AssetRegistry(repository, join(app.getPath('userData'), 'artwork'))
const media = new MediaResourceRegistry(assets)
const library = new LibraryService(repository, assets)
const droppedPaths = new Map<string, { path: string; expires: number }>()

const tasks = new TaskService((event) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('music:event', AppEventSchema.parse(event))
})
const registry = defaultSearchRegistry()
const search = new SearchService(registry, (snapshot) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('music:event', AppEventSchema.parse({ type: 'search.updated', contractVersion: 1, requestId: snapshot.requestId, resourceId: snapshot.requestId, payload: snapshot }))
})
const resolver = new PlaybackResolver(registry, media, { candidates: async (track, ctx) => {
  const result = await search.search({ text: `${track.title} ${track.artists.join(' ')}`, page: 1, pageSize: 20, authRevision: '0' }, ctx)
  return result.tracks
} })
const extensions = new LXHost(app.getPath('userData'), registry, resolver)
const acceptedRequests = new Set<Promise<unknown>>()
let settingsWork: Promise<void> = Promise.resolve()
function applySettings(): Promise<void> {
  settingsWork = settingsWork.catch(() => {}).then(async () => {
    const value = await settings.read(); registry.configure(value.sourceOrder, value.enabledSources)
    for (const source of await extensions.list()) {
      if (quitting) return
      const enabled = value.enabledSources.includes(source.id)
      if (enabled !== source.enabled) await extensions.enable(source.id, enabled).catch(() => {}) // LXHost records concrete initialization failure; preference remains intact.
    }
  })
  return settingsWork
}
const exporter = new AudioExportService(assets, tasks, join(app.getPath('userData'), 'derived-audio'), async options => {
  if (!mainWindow) throw new Error('窗口尚未准备好')
  const result = await dialog.showSaveDialog(mainWindow, { title: '保存音频成品', defaultPath: `音频成品.${options.format}`, filters: [{ name: options.format.toUpperCase(), extensions: [options.format] }] })
  return result.canceled ? null : result.filePath ?? null
})
function requestQuit(): void {
  if (quitting) return
  quitting = true
  route.shutdown()
  void Promise.allSettled([extensions.shutdown(), exporter.shutdown(), tasks.shutdown(), settingsWork, ...acceptedRequests]).then(async outcomes => {
    for (const outcome of outcomes) if (outcome.status === 'rejected') console.error('Application shutdown failed', outcome.reason)
    // Accepted IPC may still enqueue an asset/index transaction after async IO.
    // Drain those operations first, then seal storage against any later producer.
    await repository.close().catch(error => console.error('Storage shutdown failed', error))
    drained = true
    app.quit()
  })
}
const libraryHost: LibraryHost = {
  library, assets, media, resolver, extensions, exporter, settings, applySettings, modules: builtInModules(), capabilities: ['local-library', 'local-audio-editor'],
  async chooseScript() {
    if (!mainWindow) throw new Error('窗口尚未准备好')
    const result = await dialog.showOpenDialog(mainWindow, { title: '导入 LX 音源脚本', properties: ['openFile'], filters: [{ name: 'LX JavaScript', extensions: ['js'] }] })
    return result.canceled ? null : result.filePaths[0] ?? null
  },
  async choosePaths(folder) {
    if (!mainWindow) throw new Error('窗口尚未准备好')
    const result = await dialog.showOpenDialog(mainWindow, { title: folder ? '导入音乐文件夹' : '导入本地音乐', properties: folder ? ['openDirectory'] : ['openFile', 'multiSelections'], filters: folder ? [] : [{ name: '音频文件', extensions: ['wav', 'mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'aiff', 'wma'] }] })
    return result.canceled ? [] : result.filePaths
  },
  consumeDropTokens(tokens) {
    const now = Date.now()
    const paths = tokens.map((token) => { const entry = droppedPaths.get(token); if (!entry || entry.expires < now) throw new Error('拖入文件已过期'); return entry.path })
    for (const token of tokens) droppedPaths.delete(token)
    return paths
  }
}

// Only preload obtains these paths from Electron File objects. Renderer gets opaque tokens.
ipcMain.handle('music:drop-files', (event, input: unknown) => {
  if (quitting) throw new Error('应用正在关闭，拒绝新请求')
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== rendererUrl) throw new Error('请求来源未获授权')
  const paths = z.array(z.string().min(1).max(32767)).max(10000).parse(input)
  const now = Date.now()
  for (const [token, entry] of droppedPaths) if (entry.expires < now) droppedPaths.delete(token)
  return paths.map((path) => { const token = randomUUID(); droppedPaths.set(token, { path, expires: now + 60000 }); return token })
})
const route = createIpcRouter(tasks, () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null
  return { webContents: mainWindow.webContents, frame: mainWindow.webContents.mainFrame, url: rendererUrl }
}, libraryHost, search)

ipcMain.handle('music:request', async (event, input: unknown) => {
  try {
    if (quitting) throw new Error('应用正在关闭，拒绝新请求')
    const work = route({ webContents: event.sender, frame: event.senderFrame, url: event.senderFrame?.url ?? '' }, input)
    acceptedRequests.add(work)
    try { return { ok: true, result: await work } }
    finally { acceptedRequests.delete(work) }
  } catch (error) {
    const request = IpcRequestSchema.safeParse(input)
    return { ok: false, error: AppErrorSchema.parse({
      code: 'IPC_REQUEST_REJECTED', message: error instanceof Error ? error.message : '请求失败',
      moduleId: 'ipc', requestId: request.success ? request.data.requestId : null
    }) }
  }
})

function createWindow(): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(devUrl).hostname)) {
    throw new Error('开发界面必须来自本机')
  }
  rendererUrl = devUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href
  const window = new BrowserWindow({
    width: 1320, height: 860, minWidth: 980, minHeight: 660,
    title: '音乐工作台', backgroundColor: '#fafafa', show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true, contextIsolation: true, nodeIntegration: false
    }
  })
  mainWindow = window
  window.on('close', event => { if (!drained) { event.preventDefault(); requestQuit() } })
  window.setMenuBarVisibility(false)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) event.preventDefault()
  })
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.url !== rendererUrl) event.preventDefault()
  })
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow !== window) return
    mainWindow = null
    if (process.platform !== 'darwin') app.quit()
  })
  void window.loadURL(rendererUrl)
}

void app.whenReady().then(async () => {
  void exporter.capabilities().catch(() => {}) // Probe bundled runtime at startup; failures remain visible in editor.
  protocol.handle('media', (request) => media.handle(request, new URL(rendererUrl).origin))
  protocol.handle('music-asset', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'asset' || url.search || url.hash || request.method !== 'GET') return new Response(null, { status: 400 })
      const id = z.string().uuid().parse(url.pathname.slice(1))
      const asset = await assets.get(id)
      return assetResponse(assets, asset, request, new URL(rendererUrl).origin)
    } catch { return new Response(null, { status: 404 }) }
  })
  createWindow()
  // Keep the local UI alive before source sandboxes can fail/close, and do not
  // hold local playback/editor startup behind each source's external watchdog.
  void applySettings().catch(error => console.error('Settings startup failed', error))
  app.on('activate', () => { if (!quitting && BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', event => { if (!drained) { event.preventDefault(); requestQuit() } })
