import { expect, test } from 'vitest'
import { inferTrackVersion, provenTrackVersion } from '../../src/shared/track-version'
import { TrackSchema } from '../../src/shared/schemas'
import { makeTrack } from '../helpers/fixtures'

test.each(['Oliver', 'Live Forever', 'alive', 'Remix memories', 'Cover me', 'studio dreams'])('plain title %s is no version evidence', (title) => {
  expect(inferTrackVersion(title, [])).toEqual({ version: 'unknown', versionDisplay: null })
})
test.each(['I love this live recording', 'Recorded live for my friends', 'Live Forever', 'Oliver', 'great remix!'])('generic comment %s is no version evidence', (comment) => {
  expect(inferTrackVersion('歌曲', [comment])).toEqual({ version: 'unknown', versionDisplay: null })
})
test.each([
  ['歌曲 (Live at 上海 2026)', [], 'live', '(Live at 上海 2026)'],
  ['歌曲 - Remix', [], 'remix', ' - Remix'],
  ['歌曲【伴奏】', [], 'instrumental', '【伴奏】'],
  ['歌曲', ['Studio'], 'studio', 'Studio'],
  ['歌曲', ['  Ｌｉｖｅ at 上海 2026 🎵  '], 'live', '  Ｌｉｖｅ at 上海 2026 🎵  '],
  ['歌曲', ['Cover by 歌手'], 'cover', 'Cover by 歌手']
] as const)('explicit evidence retains raw glyphs: %s', (title, labels, version, versionDisplay) => {
  expect(inferTrackVersion(title, [...labels])).toEqual({ version, versionDisplay })
})
test('legacy normalized enum alone cannot prove version; missing display is accepted without invention', () => {
  const legacy = makeTrack({ title: 'Oliver', version: 'live' })
  Reflect.deleteProperty(legacy, 'versionDisplay')
  const decoded = TrackSchema.parse(legacy)
  expect(decoded.versionDisplay).toBeNull()
  expect(decoded.version).toBe('live')
  expect(provenTrackVersion(decoded)).toBe('unknown')
  expect(provenTrackVersion(makeTrack({ title: '歌曲 (Live at 上海)', version: 'live' }))).toBe('live')
  expect(provenTrackVersion(makeTrack({ title: '歌曲', version: 'studio', versionDisplay: 'Live at 上海' }))).toBe('unknown')
})

test('contradictory explicit labels stay unproven and retain both raw labels', () => {
  expect(inferTrackVersion('歌曲', ['Live', 'Studio'])).toEqual({ version: 'unknown', versionDisplay: 'Live\nStudio' })
  expect(provenTrackVersion(makeTrack({ version: 'live', title: '歌曲 (Studio)', versionDisplay: 'Live' }))).toBe('unknown')
})
