import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from '../helpers/desktop'
import { installAudioHarness } from '../helpers/audio-harness'

test('EQ rejects out-of-range gain, wrong version and non-realtime definitions', async () => {
  const module = await import('../../src/shared/effect-registry').catch(() => null)
  expect(module, 'EffectRegistry must exist').not.toBeNull()
  const registry = new module!.EffectRegistry()
  expect(() => registry.validate({ effectId: 'eq-10', paramVersion: 1, enabled: true,
    params: { gainsDb: [13, 0, 0, 0, 0, 0, 0, 0, 0, 0], preampDb: 0 } }, 'realtime')).toThrow()
  expect(() => registry.validate({ effectId: 'reverb', paramVersion: 2, enabled: true, params: {} }, 'realtime')).toThrow()
  expect(registry.validate({ effectId: 'reverb', paramVersion: 1, enabled: true, params: { wet: 0.5, decaySeconds: 1.5, seed: 1 } }, 'export').params.wet).toBe(0.5)
})
test('shared seeded impulse response is deterministic with finite stereo decay', async () => {
  const module = await import('../../src/shared/impulse-response').catch(() => null)
  expect(module, 'Shared impulse response must exist').not.toBeNull()
  const first = module!.createImpulseResponse(44100, 0.1, 1)
  expect(first).toEqual(module!.createImpulseResponse(44100, 0.1, 1))
  expect(first[0].length).toBe(4410)
  expect(first[0]).not.toEqual(first[1])
  expect(first.flatMap((channel) => [...channel]).every(Number.isFinite)).toBe(true)
})

test('real offline Web Audio changes EQ samples, produces reverb tail, restores bypass and survives a failed effect', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-audio-nodes-'))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    desktop = await launchApp(directory); await installAudioHarness(desktop.page)
    const result = await desktop.page.evaluate(async () => {
      const { defaultEffects, renderEffects } = window.audioTest
      const flat = await renderEffects(defaultEffects())
      const eq = defaultEffects(); (eq[0].params.gainsDb as number[])[5] = 12
      const boosted = await renderEffects(eq)
      const bypass = await renderEffects(eq, true)
      const verb = defaultEffects(); verb[1].params.wet = 0.5; verb[1].params.decaySeconds = 1
      const reverberated = await renderEffects(verb)
      const invalid = defaultEffects(); (invalid[0].params.gainsDb as number[])[5] = 13
      const failed = await renderEffects(invalid)
      const lowRate = await renderEffects(defaultEffects(), false, 22050)
      return { flat, boosted, bypass, reverberated, failed, lowRate }
    })
    expect(result.boosted.body / result.flat.body).toBeGreaterThan(3.8)
    expect(Math.abs(result.bypass.body - result.flat.body)).toBeLessThan(0.00001)
    expect(result.boosted.samples).not.toEqual(result.flat.samples)
    expect(result.reverberated.tail).toBeGreaterThan(0.00001)
    expect(result.flat.tail).toBeLessThan(0.000001)
    expect(result.failed.errors).toHaveLength(1)
    expect(Math.abs(result.failed.body - result.flat.body)).toBeLessThan(0.00001)
    expect(result.lowRate.available).not.toContain(16000)
    console.log('Real offline node measurements:', JSON.stringify(result, (_, value) => Array.isArray(value) && value.length === 20 ? '[20 samples]' : value))
  } finally { await desktop?.app.close(); await rm(directory, { recursive: true, force: true }) }
}, 20000)
