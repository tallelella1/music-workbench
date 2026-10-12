import { expect, test } from '@playwright/test'
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from '../helpers/desktop'
import { makeAudioFile } from '../helpers/fixtures'
import { installAudioHarness } from '../helpers/audio-harness'
import { defaultEffects, EFFECT_PRESETS } from '../../src/shared/effects'
test('real Electron editor trims, previews processed audio and exports through save dialog', async () => {
  test.setTimeout(90000)
  const directory = await mkdtemp(join(tmpdir(), 'audio-editor-ui-'))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const path = await makeAudioFile({ directory, name: '编辑旋律 🎵.wav', durationSeconds: 60, toneHz: 1000 })
    const original = await readFile(path); const output = join(directory, '成品 🎵.flac')
    desktop = await launchApp(join(directory, 'data'))
    const errors: string[] = []; desktop.page.on('pageerror', error => errors.push(error.message))
    await expect(desktop.page.getByRole('button', { name: '编辑当前歌曲', exact: true })).toBeDisabled()
    await desktop.app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.path] }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output }) }, { path, output })
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await desktop.page.getByRole('button', { name: '播放 编辑旋律 🎵', exact: true }).click()
    await desktop.page.getByRole('button', { name: '编辑当前歌曲', exact: true }).click()
    const editor = desktop.page.getByRole('dialog', { name: '音频编辑' })
    await editor.getByLabel('开始秒').fill('10'); await editor.getByLabel('结束秒').fill('30')
    await editor.getByLabel('导出速度').fill('2')
    await editor.getByLabel('淡入秒').fill('1'); await editor.getByLabel('淡出秒').fill('1')
    await editor.getByRole('button', { name: '生成精确预览' }).click()
    const audio = editor.locator('audio')
    await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.duration), { timeout: 20000 }).toBe(10)
    await audio.evaluate((node: HTMLAudioElement) => node.play())
    await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.2)
    await expect(desktop.page.getByRole('button', { name: '播放', exact: true })).toBeVisible({ timeout: 3000 })
    const sourceSeek = desktop.page.getByRole('slider', { name: '播放进度', exact: true })
    const sourcePosition = await sourceSeek.inputValue(); await desktop.page.waitForTimeout(200)
    expect(await sourceSeek.inputValue()).toBe(sourcePosition)
    await audio.evaluate((node: HTMLAudioElement) => node.pause())
    await editor.getByLabel('导出格式').selectOption('flac')
    await editor.getByLabel('导出位深').selectOption('24')
    await editor.getByRole('button', { name: '保存成品' }).click()
    await expect(editor.getByText('导出完成', { exact: true })).toBeVisible({ timeout: 20000 })
    const rejected = await desktop.page.evaluate(async () => {
      const track = (await window.musicApp.library.list()).tracks[0]; const asset = await window.musicApp.assets.get(track.audioAssetId!)
      const edit = { assetId: asset.id, assetHash: asset.hash, range: { startSeconds: 0, endSeconds: 1 }, rate: 1, preservePitch: true, fadeInSeconds: 0, fadeOutSeconds: 0, effects: [] }
      try { await window.musicApp.export.start(edit, { format: 'wav', bitrateKbps: 320, bitDepth: 24 } as never); return false } catch { return true }
    })
    expect(rejected).toBe(true)
    expect(errors).toEqual([])
    expect(await readFile(path)).toEqual(original)
    expect((await readFile(output)).length).toBeGreaterThan(1000)
    await mkdir('docs/verification/screenshots', { recursive: true })
    await editor.evaluate(element => { element.scrollTop = 0 })
    await desktop.page.screenshot({ path: 'docs/verification/screenshots/audio-export.png' })
    await audio.evaluate((node: HTMLAudioElement) => { (window as unknown as { detachedPreview: HTMLAudioElement }).detachedPreview = node; return node.play() })
    await editor.getByRole('button', { name: '关闭音频编辑' }).click()
    expect(await desktop.page.evaluate(() => (window as unknown as { detachedPreview: HTMLAudioElement }).detachedPreview.paused)).toBe(true)
  } finally { await desktop?.app.close(); await rm(directory, { recursive: true, force: true }) }
})

