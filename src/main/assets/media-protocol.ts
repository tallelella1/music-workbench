import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import type { AssetRegistry } from './asset-registry'
import type { AssetRecord } from '../../shared/contracts'
import { PlaybackResourceSchema, type PlaybackResource } from '../../shared/player'
import type { ResolvedAudio } from '../../shared/providers'
import type { MediaProbe } from '../../shared/contracts'
import { consumeRemote } from '../playback/remote-resource'

export function parseByteRange(value: string, length: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2]) || length <= 0) return null
  const first = match[1] ? Number(match[1]) : null; const last = match[2] ? Number(match[2]) : null
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null
  const start = first ?? Math.max(0, length - last!)
  const end = first === null || last === null ? length - 1 : Math.min(last, length - 1)
  return start <= end && start < length ? { start, end } : null
}
export function assetResponse(assets: AssetRegistry, asset: AssetRecord, request: Request, origin: string): Response {
  const type = asset.kind === 'image' ? (asset.media.codec === 'png' ? 'image/png' : asset.media.codec === 'webp' ? 'image/webp' : 'image/jpeg') : 'application/octet-stream'
  const headers: Record<string, string> = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Content-Range', 'Content-Type': type, 'Accept-Ranges': 'bytes' }
  const rangeHeader = request.headers.get('range')
  const range = rangeHeader ? parseByteRange(rangeHeader, asset.byteLength) : undefined
  if (rangeHeader && !range) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${asset.byteLength}` } })
  headers['Content-Length'] = String(range ? range.end - range.start + 1 : asset.byteLength)
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${asset.byteLength}`
  const stream = assets.openRead(asset.id, range ?? undefined)
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers })
}
export class MediaResourceRegistry {
  private readonly handles = new Map<string, PlaybackResource>()
  private readonly remote = new Map<string, Uint8Array>()
  constructor(private readonly assets: AssetRegistry, private readonly now = Date.now, private readonly lifetimeMs = 24 * 60 * 60 * 1000) {}
  async issueRemote(audio: ResolvedAudio, probe: MediaProbe): Promise<PlaybackResource> {
    if (audio.expiresAt !== null && audio.expiresAt <= this.now()) throw new Error('远程链接已过期')
    const verified = consumeRemote(audio, probe)
    const resourceId = randomUUID()
    const resource = PlaybackResourceSchema.parse({ resourceId, url: `media://remote/${resourceId}`, assetId: null, probe,
      actualQuality: `${probe.codec} · ${probe.sampleRate ?? '?'} Hz${probe.bitDepth ? ` · ${probe.bitDepth} bit` : ''}${probe.bitrate ? ` · ${Math.round(probe.bitrate / 1000)} kbps` : ''}`,
      expiresAt: Math.min(audio.expiresAt ?? Infinity, this.now() + this.lifetimeMs) })
    for (const [id, old] of this.handles) if (old.expiresAt! <= this.now()) { this.handles.delete(id); this.remote.delete(id) }
    let retainedBytes = [...this.remote.values()].reduce((total, bytes) => total + bytes.byteLength, 0)
    for (const [id, bytes] of this.remote) {
      if (retainedBytes + verified.bytes.byteLength <= 256 * 1024 * 1024 && this.remote.size < 20) break
      retainedBytes -= bytes.byteLength; this.remote.delete(id); this.handles.delete(id)
    }
    this.handles.set(resourceId, resource); this.remote.set(resourceId, verified.bytes)
    return structuredClone(resource)
  }
  async issueLocal(assetId: string): Promise<PlaybackResource> {
    const asset = await this.assets.verifyOriginal(assetId)
    if (asset.kind !== 'audio') throw new Error('素材不是音频')
    const resourceId = randomUUID()
    const resource = PlaybackResourceSchema.parse({ resourceId, url: `media://local/${resourceId}`, assetId, probe: asset.media,
      actualQuality: `${asset.media.codec} · ${asset.media.sampleRate ?? '?'} Hz${asset.media.bitDepth ? ` · ${asset.media.bitDepth} bit` : ''}`, expiresAt: this.now() + this.lifetimeMs })
    for (const [id, old] of this.handles) if (old.expiresAt! <= this.now()) this.handles.delete(id)
    this.handles.set(resourceId, resource)
    return structuredClone(resource)
  }
  async handle(request: Request, origin: string): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (!['local', 'remote'].includes(url.hostname) || url.search || url.hash || request.method !== 'GET') return new Response(null, { status: 400 })
      const resource = this.handles.get(url.pathname.slice(1))
      if (!resource) return new Response(null, { status: 404 })
      if (resource.expiresAt! <= this.now()) return new Response(null, { status: 410 })
      if (url.hostname === 'remote') {
        const bytes = this.remote.get(resource.resourceId)
        if (!bytes || resource.assetId !== null) return new Response(null, { status: 404 })
        const rangeHeader = request.headers.get('range'); const range = rangeHeader ? parseByteRange(rangeHeader, bytes.length) : undefined
        const headers: Record<string, string> = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Content-Range', 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes' }
        if (rangeHeader && !range) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${bytes.length}` } })
        const body = range ? bytes.slice(range.start, range.end + 1) : bytes
        headers['Content-Length'] = String(body.length)
        if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${bytes.length}`
        return new Response(new Uint8Array(body), { status: range ? 206 : 200, headers })
      }
      const asset = await this.assets.verifyOriginal(resource.assetId!)
      return assetResponse(this.assets, asset, request, origin)
    } catch { return new Response(null, { status: 409 }) }
  }
}
