import { resolve, join } from 'node:path'
import { execFile, type ExecFileOptionsWithStringEncoding } from 'node:child_process'
import { promisify } from 'node:util'
import type { MediaProbe, RequestContext } from '../../shared/contracts'
import { MediaProbeSchema } from '../../shared/schemas'
let resourceDirectory = resolve('resources')
export function configureMediaRuntime(directory: string): void { resourceDirectory = directory }
export function runtimeBinary(name: 'ffmpeg' | 'ffprobe'): string { return join(resourceDirectory, 'bin', `${name}.exe`) }
/** execFile's abort rejection precedes close; callers must not remove files or exit until close. */
export async function executeMediaRuntime(name: 'ffmpeg' | 'ffprobe', args: string[], options: ExecFileOptionsWithStringEncoding) {
  const execution = promisify(execFile)(runtimeBinary(name), args, options)
  const closed = new Promise<void>(finish => execution.child.once('close', () => finish()))
  try { return await execution } finally { await closed }
}
export async function probeMedia(path: string, ctx: RequestContext): Promise<MediaProbe> {
  const { stdout } = await executeMediaRuntime('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { signal: ctx.signal, encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
  const document = JSON.parse(stdout) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> }
  const stream = document.streams?.find((value) => value.codec_type === 'audio') ?? document.streams?.find((value) => value.codec_type === 'video')
  if (!stream) throw new Error('没有可用的媒体流')
  const number = (value: unknown): number | null => { const parsed = Number(value); return value !== undefined && value !== '' && Number.isFinite(parsed) && parsed > 0 ? parsed : null }
  const durationSeconds = number(stream.duration) ?? number(document.format?.duration)
  return MediaProbeSchema.parse({ durationSeconds, durationReliable: durationSeconds !== null, codec: String(stream.codec_name ?? 'unknown'), sampleRate: number(stream.sample_rate), channels: number(stream.channels), bitDepth: number(stream.bits_per_raw_sample) ?? number(stream.bits_per_sample), bitrate: number(stream.bit_rate) ?? number(document.format?.bit_rate), width: number(stream.width), height: number(stream.height) })
}
export async function validateAudioDecode(path: string, ctx: RequestContext): Promise<void> {
  await executeMediaRuntime('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-map', '0:a:0', '-f', 'null', '-'], { signal: ctx.signal, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 })
}
