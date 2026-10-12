import { expect, test } from 'vitest'
import { makeTrack } from '../helpers/fixtures'

async function engine() {
  const module = await import('../../src/renderer/audio/player-engine').catch(() => null)
  expect(module, 'PlayerEngine must exist').not.toBeNull()
  // Queue selection itself does not require an audio device or media element.
  return new module!.PlayerEngine()
}
test('queue respects boundaries, previous, repeat-all and repeat-one', async () => {
  const player = await engine()
  player.setQueue(['a', 'b', 'c'], 1)
  expect(player.previousTrackId()).toBe('a')
  expect(player.previousTrackId()).toBeNull()
  expect(player.nextTrackId()).toBe('b')
  expect(player.nextTrackId()).toBe('c')
  expect(player.nextTrackId()).toBeNull()
  player.setRepeat('all'); expect(player.nextTrackId()).toBe('a')
  player.setRepeat('one'); expect(player.nextTrackId()).toBe('a')
  expect(player.previousTrackId()).toBe('a')
})
test('shuffle visits every queue entry once and preserves previous history', async () => {
  const player = await engine()
  player.setQueue(['a', 'b', 'c', 'd'], 0); player.setShuffle(true)
  const visited = ['a']
  for (let i = 0; i < 3; i++) visited.push(player.nextTrackId()!)
  expect(new Set(visited).size).toBe(4)
  expect(player.nextTrackId()).toBeNull()
  expect(player.previousTrackId()).toBe(visited[2])
  expect(player.nextTrackId()).toBe(visited[3])
})
test('empty queue and invalid controls do not corrupt state', async () => {
  const player = await engine()
  player.setQueue([], -1); expect(player.nextTrackId()).toBeNull()
  expect(() => player.setRate(3, true)).toThrow()
  expect(() => player.setVolume(NaN)).toThrow()
  expect(() => player.seek(-1)).toThrow()
  expect(player.snapshot().volume).toBe(0.75)
})
test('library reconciliation removes missing entries without moving the surviving current track', async () => {
  const player = await engine()
  player.setQueue(['a', 'b', 'c', 'd'], 2)
  expect(player.reconcileQueue(['a', 'c', 'd', 'new'])).toEqual(['a', 'c', 'd'])
  expect(player.previousTrackId()).toBe('a')
  expect(player.nextTrackId()).toBe('c')
  expect(player.nextTrackId()).toBe('d')
  expect(player.nextTrackId()).toBeNull()
})
test('library reconciliation skips a removed successor and preserves repeat-one on the survivor', async () => {
  const player = await engine()
  player.setQueue(['a', 'b', 'c'], 0)
  player.reconcileQueue(['a', 'c'])
  player.setRepeat('one'); expect(player.nextTrackId()).toBe('a')
  player.setRepeat('off'); expect(player.nextTrackId()).toBe('c')
  player.reconcileQueue([]); expect(player.nextTrackId()).toBeNull()
})
test('controller cancels old resolution and never loads a late response', async () => {
  const module = await import('../../src/renderer/audio/player-controller').catch(() => null)
  expect(module, 'PlayerController must exist').not.toBeNull()
  const pending = new Map<string, (value: any) => void>(); const cancelled: string[] = []; const loaded: string[] = []
  const controller = new module!.PlayerController({ load: async (_: any, track: any) => { loaded.push(track.id) }, play: async () => {} } as any, {
    resolve: (_: any, __: any, id: string) => new Promise<any>((done) => pending.set(id, done)),
    cancel: async (id: string) => { cancelled.push(id) }
  })
  const first = controller.playTrack(makeTrack({ id: 'a' }), { quality: 'original', strict: true })
  const second = controller.playTrack(makeTrack({ id: 'b' }), { quality: 'original', strict: true })
  await Promise.resolve()
  const ids = [...pending.keys()]
  pending.get(ids[1])!({}); await second
  pending.get(ids[0])!({}); await first
  expect(cancelled).toEqual([ids[0]]); expect(loaded).toEqual(['b'])
})
