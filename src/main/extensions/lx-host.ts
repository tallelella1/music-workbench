import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { ExtensionManifestSchema, LXInitSchema, LXMessageSchema, LXNetworkSchema, LXScriptInfoSchema, type ExtensionManifest } from '../../shared/extensions'
import type { ProviderTrackRef, RequestContext, Track } from '../../shared/contracts'
import type { PlaybackResource } from '../../shared/player'
import type { ResolvedAudio } from '../../shared/providers'
import { ProviderTrackRefSchema } from '../../shared/schemas'
import type { ProviderRegistry } from '../providers/registry'
import type { PlaybackResolver } from '../playback/resolver'
import { atomicWrite } from '../storage/repository'
import { lxNetwork } from './lx-network'
import { checkCompleteness, actualQualityMeets } from '../playback/completeness'

type ScriptInfo = z.infer<typeof LXScriptInfoSchema>
type SourceMap = Record<string, z.infer<typeof LXInitSchema>['sources'][string]>
interface Pending { done(value: string): void; fail(error: Error): void }
interface Entry { manifest: ExtensionManifest; script: ScriptInfo; window: BrowserWindow | null; sources: SourceMap; pending: Map<string, Pending>; network: Map<string, AbortController>; init?: { done(): void; fail(error: Error): void } }
const storedSchema = z.array(z.strictObject({ manifest: ExtensionManifestSchema, script: LXScriptInfoSchema })).max(20)
const platformIds = ['wy', 'kg', 'tx', 'kw', 'mg'] as const
const qualities = ['128k', '320k', 'flac', 'flac24bit'] as const
export function lxMusicInfo(ref: ProviderTrackRef): Record<string, unknown> {
  const identity = ref.identity
  const pick = (...names: string[]) => names.map((name) => identity[name]).find((value) => value !== null && value !== undefined)
  const info: Record<string, unknown> = { name: pick('originalTitle', 'name') ?? '', singer: pick('singer') ?? '', source: ref.providerId,
    songmid: ref.providerId === 'wy' || ref.providerId === 'kg' ? /^\d+$/.test(ref.songId) ? Number(ref.songId) : ref.songId : ref.songId,
    interval: pick('interval') ?? null, albumName: pick('albumName') ?? '', img: '', typeUrl: {}, types: [], _types: {} }
  const fields = ref.providerId === 'kg' ? { hash: pick('FileHash', 'hash'), albumAudioId: pick('MixSongID', 'albumAudioId'), albumId: pick('AlbumID', 'albumId') }
    : ref.providerId === 'tx' ? { songId: pick('id', 'songId'), strMediaMid: pick('media_mid', 'strMediaMid'), albumMid: pick('albumMid') }
      : { albumId: pick('albumId') }
  Object.assign(info, Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)))
  // Only explicit provider hashes justify quality data; search results currently preserve main hash only.
  if (ref.providerId === 'kg') {
    const hashes = Object.entries({ '128k': pick('FileHash', 'hash'), '320k': pick('HQFileHash'), flac: pick('SQFileHash'), flac24bit: pick('ResFileHash') }).filter(([, hash]) => typeof hash === 'string' && hash)
    info.types = hashes.map(([type]) => ({ type })); info._types = Object.fromEntries(hashes.map(([type, hash]) => [type, { hash }]))
  }
  return info
}
export class LXHost {
  private readonly entries = new Map<string, Entry>()
  private loading: Promise<void> | null = null
  private closing = false
  private readonly networkWork = new Set<Promise<unknown>>()
  private readonly url: string
  constructor(private readonly directory: string, private readonly registry: ProviderRegistry, private readonly resolver: PlaybackResolver,
    private readonly sandboxDirectory = join(__dirname, '../lx-sandbox'), private readonly preloadPath = join(__dirname, '../preload/lx.js')) {
    this.url = pathToFileURL(join(sandboxDirectory, 'index.html')).href
    ipcMain.handle('lx:bootstrap', (event) => this.sender(event).script)
    ipcMain.handle('lx:message', (event, input: unknown) => this.message(this.sender(event), input))
    ipcMain.handle('lx:network', async (event, input: unknown) => {
      if (this.closing) throw new Error('应用正在关闭，拒绝新请求')
      const entry = this.sender(event); const request = LXNetworkSchema.parse(input)
      if (entry.network.size >= 20 || entry.network.has(request.requestId)) throw new Error('音源网络请求过多或重复')
      const abort = new AbortController(); entry.network.set(request.requestId, abort)
      const work = lxNetwork(request, abort.signal); this.networkWork.add(work)
      try { return { ok: true, response: await work } }
      catch { return { ok: false, message: '音源网络请求失败、取消或超时' } }
      finally { entry.network.delete(request.requestId); this.networkWork.delete(work) }
    })
    ipcMain.handle('lx:cancel-network', (event, input: unknown) => { this.sender(event).network.get(z.string().uuid().parse(input))?.abort() })
  }
  private sender(event: IpcMainInvokeEvent): Entry {
    const entry = [...this.entries.values()].find((entry) => entry.window && !entry.window.isDestroyed() && entry.window.webContents === event.sender)
    if (!entry?.window || event.senderFrame !== entry.window.webContents.mainFrame || event.senderFrame?.url !== this.url) throw new Error('音源请求来源未获授权')
    return entry
  }
  private async load(): Promise<void> {
    if (!this.loading) this.loading = (async () => {
      let data: unknown
      try { data = JSON.parse(await readFile(join(this.directory, 'extensions.json'), 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('音源记录无法读取，已保留原文件') }
      for (const stored of storedSchema.parse(data)) this.entries.set(stored.manifest.id, { ...stored, manifest: { ...stored.manifest, enabled: false }, window: null, sources: {}, pending: new Map(), network: new Map() })
      // Do not execute stored code on startup. Explicit enable is required after restart.
    })()
    await this.loading
  }
  private persist(): Promise<void> { return atomicWrite(join(this.directory, 'extensions.json'), JSON.stringify(storedSchema.parse([...this.entries.values()].map(({ manifest, script }) => ({ manifest, script }))), null, 2)) }
  async list(): Promise<ExtensionManifest[]> { await this.load(); return [...this.entries.values()].map((entry) => structuredClone(entry.manifest)) }
  async importScript(path: string, ctx: RequestContext): Promise<ExtensionManifest> {
    await this.load(); ctx.signal.throwIfAborted()
    if (this.entries.size >= 20) throw new Error('音源脚本最多 20 个')
    const rawScript = await readFile(path, 'utf8'); if (Buffer.byteLength(rawScript) > 1024 * 1024) throw new Error('脚本超过 1 MB')
    const header = rawScript.replace(/^\uFEFF/, '').trimStart().match(/^\/\*([\s\S]*?)\*\//)?.[1]
    if (!header) throw new Error('脚本缺少 LX 起始元信息注释')
    const field = (name: string, max: number) => (header.match(new RegExp(`@${name}[^\\S\\r\\n]+([^\\r\\n]*)`))?.[1]?.replace(/\*\/$/, '').trim() ?? '').slice(0, max)
    const script = LXScriptInfoSchema.parse({ name: field('name', 24) || '未命名音源', description: field('description', 36), version: field('version', 36), author: field('author', 56), homepage: field('homepage', 1024), rawScript })
    const manifest: ExtensionManifest = { id: randomUUID(), name: script.name, version: script.version, contractMajor: 1, platformIds: [], qualities: [], enabled: false, compatibilityError: null }
    const entry: Entry = { manifest, script, window: null, sources: {}, pending: new Map(), network: new Map() }; this.entries.set(manifest.id, entry)
    try {
      await this.start(entry, ctx.signal)
      // Replacement preserves all previous versions, disables them only after new initialization passes.
      for (const old of this.entries.values()) if (old !== entry && old.script.name === script.name && old.script.author === script.author) this.stop(old)
      await this.persist(); return structuredClone(manifest)
    } catch (error) { await this.persist(); throw error }
  }
  private message(entry: Entry, input: unknown): null {
    const message = LXMessageSchema.parse(input)
    if (message.type === 'inited') {
      if (!entry.init) throw new Error('不能重复初始化')
      const sources = Object.fromEntries(Object.entries(message.data.sources).filter(([id, source]) => platformIds.includes(id as typeof platformIds[number]) && source.actions.includes('musicUrl'))
        .map(([id, source]) => [id, { ...source, actions: ['musicUrl'], qualitys: source.qualitys.filter((quality) => qualities.includes(quality as typeof qualities[number])) }]))
      if (!Object.values(sources).some((source) => source.qualitys.length)) { entry.init.fail(new Error('没有受支持的 musicUrl/qualitys')); return null }
      entry.sources = sources; entry.manifest.platformIds = Object.keys(sources) as ExtensionManifest['platformIds']; entry.manifest.qualities = [...new Set(Object.values(sources).flatMap((source) => source.qualitys))] as ExtensionManifest['qualities']
      entry.init.done()
    } else if (message.type === 'init-error') entry.init?.fail(new Error('音源脚本初始化失败'))
    else if (message.type === 'result') entry.pending.get(message.requestId)?.done(message.url)
    else if (message.type === 'request-error') entry.pending.get(message.requestId)?.fail(new Error('音源脚本请求失败'))
    return null
  }
  private async start(entry: Entry, signal?: AbortSignal): Promise<void> {
    if (this.closing) throw new Error('应用正在关闭，无法启动音源')
    if (entry.window) return
    signal?.throwIfAborted(); entry.manifest.compatibilityError = null
    const window = new BrowserWindow({ show: false, webPreferences: { preload: this.preloadPath, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: `lx-${randomUUID()}`, webSecurity: true } })
    entry.window = window
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault()); window.webContents.on('will-frame-navigate', (event) => event.preventDefault())
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== this.url && details.url !== pathToFileURL(join(this.sandboxDirectory, 'runtime.js')).href }))
    try {
      await new Promise<void>((done, fail) => {
        const cancel = () => settle(new Error('音源初始化已取消'))
        const timer = setTimeout(() => settle(new Error('音源脚本初始化超时（5 秒）')), 5000)
        const settle = (error?: Error) => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); entry.init = undefined; error ? fail(error) : done() }
        entry.init = { done: () => settle(), fail: settle }
        signal?.addEventListener('abort', cancel, { once: true })
        window.webContents.once('render-process-gone', () => settle(new Error('音源沙箱进程终止')))
        void window.loadURL(this.url).catch(() => settle(new Error('音源沙箱无法加载')))
      })
      if (this.closing) throw new Error('应用正在关闭，无法启动音源')
      entry.manifest.enabled = true
      this.registry.registerPlayback({ id: entry.manifest.id, capabilities: () => ({ contractMajor: 1, platformIds: entry.manifest.platformIds, qualities: entry.manifest.qualities, fullTrack: true, offlineEditable: false }), resolve: (ref, quality, ctx) => this.resolve(entry, ref, quality, ctx) })
    } catch (error) { this.stop(entry); entry.manifest.compatibilityError = error instanceof Error ? error.message : '音源初始化失败'; throw error }
  }
  private stop(entry: Entry): void {
    entry.init?.fail(new Error('音源初始化已取消'))
    this.registry.removePlayback(entry.manifest.id); entry.manifest.enabled = false
    for (const pending of entry.pending.values()) pending.fail(new Error('音源已禁用或沙箱已终止'))
    entry.pending.clear(); for (const abort of entry.network.values()) abort.abort(); entry.network.clear()
    const window = entry.window; entry.window = null; if (window && !window.isDestroyed()) window.destroy()
  }
  private async resolve(entry: Entry, input: ProviderTrackRef, quality: string, ctx: RequestContext): Promise<ResolvedAudio> {
    const ref = ProviderTrackRefSchema.parse(input); ctx.signal.throwIfAborted()
    if (!entry.window || !entry.manifest.enabled || !entry.sources[ref.providerId]?.qualitys.includes(quality)) throw new Error('音源未启用或不支持所选音质')
    const requestId = randomUUID()
    const window = entry.window
    const url = await new Promise<string>((done, fail) => {
      let settled = false; let callerCancelled = false
      const settle = (error: Error | null, url?: string) => {
        if (settled) return
        settled = true; clearTimeout(timer); ctx.signal.removeEventListener('abort', cancelled); entry.pending.delete(requestId)
        if (!callerCancelled) error ? fail(error) : done(url!)
      }
      const terminate = (message: string) => {
        settle(new Error(message))
        if (entry.window !== window) return
        this.stop(entry); entry.manifest.compatibilityError = message; void this.persist().catch(() => {})
      }
      const timer = setTimeout(() => terminate('音源脚本解析超时（15 秒）'), 15000)
      // Keep the original external watchdog until the script settles, even if its caller has left.
      const cancelled = () => { callerCancelled = true; fail(new Error('音源解析已取消')) }
      ctx.signal.addEventListener('abort', cancelled, { once: true })
      entry.pending.set(requestId, { done: (url) => settle(null, url), fail: (error) => settle(error) })
      window.webContents.send('lx:resolve', { requestId, source: ref.providerId, action: 'musicUrl', info: { type: quality, musicInfo: lxMusicInfo(ref) } })
    })
    return { url, headers: {}, expiresAt: null, declaredQuality: quality, preview: null, expectedDurationSeconds: null }
  }
  async enable(id: string, enabled: boolean): Promise<void> { await this.load(); const entry = this.entries.get(id); if (!entry) throw new Error('音源不存在'); if (enabled) await this.start(entry); else this.stop(entry); await this.persist() }
  async test(id: string, ref: ProviderTrackRef, quality: string, ctx: RequestContext): Promise<PlaybackResource> {
    await this.load(); const entry = this.entries.get(id); if (!entry) throw new Error('音源不存在')
    const checked = ProviderTrackRefSchema.parse(ref)
    const duration = checked.identity.durationSeconds
    const track: Track = { id: `source-test-${randomUUID()}`, title: String(checked.identity.originalTitle ?? checked.songId), artists: [String(checked.identity.singer ?? '')].filter(Boolean), album: null, version: 'unknown', versionDisplay: null, durationSeconds: typeof duration === 'number' ? duration : null, artworkAssetId: null, audioAssetId: null, sources: [checked] }
    // Test exactly the selected extension, not another enabled source.
    const audio = await this.resolve(entry, checked, quality, ctx); const result = await checkCompleteness(track, audio, ctx)
    if (!result.accepted) throw new Error(result.reasons.join('；'))
    if (!actualQualityMeets(result.probe, quality)) throw new Error('实际媒体不满足所选音质')
    return this.resolver.issueVerified(audio, result.probe)
  }
  async dispose(id: string): Promise<void> { await this.load(); const entry = this.entries.get(id); if (entry) this.stop(entry); await this.persist() }
  async shutdown(): Promise<void> {
    this.closing = true
    for (const entry of this.entries.values()) this.stop(entry)
    await Promise.allSettled([...this.networkWork])
  }
}
