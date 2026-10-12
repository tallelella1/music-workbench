import type { MediaProbe } from '../../shared/contracts'
import type { ResolvedAudio } from '../../shared/providers'
export interface VerifiedMedia { bytes: Uint8Array; probe: MediaProbe }
// Identity binds approval to the exact host object and bytes; renderer cannot mint it.
const approvals = new WeakMap<ResolvedAudio, VerifiedMedia>()
export function approveRemote(audio: ResolvedAudio, media: VerifiedMedia): void { approvals.set(audio, { bytes: new Uint8Array(media.bytes), probe: structuredClone(media.probe) }) }
export function consumeRemote(audio: ResolvedAudio, probe: MediaProbe): VerifiedMedia {
  const verified = approvals.get(audio)
  if (!verified || JSON.stringify(verified.probe) !== JSON.stringify(probe)) throw new Error('远程音频尚未通过完整性验证')
  approvals.delete(audio)
  return verified
}
