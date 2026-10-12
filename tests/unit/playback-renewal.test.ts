import { expect, test } from 'vitest'
import { PlayerController } from '../../src/renderer/audio/player-controller'
import type { PlayerEngine } from '../../src/renderer/audio/player-engine'
import type { PlaybackResource } from '../../src/shared/player'
import { makeTrack } from '../helpers/fixtures'

test('resuming an expired resource resolves again and restores source position before playing', async () => {
  const actions: string[] = []; let calls = 0
  const engine = { prepareLoad: () => {}, load: async () => { actions.push('load') }, play: async () => { actions.push('play') }, snapshot: () => ({ trackId: 'track-1', sourceSeconds: 12, status: 'paused' }), seek: (position: number) => { actions.push(`seek:${position}`) } } as unknown as PlayerEngine
  const controller = new PlayerController(engine, { cancel: async () => {}, resolve: async () => { calls++; return { expiresAt: calls === 1 ? Date.now() + 30 : Date.now() + 10000 } as PlaybackResource } })
  await controller.playTrack(makeTrack(), { quality: '128k', strict: true })
  actions.length = 0
  await new Promise((done) => setTimeout(done, 40))
  expect(typeof controller.resume, 'controller must renew expired playback').toBe('function')
  await controller.resume()
  expect(calls).toBe(2); expect(actions).toEqual(['load', 'seek:12', 'play'])
})
