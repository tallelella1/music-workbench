import { expect, test } from 'vitest'
import { defaultEffects } from '../../src/shared/effects'
import { configureMediaRuntime } from '../../src/main/assets/media-probe'
import { resolve } from 'node:path'
const edit = { assetId: 'a', assetHash: 'a'.repeat(64), range: { startSeconds: 10, endSeconds: 30 }, rate: 2, preservePitch: true, fadeInSeconds: 1, fadeOutSeconds: 2, effects: defaultEffects() }
const media = { durationSeconds: 60, durationReliable: true, sampleRate: 44100, channels: 1, codec: 'pcm_s16le', bitDepth: 16, bitrate: 705600, width: null, height: null }
test('builds source trim, output rate, sample-exact timeline and output-time fades', async () => {
  const module = await import('../../src/main/export/filter-builder').catch(() => null)
  expect(module, 'export filter builder is missing').not.toBeNull()
  const graph = module!.buildFilterGraph(edit, media)
  expect(graph.outputDurationSeconds).toBe(10)
  expect(graph.filters).toContain('atempo=2')
  expect(graph.filters).toContain('end_sample=441000')
  expect(graph.filters).toContain('afade=t=out:st=8:d=2')
  expect(() => module!.buildFilterGraph({ ...edit, fadeOutSeconds: 11 }, media)).toThrow()
  expect(() => module!.buildFilterGraph({ ...edit, effects: [{ effectId: 'unknown', paramVersion: 1, enabled: true, params: {} }] }, media)).toThrow()
  expect(() => module!.buildFilterGraph({ ...edit, effects: [...edit.effects, edit.effects[0]] }, media)).toThrow(/重复/)
  expect(() => module!.buildFilterGraph({ ...edit, range: { startSeconds: 10, endSeconds: 61 } }, media)).toThrow()
  expect(() => module!.buildFilterGraph({ ...edit, fadeInSeconds: 9, fadeOutSeconds: 9 }, media)).not.toThrow()
  const low = module!.buildFilterGraph(edit, { ...media, sampleRate: 22050 })
  expect(low.filters).not.toContain('f=16000')
  expect(low.filters).toContain('f=8000')
})
test('missing bundled runtime reports a safe message without absolute host paths', async () => {
  const { FfmpegWorker } = await import('../../src/main/export/ffmpeg-worker')
  configureMediaRuntime(resolve('missing-private-runtime'))
  try { await expect(new FfmpegWorker().capabilities()).rejects.toThrow('音频处理运行时不可用') }
  finally { configureMediaRuntime(resolve('resources')) }
})
test('rejects illegal encoder combinations and validates all boundary values', async () => {
  const module = await import('../../src/shared/audio-export').catch(() => null)
  expect(module, 'export schemas are missing').not.toBeNull()
  expect(module!.AudioExportOptionsSchema.safeParse({ format: 'mp3', bitrateKbps: 128, bitDepth: 24 }).success).toBe(false)
  expect(module!.AudioExportOptionsSchema.safeParse({ format: 'flac', bitrateKbps: null, bitDepth: 32 }).success).toBe(false)
  expect(module!.AudioEditSchema.safeParse({ ...edit, rate: Infinity }).success).toBe(false)
  expect(module!.AudioExportOptionsSchema.safeParse({ format: 'wav', bitrateKbps: 320, bitDepth: 24 }).success).toBe(false)
  expect(module!.AudioExportOptionsSchema.safeParse({ format: 'mp3', bitrateKbps: 192, bitDepth: null }).success).toBe(false)
  expect(module!.AudioEditSchema.safeParse({ ...edit, path: 'C:/audio.wav' }).success).toBe(false)
})
