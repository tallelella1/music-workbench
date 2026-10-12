import type { Track } from '../../shared/contracts'
import { inferTrackVersion, provenTrackVersion } from '../../shared/track-version'
function normalize(value: string): string { return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ') }
function title(value: string): string {
  return normalize(value.replace(/\([^()\n]+\)|（[^（）\n]+）|\[[^[\]\n]+\]|【[^【】\n]+】|\s[-–—]\s[^\n]+$/gu,
    (tag) => inferTrackVersion('', [tag]).version === 'unknown' ? tag : ''))
}
export function matchTrack(expected: Track, candidate: Track): { matched: boolean; reasons: string[] } {
  const reasons: string[] = []
  const expectedTitle = title(expected.title); const candidateTitle = title(candidate.title)
  if (!expectedTitle || !candidateTitle || expectedTitle !== candidateTitle) reasons.push('标题缺失或不一致')
  const artists = (track: Track) => [...new Set(track.artists.map(normalize).filter(Boolean))].sort()
  const a = artists(expected); const b = artists(candidate)
  if (!a.length || !b.length || JSON.stringify(a) !== JSON.stringify(b)) reasons.push('歌手信息缺失或不一致')
  const av = provenTrackVersion(expected); const bv = provenTrackVersion(candidate)
  if (av === 'unknown' || bv === 'unknown' || av !== bv) reasons.push('版本证据缺失、冲突或不一致')
  if (expected.durationSeconds === null || candidate.durationSeconds === null) reasons.push('时长未知')
  else if (Math.abs(expected.durationSeconds - candidate.durationSeconds) > 5) reasons.push('时长差超过 5 秒')
  if (!expected.album?.trim() || !candidate.album?.trim()) reasons.push('专辑信息缺失，需手动选择')
  else if (normalize(expected.album) !== normalize(candidate.album)) reasons.push('专辑不一致，需手动选择')
  return { matched: reasons.length === 0, reasons }
}
