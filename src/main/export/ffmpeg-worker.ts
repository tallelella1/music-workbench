import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import type { MediaProbe, RequestContext } from '../../shared/contracts'
import { AudioExportOptionsSchema, ExportCapabilitiesSchema, type AudioExportOptions, type ExportCapabilities } from '../../shared/audio-export'
import { probeMedia, runtimeBinary, executeMediaRuntime } from '../assets/media-probe'
import type { buildFilterGraph } from './filter-builder'
const encoders = { mp3: 'libmp3lame', flac: 'flac', wav: { 16: 'pcm_s16le', 24: 'pcm_s24le', 32: 'pcm_s32le' } } as const
const approvedJobs = new WeakSet<object>()
export interface FfmpegJob { readonly args: readonly string[]; readonly outputPath: string; readonly outputDurationSeconds: number }
export async function createFfmpegJob(inputPath: string, outputPath: string, optionsRaw: AudioExportOptions, graph: ReturnType<typeof buildFilterGraph>, sampleRate: number, irPath: string): Promise<FfmpegJob> {
  const options = AudioExportOptionsSchema.parse(optionsRaw)
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-i', inputPath]
  if (graph.impulseResponse) {
    const channels = graph.impulseResponse
    const bytes = Buffer.alloc(channels[0].length * 8)
    for (let i = 0; i < channels[0].length; i++) for (let c = 0; c < 2; c++) bytes.writeFloatLE(channels[c][i], (i * 2 + c) * 4)
    await writeFile(irPath, bytes, { flag: 'wx' })
    args.push('-f', 'f32le', '-ar', String(sampleRate), '-ac', '2', '-i', irPath)
  }
  args.push('-filter_complex', graph.filters, '-map', '[out]', '-ar', String(sampleRate), '-ac', '2', '-map_metadata', '-1')
  if (options.format === 'mp3') args.push('-c:a', encoders.mp3, '-b:a', `${options.bitrateKbps}k`)
  else if (options.format === 'flac') args.push('-c:a', encoders.flac, '-sample_fmt', options.bitDepth === 16 ? 's16' : 's32', '-bits_per_raw_sample', String(options.bitDepth))
  else args.push('-c:a', encoders.wav[options.bitDepth])
  args.push('-f', options.format, '-progress', 'pipe:1', '-nostats', outputPath)
  const job = Object.freeze({ args: Object.freeze(args), outputPath, outputDurationSeconds: graph.outputDurationSeconds })
  approvedJobs.add(job); return job
}
export class FfmpegWorker {
  private capabilitiesPromise?: Promise<ExportCapabilities>
  private readonly controller = new AbortController()
  private closing = false
  capabilities(): Promise<ExportCapabilities> {
    if (this.closing) return Promise.reject(new Error('音频处理器正在退出'))
    return this.capabilitiesPromise ??= (async () => {
      const run = (flag: string) => executeMediaRuntime('ffmpeg', ['-hide_banner', flag], { signal: this.controller.signal, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 })
      const results = await Promise.allSettled([run('-encoders'), run('-filters')])
      const [encoderList, filterList] = results.map(result => { if (result.status === 'rejected') throw result.reason; return result.value })
      for (const filter of ['atrim', 'asetpts', 'atempo', 'asetrate', 'aresample', 'apad', 'aformat', 'equalizer', 'afir', 'volume', 'asplit', 'amix', 'anull', 'afade']) if (!new RegExp(`\\b${filter}\\b`).test(filterList.stdout)) throw new Error('音频处理滤镜不可用')
      const has = (name: string) => new RegExp(`\\b${name}\\b`).test(encoderList.stdout)
      return ExportCapabilitiesSchema.parse({ mp3Bitrates: has(encoders.mp3) ? [128, 320] : [], flacBitDepths: has(encoders.flac) ? [16, 24] : [], wavBitDepths: ([16, 24, 32] as const).filter(depth => has(encoders.wav[depth])) })
    })().catch(() => { throw new Error('音频处理运行时不可用') })
  }
  async shutdown(): Promise<void> {
    this.closing = true; this.controller.abort()
    await this.capabilitiesPromise?.catch(() => {})
  }
  async run(spec: FfmpegJob, ctx: RequestContext, report: (progress: number) => void): Promise<MediaProbe> {
    if (this.closing) throw new Error('音频处理器正在退出')
    if (!approvedJobs.has(spec)) throw new Error('未注册的导出器参数')
    ctx.signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const child = spawn(runtimeBinary('ffmpeg'), [...spec.args], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let pending = ''; let processError: Error | undefined
      const abort = () => { child.kill('SIGTERM') }
      ctx.signal.addEventListener('abort', abort, { once: true })
      if (ctx.signal.aborted) abort()
      child.stdout.on('data', (chunk: Buffer) => {
        pending += chunk.toString()
        const lines = pending.split(/\r?\n/); pending = lines.pop()!
        for (const line of lines) if (line.startsWith('out_time_us=')) {
          const seconds = Number(line.slice(12)) / 1e6
          if (Number.isFinite(seconds)) report(Math.max(0, Math.min(0.99, seconds / spec.outputDurationSeconds)))
        }
      })
      child.stderr.resume() // Never expose FFmpeg's path-bearing stderr across IPC.
      child.once('error', error => { processError = error })
      child.once('close', code => {
        ctx.signal.removeEventListener('abort', abort)
        if (ctx.signal.aborted) reject(ctx.signal.reason)
        else if (processError || code !== 0) reject(new Error('音频编码失败'))
        else resolve()
      })
    })
    ctx.signal.throwIfAborted()
    return probeMedia(spec.outputPath, ctx)
  }
}
