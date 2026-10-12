import { expect, test } from '@playwright/test'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from '../helpers/desktop'
import { makeAudioFile } from '../helpers/fixtures'
import { installAudioHarness } from '../helpers/audio-harness'

test('real UI plays a local queue, pauses, seeks source time, controls effects and advances on ended', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-playback-ui-'))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const paths = await Promise.all([440, 880].map((toneHz, index) => makeAudioFile({ directory, name: `旋律 ${index}🎵.wav`, durationSeconds: 3, toneHz })))
    desktop = await launchApp(join(directory, 'data'))
    const errors: string[] = []; desktop.page.on('pageerror', (error) => errors.push(error.message))
    await desktop.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected }) }, paths)
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await desktop.page.getByRole('button', { name: '播放 旋律 0🎵', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()
    await desktop.page.getByRole('button', { name: '暂停', exact: true }).click()
    const seek = desktop.page.getByRole('slider', { name: '播放进度', exact: true })
    await seek.fill('2.5')
    await expect(seek).toHaveValue('2.5')
    const paused = Number(await seek.inputValue()); await desktop.page.waitForTimeout(300)
    expect(Number(await seek.inputValue())).toBeCloseTo(paused, 2)
    await desktop.page.getByRole('button', { name: '音效', exact: true }).click()
    await desktop.page.getByRole('combobox', { name: '音色预设' }).selectOption('温暖')
    await expect(desktop.page.getByRole('slider', { name: 'EQ 31 Hz', exact: true })).toHaveValue('3')
    await desktop.page.getByRole('slider', { name: '播放速度', exact: true }).fill('2')
    await expect(desktop.page.getByRole('checkbox', { name: '保持音高', exact: true })).toBeChecked()
    await desktop.page.screenshot({ path: '.superpowers/sdd/2026-10-03-music-player-implementation/task-3-ui.png' })
    await desktop.page.getByRole('button', { name: '关闭音效面板' }).click()
    await desktop.page.getByRole('button', { name: '播放', exact: true }).click()
    await expect(desktop.page.locator('.now-playing')).toContainText('旋律 1🎵')
    await desktop.page.getByRole('button', { name: '播放队列', exact: true }).click()
    await expect(desktop.page.getByRole('complementary', { name: '播放队列' }).getByRole('listitem')).toHaveCount(2)
    await desktop.page.getByRole('button', { name: '关闭播放队列' }).click()
    await desktop.page.getByRole('button', { name: '上一首', exact: true }).click()
    await expect(desktop.page.locator('.now-playing')).toContainText('旋律 0🎵')
    const snapshot = await desktop.page.evaluate(() => window.musicApp.library.list())
    const original = await readFile(paths[0]); await writeFile(paths[0], 'changed original')
    const error = await desktop.page.evaluate(async (track) => { try { await window.musicApp.playback.resolve(track, { quality: 'original', strict: true }, crypto.randomUUID()); return null } catch (failure) { return (failure as { message: string }).message } }, snapshot.tracks[0])
    expect(error).toMatch(/重新导入/)
    await writeFile(paths[0], original)
    expect(errors).toEqual([])
  } finally { await desktop?.app.close(); await rm(directory, { recursive: true, force: true }) }
})

test('real HTMLMediaElement 440 Hz WAV measures 0.5/1/2 rate duration and preservePitch spectra', async () => {
  test.setTimeout(60000)
  const directory = await mkdtemp(join(tmpdir(), 'music-speed-spectrum-'))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const path = await makeAudioFile({ directory, name: '440 Hz.wav', durationSeconds: 2, toneHz: 440 })
    desktop = await launchApp(join(directory, 'data'))
    await desktop.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, path)
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '播放 440 Hz', exact: true })).toBeVisible()
    await installAudioHarness(desktop.page)
    const results = await desktop.page.evaluate(async () => {
      const track = (await window.musicApp.library.list()).tracks[0]
      const resource = await window.musicApp.playback.resolve(track, { quality: 'original', strict: true }, crypto.randomUUID())
      const results = []
      for (const rate of [0.5, 1, 2]) for (const preservePitch of [false, true]) results.push({ rate, preservePitch, ...await window.audioTest.measurePlayback(resource, track, rate, preservePitch) })
      return results
    })
    for (const result of results) {
      expect(Math.abs(result.elapsed - 2 / result.rate)).toBeLessThan(0.4)
      expect(Math.abs(result.frequency - (result.preservePitch ? 440 : 440 * result.rate))).toBeLessThan(20)
      expect(result.peakDb).toBeGreaterThan(-45)
      expect(result.snapshot.sourceSeconds).toBeCloseTo(2, 2)
    }
    console.log('Actual media timing and spectrum:', JSON.stringify(results))
    const paused = await desktop.page.evaluate(async () => {
      const track = (await window.musicApp.library.list()).tracks[0]
      const resource = await window.musicApp.playback.resolve(track, { quality: 'original', strict: true }, crypto.randomUUID())
      const engine = new window.audioTest.PlayerEngine()
      try { await engine.load(resource, track, 'pause-seek'); engine.seek(1.5); await engine.play(); engine.pause(); const before = engine.snapshot().sourceSeconds; await new Promise((done) => setTimeout(done, 300)); return { before, after: engine.snapshot().sourceSeconds } } finally { engine.dispose() }
    })
    expect(paused.before).toBeCloseTo(1.5, 1); expect(paused.after).toBeCloseTo(paused.before, 2)
  } finally { await desktop?.app.close(); await rm(directory, { recursive: true, force: true }) }
})
