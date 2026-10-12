import type { RequestContext, Track, MediaProbe } from '../../shared/contracts'
import { TrackSchema } from '../../shared/schemas'
import { ResolvedAudioSchema, PlaybackCapabilitiesSchema, PlaybackOptionsSchema, type ResolvedAudio } from '../../shared/providers'
import type { PlaybackResource } from '../../shared/player'
import type { ProviderRegistry } from '../providers/registry'
import type { MediaResourceRegistry } from '../assets/media-protocol'
import { checkCompleteness, actualQualityMeets } from './completeness'
import { matchTrack } from './matcher'
import { sourceDiagnostic } from '../../shared/source-diagnostics'
export interface ResolutionAttempt { sourceId: string; platformId: string; quality: string; reasons: string[] }
export class PlaybackResolver {
  private readonly traces = new Map<string, ResolutionAttempt[]>()
  constructor(private readonly registry: ProviderRegistry, private readonly media: MediaResourceRegistry,
    private readonly policy: { budgetMs?: number; candidates?: (track: Track, ctx: RequestContext) => Promise<Track[]> } = {}) {}
  trace(requestId: string): ResolutionAttempt[] { return structuredClone(this.traces.get(requestId) ?? []) }
  issueVerified(audio: ResolvedAudio, probe: MediaProbe): Promise<PlaybackResource> { return this.media.issueRemote(audio, probe) }
  async resolve(track: Track, options: { quality: string; strict: boolean }, ctx: RequestContext): Promise<PlaybackResource> {
    TrackSchema.parse(track); PlaybackOptionsSchema.parse(options); ctx.signal.throwIfAborted()
    const abort = new AbortController(); const signal = AbortSignal.any([ctx.signal, abort.signal]); const child = { requestId: ctx.requestId, signal }
    const budget = Math.min(90000, this.policy.budgetMs ?? 90000)
    const timer = setTimeout(() => abort.abort(new Error('播放解析总预算超时')), budget)
    const attempts: ResolutionAttempt[] = []; this.traces.set(ctx.requestId, attempts)
    if (this.traces.size > 100) this.traces.delete(this.traces.keys().next().value!)
    const bounded = async <T>(work: () => Promise<T>): Promise<T> => {
      signal.throwIfAborted()
      return new Promise((done, reject) => {
        const cancel = () => reject(signal.reason); signal.addEventListener('abort', cancel, { once: true })
        void work().then(done, reject).finally(() => signal.removeEventListener('abort', cancel))
      })
    }
    try {
      if (track.audioAssetId) {
        const resource = await this.media.issueLocal(track.audioAssetId)
        signal.throwIfAborted(); return resource
      }
      const seen = new Set<string>()
      const tryTrack = async (candidate: Track): Promise<PlaybackResource | null> => {
        for (const ref of candidate.sources) for (const provider of this.registry.playbacks()) {
          const caps = PlaybackCapabilitiesSchema.parse(provider.capabilities())
          if (!caps.fullTrack || !caps.platformIds.includes(ref.providerId)) continue
          const qualityRank = ['flac24bit', 'flac', '320k', '128k']
          const permitted = options.strict ? [options.quality] : qualityRank.slice(Math.max(0, qualityRank.indexOf(options.quality)))
          for (const quality of permitted.filter((value) => caps.qualities.includes(value))) {
            const key = `${provider.id}:${ref.providerId}:${ref.songId}:${quality}`
            if (seen.has(key) || attempts.length >= 6) continue
            seen.add(key); const attempt = { sourceId: provider.id, platformId: ref.providerId, quality, reasons: [] as string[] }; attempts.push(attempt)
            try {
              const enriched = { ...ref, identity: { ...ref.identity, name: candidate.title, singer: ref.identity.singer ?? candidate.artists.join('、'), albumName: candidate.album, interval: candidate.durationSeconds === null ? null : `${Math.floor(candidate.durationSeconds / 60)}:${String(Math.floor(candidate.durationSeconds % 60)).padStart(2, '0')}` } }
              let refreshed = false
              while (true) {
                const audio = await bounded(() => provider.resolve(enriched, quality, child)); ResolvedAudioSchema.parse(audio)
                if (audio.expiresAt !== null && audio.expiresAt <= Date.now()) {
                  if (!refreshed) { refreshed = true; continue }
                  attempt.reasons.push('链接已过期'); break
                }
                if (audio.declaredQuality !== quality) { attempt.reasons.push('来源返回的音质与请求不一致'); break }
                // This owned work honors the signal and settles after reader/worker/temp cleanup.
                // Only untrusted provider promises need the early-return budget race.
                const result = await checkCompleteness(track, audio, child)
                if (!result.accepted) {
                  if (result.failure === 'expired' && !refreshed) { refreshed = true; continue }
                  attempt.reasons.push(...result.reasons); break
                }
                if (options.strict && !actualQualityMeets(result.probe, quality)) { attempt.reasons.push('实际媒体不满足所选音质'); break }
                signal.throwIfAborted()
                return await this.media.issueRemote(audio, result.probe)
              }
            } catch (error) { signal.throwIfAborted(); const failure = sourceDiagnostic(error); attempt.reasons.push(`${failure.code}: ${failure.message}`) }
          }
        }
        return null
      }
      let resource = await tryTrack(track)
      if (!resource && attempts.length < 6 && this.policy.candidates) {
        for (const candidate of await this.policy.candidates(track, child)) {
          signal.throwIfAborted()
          if (!matchTrack(track, candidate).matched) continue
          resource = await tryTrack(candidate); if (resource) break
        }
      }
      if (resource) return resource
      const detail = attempts.map((item) => `${item.platformId}/${item.quality}: ${item.reasons.join('、')}`).join('；')
      throw new Error(detail ? `没有可确认的完整音源。${detail}` : '没有支持此曲目和音质的已启用完整音源，请导入音源脚本')
    } finally { clearTimeout(timer); abort.abort() }
  }
}
