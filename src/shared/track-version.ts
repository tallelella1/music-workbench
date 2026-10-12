import type { Track, TrackVersion } from './contracts'
export interface VersionEvidence { version: TrackVersion; versionDisplay: string | null }

/** Normalize only for classification. Returned evidence always keeps original glyphs. */
function classifyLabel(raw: string): TrackVersion {
  let label = raw.normalize('NFKC').trim().toLowerCase()
  label = label.replace(/^[-–—]\s+/, '').replace(/^(?:version|版本)\s*[:：]\s*/, '')
  const pairs: Record<string, string> = { '(': ')', '[': ']', '【': '】' }
  if (pairs[label[0]] === label.at(-1)) label = label.slice(1, -1).trim()
  if (/^(?:studio(?: version| recording)?|录音室(?:版)?|正式版)$/.test(label)) return 'studio'
  if (/^(?:live(?: version| recording| at .+)?|现场(?:版)?|现场\s*[:：]\s*.+)$/.test(label)) return 'live'
  if (/^(?:remix(?: version| by .+)?|混音(?:版)?)$/.test(label)) return 'remix'
  if (/^(?:instrumental(?: version)?|伴奏(?:版)?|纯音乐(?:版)?)$/.test(label)) return 'instrumental'
  if (/^(?:cover(?: version| by .+)?|翻唱(?:版)?)$/.test(label)) return 'cover'
  return 'unknown'
}

export function inferTrackVersion(title: string, labels: readonly string[] = []): VersionEvidence {
  const titleTags = title.match(/\([^()\n]+\)|（[^（）\n]+）|\[[^[\]\n]+\]|【[^【】\n]+】/gu) ?? []
  const suffix = title.match(/\s[-–—]\s[^\n]+$/u)?.[0]
  const evidence = [...labels, ...titleTags, ...(suffix ? [suffix] : [])]
    .map((raw) => ({ raw, version: classifyLabel(raw) }))
    .filter((value) => value.version !== 'unknown')
  if (!evidence.length) return { version: 'unknown', versionDisplay: null }
  const versions = new Set(evidence.map((value) => value.version))
  if (versions.size > 1) return { version: 'unknown', versionDisplay: evidence.map((value) => value.raw).join('\n') }
  return { version: evidence[0].version, versionDisplay: evidence[0].raw }
}

/** Strict matching must not trust a legacy enum without corroborating raw/title evidence. */
export function provenTrackVersion(track: Pick<Track, 'title' | 'version' | 'versionDisplay'>): TrackVersion {
  const inferred = inferTrackVersion(track.title, track.versionDisplay === null ? [] : [track.versionDisplay])
  return inferred.version === track.version ? inferred.version : 'unknown'
}
