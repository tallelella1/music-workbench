import { randomUUID } from 'node:crypto'
import { mkdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { AssetRecord, RequestContext } from '../../shared/contracts'
import { AudioEditSchema, AudioExportOptionsSchema, AudioExportResultSchema, type AudioEdit, type AudioExportOptions, type SourceTimeMap } from '../../shared/audio-export'
import type { AssetRegistry } from '../assets/asset-registry'
import type { TaskService } from '../jobs/task-service'
import { buildFilterGraph } from './filter-builder'
import { FfmpegWorker, createFfmpegJob } from './ffmpeg-worker'

interface Operation { controller: AbortController; committed: boolean; done: Promise<void>; finish(): void; jobId?: string; destinationKeys?: string[] }
export class AudioExportService {
  private closing = false
  private readonly operations = new Set<Operation>()
  private readonly destinations = new Set<string>()
  private shutdownPromise?: Promise<void>
  constructor(private readonly assets: AssetRegistry, private readonly tasks: TaskService, private readonly directory: string, private readonly chooseDestination: (options: AudioExportOptions) => Promise<string | null>, private readonly worker = new FfmpegWorker()) {}
  capabilities() { if (this.closing) return Promise.reject(new Error('应用正在退出，无法处理音频')); return this.worker.capabilities() }

  private begin(ctx: RequestContext): Operation {
    if (this.closing) throw new Error('应用正在退出，无法处理音频')
    ctx.signal.throwIfAborted()
    let complete!: () => void
    const done = new Promise<void>(accept => { complete = accept })
    const operation: Operation = { controller: new AbortController(), committed: false, done, finish: () => {
      ctx.signal.removeEventListener('abort', abort)
      for (const key of operation.destinationKeys ?? []) this.destinations.delete(key)
      this.operations.delete(operation); complete()
    } }
    const abort = () => { if (!operation.committed) { if (operation.jobId) this.tasks.cancel(operation.jobId); operation.controller.abort() } }
    ctx.signal.addEventListener('abort', abort, { once: true })
    this.operations.add(operation)
    return operation
  }
  private async reserve(destination: string, operation: Operation): Promise<void> {
    const keys: string[] = []
    try {
      // Rename replaces this directory entry, so its identity must survive file-symlink resolution changes.
      keys.push(join(await realpath(dirname(resolve(destination))), basename(destination)))
      try { keys.push(await realpath(destination)) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    catch (error) { console.error('Audio destination resolution failed', error); throw new Error('目的目录无法读取') }
    // Resolve parent junctions before folding Windows filesystem case, even when the file does not yet exist.
    const canonicalKeys = [...new Set(keys.map(key => process.platform === 'win32' ? key.toLowerCase() : key))]
    operation.controller.signal.throwIfAborted()
    if (canonicalKeys.some(key => this.destinations.has(key))) throw new Error('此目的文件正在处理中，请选择其他文件或等待当前导出结束')
    // Check and reserve the whole set synchronously, leaving no partial reservation on conflict.
    for (const key of canonicalKeys) this.destinations.add(key)
    operation.destinationKeys = canonicalKeys
  }
  async start(raw: AudioEdit, rawOptions: AudioExportOptions, ctx: RequestContext): Promise<string> {
    const operation = this.begin(ctx)
    const controlled = { ...ctx, signal: operation.controller.signal }
    try {
      const edit = AudioEditSchema.parse(raw); const options = AudioExportOptionsSchema.parse(rawOptions)
      const snapshot = await this.assets.checkedSnapshot(edit.assetId, edit.assetHash, controlled)
      try { buildFilterGraph(edit, snapshot.record.media) } finally { await snapshot.release() }
      const signal = controlled.signal
      // A native save dialog can remain open while shutdown starts. It must not hold the drain open.
      const destination = await new Promise<string | null>((accept, reject) => {
        const abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
        this.chooseDestination(options).then(accept, reject).finally(() => signal.removeEventListener('abort', abort))
        if (signal.aborted) abort()
      })
      signal.throwIfAborted()
      if (!destination) throw new Error('已取消保存')
      await this.reserve(destination, operation)
      operation.jobId = this.tasks.start(async (jobCtx, report) => {
        const abort = () => operation.controller.abort()
        jobCtx.signal.addEventListener('abort', abort, { once: true })
        if (jobCtx.signal.aborted) abort()
        try { return await this.process(edit, options, destination, false, controlled, report, () => {
          controlled.signal.throwIfAborted(); jobCtx.beginCommit(); operation.committed = true
        }) } finally { jobCtx.signal.removeEventListener('abort', abort) }
      })
      // This also releases a queued job cancelled before its work callback runs.
      void this.tasks.wait(operation.jobId).then(operation.finish, operation.finish)
      return operation.jobId
    } catch (error) { operation.finish(); throw error }
  }
  async renderPreview(raw: AudioEdit, ctx: RequestContext): Promise<AssetRecord> {
    const operation = this.begin(ctx); const controlled = { ...ctx, signal: operation.controller.signal }
    try {
      const edit = AudioEditSchema.parse(raw)
      try { await mkdir(this.directory, { recursive: true }) } catch (error) { console.error('Audio preview allocation failed', error); throw new Error('无法创建音频预览') }
      return await this.process(edit, { format: 'wav', bitrateKbps: null, bitDepth: 32 }, join(this.directory, `${randomUUID()}.wav`), true, controlled, () => {}, () => {
        controlled.signal.throwIfAborted(); operation.committed = true
      }) as AssetRecord
    } finally { operation.finish() }
  }
  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.closing = true
    const pending = [...this.operations]
    for (const operation of pending) if (!operation.committed) {
      if (operation.jobId) this.tasks.cancel(operation.jobId)
      operation.controller.abort()
    }
    const workerDrain = this.worker.shutdown()
    return this.shutdownPromise = (async () => {
      await Promise.allSettled([...pending.map(operation => operation.done), workerDrain])
    })()
  }
  private async protectDestination(destination: string, originalPath: string): Promise<void> {
    const parent = await realpath(dirname(resolve(destination)))
    let actual = join(parent, basename(destination))
    try { actual = await realpath(destination) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('目的文件无法读取') }
    if (actual.toLowerCase() === originalPath.toLowerCase()) throw new Error('导出不能覆盖原始音乐')
    try { const [a, b] = await Promise.all([stat(actual), stat(originalPath)]); if (a.dev === b.dev && a.ino === b.ino) throw new Error('导出不能覆盖原始音乐') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  private async process(edit: AudioEdit, options: AudioExportOptions, destination: string, preview: boolean, ctx: RequestContext, report: (progress: number) => void, beginCommit: () => void) {
    const snapshot = await this.assets.checkedSnapshot(edit.assetId, edit.assetHash, ctx)
    const temp = join(dirname(destination), `.audio-${randomUUID()}.tmp`); const irPath = `${temp}.ir`
    let published = false; let result: AssetRecord | ReturnType<typeof AudioExportResultSchema.parse> | undefined; let failure: unknown
    try {
      const capabilities = await this.capabilities()
      if (options.format === 'wav' && !capabilities.wavBitDepths.includes(options.bitDepth) || options.format === 'flac' && !capabilities.flacBitDepths.includes(options.bitDepth) || options.format === 'mp3' && !capabilities.mp3Bitrates.includes(options.bitrateKbps)) throw new Error('编码器选项不可用')
      await this.protectDestination(destination, snapshot.originalPath)
      const graph = buildFilterGraph(edit, snapshot.record.media)
      const spec = await createFfmpegJob(snapshot.path, temp, options, graph, snapshot.record.media.sampleRate!, irPath)
      const media = await this.worker.run(spec, ctx, report)
      if (!media.durationReliable || media.durationSeconds === null || Math.abs(media.durationSeconds - graph.outputDurationSeconds) > (options.format === 'mp3' ? 0.1 : 1 / snapshot.record.media.sampleRate!)) throw new Error('成品时长检查失败')
      ctx.signal.throwIfAborted()
      await this.protectDestination(destination, snapshot.originalPath)
      // No await between the last cancellation check and the irreversible publication boundary.
      beginCommit()
      await rename(temp, destination); published = true
      const sourceTimeMap: SourceTimeMap = { sourceAssetId: edit.assetId, sourceHash: edit.assetHash, ...edit.range, rate: edit.rate, outputDurationSeconds: graph.outputDurationSeconds }
      result = preview ? await this.assets.registerDerived(destination, edit.assetId, sourceTimeMap, ctx) : AudioExportResultSchema.parse({ format: options.format, media: { durationSeconds: media.durationSeconds, sampleRate: media.sampleRate, channels: media.channels, codec: media.codec, bitDepth: media.bitDepth, bitrate: media.bitrate }, sourceTimeMap })
    } catch (error) {
      if (!ctx.signal.aborted) console.error('Audio processing failed', error)
      failure = ctx.signal.aborted ? new Error('已取消音频处理') : error instanceof Error && !('code' in error) ? error : new Error('音频导出失败，请检查保存位置')
    }
    const cleanup = [() => rm(temp, { force: true }), () => rm(irPath, { force: true }), () => snapshot.release()]
    // Only a uniquely owned, unregistered preview can be removed after publication; never delete saved destinations.
    if (preview && published && !result) cleanup.push(() => rm(destination, { force: true }))
    const outcomes = await Promise.allSettled(cleanup.map(async remove => remove()))
    const failures = outcomes.filter(outcome => outcome.status === 'rejected')
    for (const outcome of failures) console.error('Audio export cleanup failed', outcome.reason)
    if (failure) throw failure
    if (failures.length && !preview) return AudioExportResultSchema.parse({ ...result, cleanupWarning: '成品已保存，但临时资源清理失败' })
    if (failures.length) throw new Error('音频预览临时资源清理失败')
    return result!
  }
}
