import { expect, test } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir, link } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { runtimeBinary, probeMedia } from '../../src/main/assets/media-probe'
import { AudioExportService } from '../../src/main/export/audio-export-service'
import type { AudioEdit, AudioExportOptions } from '../../src/shared/audio-export'
import { FfmpegWorker } from '../../src/main/export/ffmpeg-worker'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetRegistry } from '../../src/main/assets/asset-registry'
import { StorageRepository } from '../../src/main/storage/repository'
import { TaskService } from '../../src/main/jobs/task-service'
import { makeAudioFile } from '../helpers/fixtures'
import { defaultEffects } from '../../src/shared/effects'
test('20 source seconds at double speed render 10 seconds without changing input', async () => {
  const module = await import('../../src/main/export/audio-export-service').catch(() => null)
  expect(module, 'audio exporter is missing').not.toBeNull()
  const directory = await mkdtemp(join(tmpdir(), 'audio-export-'))
  try {
    const ctx = { requestId: 'export-test', signal: new AbortController().signal }
    const path = await makeAudioFile({ directory, name: '中文 🎵 source.wav', durationSeconds: 60, toneHz: 1000 })
    const original = await readFile(path)
    const assets = new AssetRegistry(new StorageRepository(join(directory, 'data')), join(directory, 'assets'))
    const source = await assets.importFile(path, 'audio', ctx)
    const exporter = new module!.AudioExportService(assets, new TaskService(), join(directory, 'derived'), async () => null)
    const edit = { assetId: source.id, assetHash: source.hash, range: { startSeconds: 10, endSeconds: 30 }, rate: 2, preservePitch: true, fadeInSeconds: 0, fadeOutSeconds: 0, effects: defaultEffects() }
    const output = await exporter.renderPreview(edit, ctx)
    expect(Math.abs(output.media.durationSeconds! - 10)).toBeLessThanOrEqual(1 / 44100)
    expect(await readFile(path)).toEqual(original)
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 30000)

const ctx = () => ({ requestId: 'export-test', signal: new AbortController().signal })
export async function decode(path: string) {
  const { stdout } = await promisify(execFile)(runtimeBinary('ffmpeg'), ['-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], { encoding: 'buffer', maxBuffer: 40 * 1024 * 1024, windowsHide: true })
  return Array.from({ length: stdout.length / 4 }, (_, i) => stdout.readFloatLE(i * 4))
}
test('real WAV frames, fades, EQ, reverb, encoders, immutable bytes and safe cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'audio-export-real-'))
  try {
    const path = await makeAudioFile({ directory, name: '中文 空格 🎵.wav', durationSeconds: 60, toneHz: 1000 })
    const original = await readFile(path)
    const assets = new AssetRegistry(new StorageRepository(join(directory, 'data')), join(directory, 'assets'))
    const source = await assets.importFile(path, 'audio', ctx())
    const tasks = new TaskService(); let target: string | null = null
    const exporter = new AudioExportService(assets, tasks, join(directory, 'derived'), async () => target)
    await expect(new FfmpegWorker().run({ args: ['-i','arbitrary'], outputPath: path, outputDurationSeconds: 1 }, ctx(), () => {})).rejects.toThrow(/未注册/)
    const edit: AudioEdit = { assetId: source.id, assetHash: source.hash, range: { startSeconds: 10, endSeconds: 30 }, rate: 1, preservePitch: true, fadeInSeconds: 0, fadeOutSeconds: 0, effects: defaultEffects() }
    const sample = async (value: AudioEdit) => { const out = await exporter.renderPreview(value, ctx()); const bytes = await assets.readBytes(out.id); const location = join(directory, 'decode.wav'); await writeFile(location, bytes); return { out, samples: await decode(location) } }
    const flat = await sample(edit)
    expect(flat.samples.length).toBe(20 * 44100 * 2)
    expect(flat.out.sourceTimeMap).toMatchObject({ sourceAssetId: source.id, sourceHash: source.hash, startSeconds: 10, endSeconds: 30, rate: 1, outputDurationSeconds: 20 })
    for (const rate of [0.5, 2]) for (const preservePitch of [true, false]) {
      const out = await sample({ ...edit, rate, preservePitch })
      expect(out.samples.length).toBe(20 / rate * 44100 * 2)
      expect(out.out.media.durationSeconds).toBe(20 / rate)
      let crossings = 0
      for (let i = 44100; i < 132300; i += 2) if (out.samples[i] <= 0 && out.samples[i+2] > 0) crossings++
      expect(Math.abs(crossings - (preservePitch ? 1000 : 1000 * rate))).toBeLessThan(3)
    }
    const faded = await sample({ ...edit, fadeInSeconds: 1, fadeOutSeconds: 1 })
    expect(Math.abs(faded.samples[20])).toBeLessThan(Math.abs(flat.samples[20]) / 100)
    expect(Math.abs(faded.samples.at(-20)!)).toBeLessThan(Math.abs(flat.samples.at(-20)!) / 100)
    const eq = defaultEffects(); (eq[0].params.gainsDb as number[])[5] = 6
    const boosted = await sample({ ...edit, effects: eq })
    const rms = (s: number[]) => Math.sqrt(s.slice(44100, 88200).reduce((sum, v) => sum + v*v, 0) / 44100)
    expect(rms(boosted.samples) / rms(flat.samples)).toBeCloseTo(10 ** (6/20), 2)
    const verb = defaultEffects(); verb[1].params.wet = 0.5; verb[1].params.decaySeconds = 0.2
    const wet = await sample({ ...edit, effects: verb })
    expect(wet.samples).not.toEqual(flat.samples)
    const snap = await assets.checkedSnapshot(source.id, source.hash, ctx())
    await writeFile(path, 'mutated after snapshot')
    expect(await readFile(snap.path)).toEqual(original)
    await expect(exporter.renderPreview(edit, ctx())).rejects.toThrow(/更改|丢失/)
    await snap.release(); await writeFile(path, original)
    target = path
    let id = await exporter.start(edit, { format: 'wav', bitDepth: 16, bitrateKbps: null }, ctx())
    await expect.poll(() => tasks.get(id).status).toBe('failed')
    const hardlink = join(directory, 'same bytes.wav'); await link(path, hardlink); target = hardlink
    id = await exporter.start(edit, { format: 'wav', bitDepth: 16, bitrateKbps: null }, ctx())
    await expect.poll(() => tasks.get(id).status).toBe('failed')
    const longDirectory = join(directory, ...Array(5).fill('很长的保存目录 with spaces 🎵 '.repeat(3))); await mkdir(longDirectory, { recursive: true })
    for (const options of [ { format: 'wav', bitDepth: 16, bitrateKbps: null }, { format: 'wav', bitDepth: 24, bitrateKbps: null }, { format: 'wav', bitDepth: 32, bitrateKbps: null }, { format: 'flac', bitDepth: 16, bitrateKbps: null }, { format: 'flac', bitDepth: 24, bitrateKbps: null }, { format: 'mp3', bitDepth: null, bitrateKbps: 128 }, { format: 'mp3', bitDepth: null, bitrateKbps: 320 } ] as AudioExportOptions[]) {
      target = join(longDirectory, `导出 🎵 ${options.bitDepth ?? options.bitrateKbps}.${options.format}`)
      id = await exporter.start({ ...edit, rate: 2 }, options, ctx())
      await expect.poll(() => tasks.get(id).status, { timeout: 20000 }).toBe('completed')
      const media = await probeMedia(target, ctx())
      expect(Math.abs(media.durationSeconds! - 10)).toBeLessThanOrEqual(options.format === 'mp3' ? 0.1 : 1 / 44100)
      if (options.bitDepth) expect(media.bitDepth).toBe(options.bitDepth)
      else expect(media.bitrate).toBe(options.bitrateKbps! * 1000)
      expect((await decode(target)).some(value => Math.abs(value) > 0.01)).toBe(true)
    }
    target = join(directory, 'cancel.wav')
    id = await exporter.start({ ...edit, range: { startSeconds: 0, endSeconds: 60 }, rate: 0.5, effects: verb }, { format: 'wav', bitDepth: 32, bitrateKbps: null }, ctx())
    await expect.poll(async () => (await readdir(directory)).some(name => name.endsWith('.tmp'))).toBe(true)
    tasks.cancel(id)
    await expect.poll(async () => (await readdir(directory)).filter(name => name.startsWith('.audio-')).length).toBe(0)
    expect(tasks.get(id).status).toBe('cancelled')
    expect(await readFile(path)).toEqual(original)
    expect((await readdir(join(directory, 'assets'))).filter(name => name.startsWith('snapshot-'))).toEqual([])
    await expect(exporter.renderPreview({ ...edit, assetId: 'remote-playback-id' }, ctx())).rejects.toThrow(/素材/)
    await rm(path)
    await expect(exporter.renderPreview(edit, ctx())).rejects.toThrow(/重新导入/)
    await writeFile(path, original)
    const blocker = join(directory, 'blocked-private-location'); await writeFile(blocker, 'blocked')
    const blockedAssets = new AssetRegistry(new StorageRepository(join(directory, 'data')), blocker)
    await expect(blockedAssets.checkedSnapshot(source.id, source.hash, ctx())).rejects.toThrow('无法创建受控音频快照')
    const blockedPreview = new AudioExportService(assets, tasks, blocker, async () => null)
    await expect(blockedPreview.renderPreview(edit, ctx())).rejects.toThrow('无法创建音频预览')
    console.log('Export evidence: exact 44100 Hz frames for 0.5/1/2, preservePitch on/off; all 7 encoders reopened; EQ +6 dB ratio', rms(boosted.samples) / rms(flat.samples), 'cancel cleanup and immutable snapshot verified')
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 180000)
