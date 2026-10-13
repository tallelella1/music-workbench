import { expect, test } from '@playwright/test'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from '../helpers/desktop'
import { makeAudioFile } from '../helpers/fixtures'
import { installAudioHarness } from '../helpers/audio-harness'

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'music-player-lifecycle-'))
  const paths = await Promise.all(['A', 'B', 'C'].map((name, index) => makeAudioFile({ directory, name: `${name}.wav`, durationSeconds: index ? 3 : 0.3, toneHz: 440 * (index + 1) })))
  const desktop = await launchApp(join(directory, 'data'))
  const close = async () => { await desktop.app.close(); await rm(directory, { recursive: true, force: true }) }
  try {
    await desktop.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: selected }) }, paths)
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    // Three real ffprobe imports are fixture setup; queue behavior is asserted below.
    await expect(desktop.page.getByRole('button', { name: '播放 C', exact: true })).toBeVisible({ timeout: 15_000 })
    return { ...desktop, paths, close }
  } catch (error) { await close(); throw error }
}

for (const eventType of ['ended', 'error'] as const) test(`late native ${eventType} from A cannot change B while resolving`, async () => {
  const desktop = await fixture()
  try {
    await installAudioHarness(desktop.page)
    const result = await desktop.page.evaluate(async (type) => {
      const tracks = (await window.musicApp.library.list()).tracks
      const a = tracks.find((track) => track.title === 'A')!; const b = tracks.find((track) => track.title === 'B')!
      const resources = await Promise.all([a, b].map((track) => window.musicApp.playback.resolve(track, { quality: 'original', strict: true }, crypto.randomUUID())))
      const held = window.audioTest.deferMediaEvents(type)
      const engine = new window.audioTest.PlayerEngine(); let ended = 0
      engine.onEnded(() => { ended++ })
      let resolveB!: (resource: typeof resources[0]) => void
      const controller = new window.audioTest.PlayerController(engine, { cancel: async () => {}, resolve: async (track) => track.id === a.id ? type === 'error' ? { ...resources[0], url: 'media://playback/missing-resource' } : resources[0] : new Promise((done) => { resolveB = done }) })
      try {
        const first = controller.playTrack(a, { quality: 'original', strict: true }).catch(() => {})
        const native = await held.event
        const old = engine.element!
        const second = controller.playTrack(b, { quality: 'original', strict: true })
        held.release()
        await first
        const during = engine.snapshot()
        resolveB(resources[1]); await second
        return { trusted: native.isTrusted, during, ended, after: engine.snapshot(), oldPaused: old.paused, bId: b.id }
      } finally { held.restore(); engine.dispose() }
    }, eventType)
    expect(result.trusted).toBe(true)
    expect(result.during).toMatchObject({ trackId: result.bId, status: 'loading', sourceSeconds: 0 })
    expect(result.ended).toBe(0)
    expect(result.after).toMatchObject({ trackId: result.bId, status: 'playing' })
    expect(result.oldPaused).toBe(true)
  } finally { await desktop.close() }
})

test('switch after load began ignores retired media events and completes the new selection', async () => {
  const desktop = await fixture()
  try {
    await installAudioHarness(desktop.page)
    const result = await desktop.page.evaluate(async () => {
      const tracks = (await window.musicApp.library.list()).tracks
      const b = tracks.find((track) => track.title === 'B')!; const c = tracks.find((track) => track.title === 'C')!
      const resources = await Promise.all([b, c].map((track) => window.musicApp.playback.resolve(track, { quality: 'original', strict: true }, crypto.randomUUID())))
      const held = window.audioTest.deferMediaEvents('loadedmetadata')
      const engine = new window.audioTest.PlayerEngine(); let ended = 0
      engine.onEnded(() => { ended++ })
      let resolveC!: (resource: typeof resources[0]) => void
      const controller = new window.audioTest.PlayerController(engine, { cancel: async () => {}, resolve: async (track) => track.id === b.id ? resources[0] : new Promise((done) => { resolveC = done }) })
      try {
        const first = controller.playTrack(b, { quality: 'original', strict: true })
        const native = await held.event
        const old = engine.element!
        const second = controller.playTrack(c, { quality: 'original', strict: true })
        held.release()
        old.dispatchEvent(new Event('ended')); old.dispatchEvent(new Event('error'))
        await first
        const during = engine.snapshot()
        resolveC(resources[1]); await second
        return { trusted: native.isTrusted, during, ended, after: engine.snapshot(), oldPaused: old.paused, cId: c.id }
      } finally { held.restore(); engine.dispose() }
    })
    expect(result.trusted).toBe(true)
    expect(result.during).toMatchObject({ trackId: result.cId, status: 'loading', sourceSeconds: 0 })
    expect(result.ended).toBe(0)
    expect(result.after).toMatchObject({ trackId: result.cId, status: 'playing' })
    expect(result.oldPaused).toBe(true)
  } finally { await desktop.close() }
})

test('removing queued B lets real A finish into C', async () => {
  const desktop = await fixture()
  try {
    await desktop.page.getByRole('button', { name: '播放 A', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()
    await desktop.page.getByRole('button', { name: '暂停', exact: true }).click()
    await desktop.page.getByRole('button', { name: '移除 B', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '播放 B', exact: true })).toHaveCount(0)
    await desktop.page.getByRole('button', { name: '播放', exact: true }).click()
    await expect(desktop.page.locator('.now-playing')).toContainText('C')
    await expect(desktop.page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()
    await desktop.page.getByRole('button', { name: '播放队列', exact: true }).click()
    await expect(desktop.page.getByRole('complementary', { name: '播放队列' }).getByRole('listitem')).toHaveCount(2)
  } finally { await desktop.close() }
})

test('removing playing C stops its media and leaves surviving queue playable', async () => {
  const desktop = await fixture()
  try {
    // Observe real media elements created by the UI, without replacing Audio or its playback.
    await desktop.page.evaluate(() => {
      const play = HTMLMediaElement.prototype.play
      ;(window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia = []
      HTMLMediaElement.prototype.play = function () { (window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.push(this); return play.call(this) }
    })
    await desktop.page.getByRole('button', { name: '播放 C', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()
    await desktop.page.getByRole('button', { name: '移除 C', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '播放 C', exact: true })).toHaveCount(0)
    await expect(desktop.page.locator('.player-bar')).toHaveAttribute('data-status', 'idle')
    await expect(desktop.page.locator('.now-playing')).toContainText('未在播放')
    expect(await desktop.page.evaluate(() => (window as unknown as { playedMedia: HTMLMediaElement[] }).playedMedia.every((media) => media.paused && !media.getAttribute('src')))).toBe(true)
    await desktop.page.getByRole('button', { name: '播放队列', exact: true }).click()
    const queue = desktop.page.getByRole('complementary', { name: '播放队列' })
    await expect(queue.getByRole('listitem')).toHaveCount(2)
    await queue.getByRole('button').filter({ hasText: 'B' }).click()
    await expect(desktop.page.locator('.now-playing')).toContainText('B')
    await expect(desktop.page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()
    expect((await readFile(desktop.paths[2])).length).toBeGreaterThan(44)
  } finally { await desktop.close() }
})
