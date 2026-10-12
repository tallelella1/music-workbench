import { expect, test } from 'vitest'
import { makeTrack } from '../helpers/fixtures'

test('automatic switching requires title, artist set, proven version, duration and album evidence', async () => {
  const module = await import('../../src/main/playback/matcher').catch(() => null)
  expect(module, 'matchTrack must exist').not.toBeNull()
  const expected = makeTrack({ title: 'Ｓｏｎｇ (Studio)', artists: [' Alice ', 'BOB'], album: 'Album', versionDisplay: '(Studio)' })
  const candidate = makeTrack({ title: 'song (studio)', artists: ['bob', 'alice'], album: 'album', versionDisplay: 'Studio', durationSeconds: 125 })
  expect(module!.matchTrack(expected, candidate).matched).toBe(true)
  for (const changed of [
    { artists: ['other'] }, { title: 'Song (Live)', version: 'live' as const, versionDisplay: 'Live' },
    { durationSeconds: 125.01 }, { durationSeconds: null }, { album: 'Other' }, { album: null },
    { versionDisplay: null, title: 'song', version: 'studio' as const }, { artists: [] }
  ]) expect(module!.matchTrack(expected, { ...candidate, ...changed }).matched).toBe(false)
})

test('legacy enum and conflicting title evidence cannot justify automatic matching', async () => {
  const module = await import('../../src/main/playback/matcher').catch(() => null)
  expect(module).not.toBeNull()
  for (const track of [makeTrack(), makeTrack({ title: 'Song (Live)', version: 'studio', versionDisplay: 'Studio' }), makeTrack({ durationSeconds: null })]) {
    expect(module!.matchTrack(track, { ...track, id: 'other' }).matched).toBe(false)
  }
  const markerOnly = makeTrack({ title: '(Studio)', album: 'Album', versionDisplay: 'Studio' })
  expect(module!.matchTrack(markerOnly, { ...markerOnly, id: 'other' }).matched).toBe(false)
})