test('same presets match actual Web Audio and FFmpeg spectra and unnormalized reverb', async () => {
  test.setTimeout(60000)
  const directory = await mkdtemp(join(tmpdir(), 'export-parity-'))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const path = await makeAudioFile({ directory, name: 'parity.wav', durationSeconds: 1, toneHz: 1000 })
    const bytes = await readFile(path); bytes.fill(0, 44)
    for (let i = 4410; i < 13230; i++) bytes.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 1000 * (i - 4410) / 44100) * 3276.8), 44 + i * 2)
    await writeFile(path, bytes)
    desktop = await launchApp(join(directory, 'data'))
    await desktop.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, path)
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '播放 parity', exact: true })).toBeVisible()
    await installAudioHarness(desktop.page)
    const verb = defaultEffects(); verb[1].params.wet = 0.5; verb[1].params.decaySeconds = 1
    const configs = [...EFFECT_PRESETS.map(p => ({ name: p.name, configs: p.configs })), { name: 'wet50', configs: verb }]
    const measurements = await desktop.page.evaluate(async presets => {
      const track = (await window.musicApp.library.list()).tracks[0]; const asset = await window.musicApp.assets.get(track.audioAssetId!)
      const results = []
      for (const preset of presets) {
        const live = await window.audioTest.renderEffects(preset.configs)
        const preview = await window.musicApp.export.preview({ assetId: asset.id, assetHash: asset.hash, range: { startSeconds: 0, endSeconds: 1 }, rate: 1, preservePitch: true, fadeInSeconds: 0, fadeOutSeconds: 0, effects: preset.configs }, crypto.randomUUID())
        const context = new AudioContext({ sampleRate: 44100 })
        try {
          const decoded = await context.decodeAudioData(await (await fetch(window.musicApp.assets.url(preview.id))).arrayBuffer())
          const data = decoded.getChannelData(0)
          const rms = (start: number, end: number) => Math.sqrt(data.slice(Math.round(start * 44100), Math.round(end * 44100)).reduce((sum, v) => sum + v*v, 0) / ((end-start)*44100))
          const samples = Array.from(data.slice(8820, 8840))
          const spectrum = window.audioTest.exportSpectrum(data)
          results.push({ name: preset.name, liveBody: live.body, offlineBody: rms(.18,.27), liveTail: live.tail, offlineTail: rms(.4,.8), maxSampleError: Math.max(...samples.map((value, i) => Math.abs(value - live.samples[i]))), maxSpectrumError: Math.max(...spectrum.map((v, i) => Math.abs(v-live.spectrum[i]))) })
        } finally { await context.close() }
      }
      return results
    }, configs)
    console.log('Realtime/offline parity measurements:', JSON.stringify(measurements))
    for (const result of measurements) {
      expect(Math.abs(result.offlineBody / result.liveBody - 1), result.name).toBeLessThan(.01)
      expect(result.maxSampleError, result.name).toBeLessThan(.0001)
      expect(result.maxSpectrumError, result.name).toBeLessThan(.00001)
      if (result.liveTail > .000001) expect(Math.abs(result.offlineTail / result.liveTail - 1), result.name).toBeLessThan(.01)
    }
    const impulsePath = await makeAudioFile({ directory, name: 'impulse.wav', durationSeconds: 1, toneHz: 1000 })
    const impulseBytes = await readFile(impulsePath); impulseBytes.fill(0,44); impulseBytes.writeInt16LE(16384,44+13230*2); await writeFile(impulsePath,impulseBytes)
    await desktop.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, impulsePath)
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '播放 impulse', exact: true })).toBeVisible()
    const impulseErrors = await desktop.page.evaluate(async () => {
      const track = (await window.musicApp.library.list()).tracks.find(t => t.title === 'impulse')!; const asset = await window.musicApp.assets.get(track.audioAssetId!)
      const effects = window.audioTest.defaultEffects(); effects[1].params = { wet: 1, decaySeconds: .1, seed: 42 }
      const reference = await window.audioTest.renderExportImpulse(effects)
      const output = await window.musicApp.export.preview({ assetId: asset.id, assetHash: asset.hash, range: { startSeconds: 0, endSeconds: 1 }, rate: 1, preservePitch: true, fadeInSeconds: 0, fadeOutSeconds: 0, effects }, crypto.randomUUID())
      const context = new AudioContext({ sampleRate: 44100 })
      try {
        const buffer = await context.decodeAudioData(await (await fetch(window.musicApp.assets.url(output.id))).arrayBuffer())
        return [0,1].map(c => Math.max(...Array.from(buffer.getChannelData(c).slice(13230,17640)).map((value, i) => Math.abs(value-reference[c][i]))))
      } finally { await context.close() }
    })
    console.log('Stereo convolution impulse maximum error:', JSON.stringify(impulseErrors))
    for (const error of impulseErrors) expect(error).toBeLessThan(1e-7)
  } finally { await desktop?.app.close(); await rm(directory, { recursive: true, force: true }) }
})
