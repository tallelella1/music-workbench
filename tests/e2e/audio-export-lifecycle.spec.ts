import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from '../helpers/desktop'
import { makeAudioFile } from '../helpers/fixtures'
import { defaultEffects } from '../../src/shared/effects'

for (const mode of ['export', 'preview'] as const) test(`closing actual main window drains real ${mode} worker before Electron exits`, async () => {
  test.setTimeout(90000)
  const directory = await mkdtemp(join(tmpdir(), 'audio-exit-ui-'))
  const timeline = join(directory, 'lifecycle.jsonl'); const data = join(directory, 'data')
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  let electronProcess: ReturnType<Awaited<ReturnType<typeof launchApp>>['app']['process']> | undefined
  try {
    const path = await makeAudioFile({ directory, name: 'shutdown.wav', durationSeconds: 300, toneHz: 440 })
    const original = await readFile(path); const output = join(directory, 'saved.wav')
    desktop = await launchApp(data)
    electronProcess = desktop.app.process()
    await desktop.app.evaluate(({ app, dialog }, args) => {
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs')
      const cp = process.getBuiltinModule('node:child_process') as typeof import('node:child_process')
      const spawn = cp.spawn
      const log = (value: object) => fs.appendFileSync(args.timeline, JSON.stringify(value) + '\n')
      cp.spawn = ((...params: Parameters<typeof cp.spawn>) => {
        const child = spawn(...params)
        if (Array.isArray(params[1]) && params[1].includes('-progress')) {
          log({ event: 'spawn', pid: child.pid })
          child.once('close', code => log({ event: 'worker-close', pid: child.pid, code }))
        }
        return child
      }) as typeof cp.spawn
      app.on('will-quit', () => log({ event: 'will-quit' }))
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.path] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: args.output })
    }, { path, output, timeline })
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '播放 shutdown', exact: true })).toBeVisible()
    const effects = defaultEffects(); effects[1].params = { wet: .8, decaySeconds: 5, seed: 1 }
    await desktop.page.evaluate(async args => {
      const track = (await window.musicApp.library.list()).tracks[0]; const asset = await window.musicApp.assets.get(track.audioAssetId!)
      const edit = { assetId: asset.id, assetHash: asset.hash, range: { startSeconds: 0, endSeconds: 300 }, rate: .5, preservePitch: true, fadeInSeconds: 0, fadeOutSeconds: 0, effects: args.effects }
      // Keep the request in flight; this test closes the real main window during the actual process.
      if (args.mode === 'export') void window.musicApp.export.start(edit, { format: 'wav', bitrateKbps: null, bitDepth: 24 }).catch(() => {})
      else void window.musicApp.export.preview(edit, crypto.randomUUID()).catch(() => {})
    }, { mode, effects })
    await expect.poll(async () => { try { return (await readFile(timeline,'utf8')).includes('spawn') } catch { return false } }, { intervals: [10], timeout: 20000 }).toBe(true)
    const before = (await readFile(timeline,'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(before.some(row => row.event === 'worker-close')).toBe(false)
    await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()).catch(() => {})
    await expect.poll(() => electronProcess!.exitCode, { timeout: 20000 }).toBe(0)
    const events = (await readFile(timeline,'utf8')).trim().split('\n').map(line => JSON.parse(line))
    console.log(`${mode} shutdown timeline:`, JSON.stringify(events))
    const closeIndex = events.findIndex(row => row.event === 'worker-close'); const quitIndex = events.findIndex(row => row.event === 'will-quit')
    expect(closeIndex).toBeGreaterThan(-1); expect(quitIndex).toBeGreaterThan(closeIndex)
    for (const row of events.filter(row => row.event === 'spawn')) expect(() => process.kill(row.pid,0)).toThrow()
    for (const location of [directory, join(data,'derived-audio'), join(data,'artwork')]) {
      const entries = await readdir(location).catch(() => [] as string[])
      expect(entries.filter(name => name.startsWith('.audio-') || name.startsWith('snapshot-'))).toEqual([])
    }
    expect(await readFile(path)).toEqual(original)
    expect(await readFile(output).catch(() => null)).toBeNull()
  } finally {
    // RED may leave its real child behind. Kill only observed test-owned PIDs after the app has exited.
    if (desktop && electronProcess?.exitCode === null) await desktop.app.close()
    const events = (await readFile(timeline,'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    for (const row of events.filter(row => row.event === 'spawn')) { try { process.kill(row.pid, 'SIGTERM') } catch {} }
    await new Promise(done => setTimeout(done,300))
    await rm(directory,{ recursive: true, force: true })
  }
})

test('reopened editor reports a destination conflict while the earlier export continues in background', async () => {
  test.setTimeout(60000)
  const directory = await mkdtemp(join(tmpdir(),'audio-reopen-ui-'))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    const path = await makeAudioFile({ directory, name: 'background.wav', durationSeconds: 300, toneHz: 440 })
    const output = join(directory,'background-output.wav')
    desktop = await launchApp(join(directory,'data'))
    await desktop.app.evaluate(({ dialog }, args) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.path] })
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: args.output })
    },{ path, output })
    await desktop.page.getByRole('button',{ name: '添加音乐', exact: true }).click()
    await desktop.page.getByRole('button',{ name: '播放 background', exact: true }).click()
    await desktop.page.getByRole('button',{ name: '编辑当前歌曲', exact: true }).click()
    const effects = defaultEffects(); effects[1].params = { wet: .8, decaySeconds: 5, seed: 1 }
    const id = await desktop.page.evaluate(async effectConfigs => {
      const track = (await window.musicApp.library.list()).tracks[0]; const asset = await window.musicApp.assets.get(track.audioAssetId!)
      return window.musicApp.export.start({ assetId: asset.id, assetHash: asset.hash, range: { startSeconds: 0, endSeconds: 300 }, rate: .5, preservePitch: true, fadeInSeconds: 0, fadeOutSeconds: 0, effects: effectConfigs },{ format: 'wav', bitrateKbps: null, bitDepth: 24 })
    },effects)
    const editor = desktop.page.getByRole('dialog',{ name: '音频编辑' })
    await editor.getByRole('button',{ name: '关闭音频编辑' }).click()
    await desktop.page.getByRole('button',{ name: '编辑当前歌曲', exact: true }).click()
    await editor.getByRole('button',{ name: '保存成品' }).click()
    await expect(editor.getByRole('alert')).toContainText('此目的文件正在处理中')
    expect(await desktop.page.evaluate(async jobId => (await window.musicApp.export.get(jobId)).status,id)).toBe('running')
    await desktop.page.evaluate(async jobId => window.musicApp.jobs.cancel(jobId),id)
    await desktop.app.close(); desktop = undefined
    expect(await readFile(output).catch(() => null)).toBeNull()
    expect((await readdir(directory)).filter(name => name.startsWith('.audio-'))).toEqual([])
  } finally { await desktop?.app.close(); await rm(directory,{ recursive: true, force: true }) }
})
