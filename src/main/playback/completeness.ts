import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { MediaProbe, RequestContext, Track } from '../../shared/contracts'
import { MediaProbeSchema, TrackSchema } from '../../shared/schemas'
import { ResolvedAudioSchema, type ResolvedAudio } from '../../shared/providers'
import { probeMedia, runtimeBinary } from '../assets/media-probe'
import { approveRemote } from './remote-resource'
import { sourceDiagnostic } from '../../shared/source-diagnostics'

const empty: MediaProbe = { durationSeconds: null, durationReliable: false, codec: 'unknown', sampleRate: null, channels: null, bitDepth: null, bitrate: null, width: null, height: null }
export const MAX_REMOTE_BYTES = 128 * 1024 * 1024
export function actualQualityMeets(probe: MediaProbe, quality: string): boolean {
  if (quality === 'flac') return probe.codec === 'flac'
  if (quality === 'flac24bit') return probe.codec === 'flac' && (probe.bitDepth ?? 0) >= 24 && (probe.sampleRate ?? 0) >= 48000
  if (quality === '128k' || quality === '320k') return probe.codec === 'flac' || (probe.bitrate ?? 0) >= (quality === '128k' ? 128000 : 320000) * 0.95
  return false
}
/** Decode to mono PCM at 8kHz: byte count measures actual samples, not a container's claim. */
async function decodedDuration(path: string, ctx: RequestContext): Promise<number> {
  return new Promise((done, reject) => {
    const child = spawn(runtimeBinary('ffmpeg'), ['-v', 'error', '-xerror', '-i', path, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'], { signal: ctx.signal, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let bytes = 0; let errors = false; let failure: Error | undefined
    const timeout = setTimeout(() => { failure = new Error('完整解码超时'); child.kill() }, 60000)
    child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 16000 * 6 * 60 * 60) child.kill() })
    child.stderr.on('data', () => { errors = true })
    child.once('error', (error) => { failure ??= error })
    child.once('close', (code) => { clearTimeout(timeout); if (failure) reject(failure); else if (code !== 0 || errors || !bytes) reject(new Error('完整解码失败')); else done(bytes / 16000) })
  })
}
export interface CompletenessResult { accepted: boolean; probe: MediaProbe; reasons: string[]; failure: 'expired' | 'incomplete' | null }
export async function checkCompleteness(track: Track, audio: ResolvedAudio, ctx: RequestContext): Promise<CompletenessResult> {
  TrackSchema.parse(track); ResolvedAudioSchema.parse(audio); ctx.signal.throwIfAborted()
  let probe = { ...empty }; let directory: string | undefined
  let phase: 'download' | 'decode' = 'download'
  const reject = (reason: string, failure: 'expired' | 'incomplete' = 'incomplete'): CompletenessResult => ({ accepted: false, probe, reasons: [reason], failure })
  if (audio.preview === true) return reject('来源明确标记为试听')
  if (audio.expiresAt !== null && audio.expiresAt <= Date.now()) return reject('链接已过期', 'expired')
  const expected = track.durationSeconds ?? audio.expectedDurationSeconds
  if (expected === null || expected <= 0) return reject('没有可信预期时长，无法确认完整曲目')
  if (track.durationSeconds !== null && audio.expectedDurationSeconds !== null && Math.abs(track.durationSeconds - audio.expectedDurationSeconds) > 5) return reject('来源预期时长与曲目信息冲突')
  try {
    const response = await fetch(audio.url, { headers: audio.headers, signal: ctx.signal, redirect: 'error' })
    if (!response.ok || !response.body) return reject(`媒体 HTTP ${response.status}`)
    const reader = response.body.getReader(); const parts: Uint8Array[] = []; let length = 0
    try {
      while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > MAX_REMOTE_BYTES) throw new Error('媒体超出大小限制'); parts.push(next.value) }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    ctx.signal.throwIfAborted()
    const bytes = Buffer.concat(parts, length)
    directory = await mkdtemp(join(tmpdir(), 'music-completeness-'))
    const path = join(directory, 'media'); await writeFile(path, bytes)
    phase = 'decode'; probe = await probeMedia(path, ctx)
    const duration = await decodedDuration(path, ctx)
    if (Math.abs(duration - expected) > 5) return reject('实际解码时长与预期差超过 5 秒')
    if (probe.durationReliable && probe.durationSeconds !== null && Math.abs(duration - probe.durationSeconds) > 0.5) return reject('容器时长与实际解码样本不一致')
    probe = MediaProbeSchema.parse({ ...probe, durationSeconds: duration, durationReliable: true })
    if (audio.expiresAt !== null && audio.expiresAt <= Date.now()) return reject('核验期间链接已过期', 'expired')
    approveRemote(audio, { bytes, probe })
    return { accepted: true, probe, reasons: [], failure: null }
  } catch (error) { ctx.signal.throwIfAborted(); const failure = sourceDiagnostic(error); return reject(failure.code === 'SOURCE_RESOLVE_FAILED' ? phase === 'download' ? 'MEDIA_DOWNLOAD_FAILED: 媒体下载失败' : 'MEDIA_DECODE_FAILED: 媒体完整解码失败' : `${failure.code}: ${failure.message}`) }
  finally { if (directory) await rm(directory, { recursive: true, force: true }) }
}
