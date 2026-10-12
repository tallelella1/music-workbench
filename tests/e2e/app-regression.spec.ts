import { _electron, expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { defaultSettings } from '../../src/shared/settings'
import { launchApp } from '../helpers/desktop'
import { makeAudioFile } from '../helpers/fixtures'
import { pendingSettingsShutdown, pendingImportShutdown } from '../helpers/settings-shutdown'
import { pendingNetworkShutdown } from '../helpers/network-shutdown'

for (const mode of ['playback', 'source-test', 'search', 'decode', 'lx-network'] as const) test(`normal close aborts pending ${mode} resources and waits actual cleanup`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'network-shutdown-'))
  try { console.log('Network shutdown evidence:', JSON.stringify(await pendingNetworkShutdown(directory, mode))) }
  finally { await rm(directory, { recursive: true, force: true }) }
})

test('close completes an accepted import before its index transaction and rejects later preference writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'import-shutdown-'))
  try { console.log('Import shutdown evidence:', JSON.stringify(await pendingImportShutdown(directory))) }
  finally { await rm(directory, { recursive: true, force: true }) }
})

test('normal main-window close drains an accepted preference whose atomic rename is still pending', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settings-shutdown-'))
  try { console.log('Settings shutdown evidence:', JSON.stringify(await pendingSettingsShutdown(directory))) }
  finally { await rm(directory, { recursive: true, force: true }) }
})

for (const outcome of ['success', 'timeout'] as const) test(`an already open settings page updates source startup ${outcome} without navigation or saving`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'settings-startup-')); const data = join(directory, 'data'); const id = randomUUID(); let app: ElectronApplication | undefined
  try {
    await mkdir(data, { recursive: true }); await writeFile(join(data, 'settings.json'), JSON.stringify({ schemaVersion: 1, assets: [], preferences: { ...defaultSettings(), enabledSources: [id] } }))
    const rawScript = outcome === 'timeout' ? 'while (true) {}' : "setTimeout(() => lx.send(lx.EVENT_NAMES.inited,{sources:{wy:{type:'music',actions:['musicUrl'],qualitys:['128k']}}}),1500)"
    await writeFile(join(data, 'extensions.json'), JSON.stringify([{ manifest: { id, name: 'Startup status', version: '', contractMajor: 1, platformIds: ['wy'], qualities: ['128k'], enabled: true, compatibilityError: null }, script: { name: 'Startup status', version: '', description: '', author: '', homepage: '', rawScript } }]))
    app = await _electron.launch({ args: [resolve('out/main/index.js')], env: { ...process.env, MUSIC_APP_USER_DATA_DIR: data } })
    await expect.poll(() => app!.windows().some(page => page.url().includes('/renderer/index.html'))).toBe(true)
    const page = app.windows().find(page => page.url().includes('/renderer/index.html'))!
    await page.getByRole('button', { name: '应用设置', exact: true }).click(); await expect(page.getByLabel('启用 Startup status')).toBeChecked()
    await expect(page.getByText(outcome === 'success' ? '实际状态：已运行' : /实际状态：未运行.*初始化超时/, { exact: outcome === 'success' })).toBeVisible({ timeout: 7000 })
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }) }
})
test('settings persist across actual Electron restart and missing sources leave local editing usable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'app-regression-')); let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    desktop = await launchApp(join(directory, 'data'))
    await desktop.page.getByRole('button', { name: '应用设置', exact: true }).click()
    await desktop.page.getByLabel('默认音量').fill('.35'); await desktop.page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(desktop.page.getByText('设置已保存', { exact: true })).toBeVisible()
    await desktop.page.getByRole('button', { name: '音效', exact: true }).click(); await desktop.page.getByLabel('EQ 1000 Hz').fill('3'); await desktop.page.getByLabel('播放速度', { exact: true }).fill('1.5')
    await expect.poll(async () => (await desktop!.page.evaluate(() => window.musicApp.settings.read())).effects[0].params.gainsDb).toEqual([0, 0, 0, 0, 0, 3, 0, 0, 0, 0])
    await desktop.app.close(); desktop = await launchApp(join(directory, 'data')); await desktop.page.getByRole('button', { name: '应用设置', exact: true }).click(); await expect(desktop.page.getByLabel('默认音量')).toHaveValue('0.35'); await expect(desktop.page.getByLabel('默认播放速度')).toHaveValue('1.5')
    const path = await makeAudioFile({ directory, name: '回归音乐.wav', durationSeconds: 5, toneHz: 440 }); const original = await readFile(path)
    await desktop.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, path)
    await desktop.page.getByRole('button', { name: '音乐库', exact: false }).click(); await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click(); await desktop.page.getByRole('button', { name: '播放 回归音乐', exact: true }).click(); await expect(desktop.page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    await desktop.page.getByRole('button', { name: '编辑当前歌曲', exact: true }).click(); await expect(desktop.page.getByRole('dialog', { name: '音频编辑' })).toBeVisible(); expect(await readFile(path)).toEqual(original)
  } finally { await desktop?.app.close(); await rm(directory, { recursive: true, force: true }) }
})

for (const failure of ['throw', 'hang'] as const) test(`remembered ${failure} source cannot block the main window or local playback/editor on startup`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'app-startup-')); const data = join(directory, 'data'); const id = randomUUID(); let app: ElectronApplication | undefined
  try {
    await mkdir(data, { recursive: true })
    await writeFile(join(data, 'settings.json'), JSON.stringify({ schemaVersion: 1, assets: [], preferences: { ...defaultSettings(), enabledSources: ['wy', 'kg', 'tx', id] } }))
    await writeFile(join(data, 'extensions.json'), JSON.stringify([{ manifest: { id, name: 'Startup failure', version: '', contractMajor: 1, platformIds: ['wy'], qualities: ['128k'], enabled: true, compatibilityError: null }, script: { name: 'Startup failure', version: '', description: '', author: '', homepage: '', rawScript: failure === 'throw' ? "throw new Error('startup fixture')" : 'while (true) {}' } }]))
    const path = await makeAudioFile({ directory, name: '启动本地音乐.wav', durationSeconds: 20, toneHz: 440 })
    app = await _electron.launch({ args: [resolve('out/main/index.js')], env: { ...process.env, MUSIC_APP_USER_DATA_DIR: data } })
    await expect.poll(() => app!.windows().some(page => page.url().includes('/renderer/index.html')), { timeout: 3000 }).toBe(true)
    const page = app.windows().find(page => page.url().includes('/renderer/index.html'))!; await page.waitForLoadState('domcontentloaded')
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, path)
    await page.getByRole('button', { name: '添加音乐', exact: true }).click(); await page.getByRole('button', { name: '播放 启动本地音乐', exact: true }).click(); await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    await page.getByRole('button', { name: '编辑当前歌曲', exact: true }).click(); await expect(page.getByRole('dialog', { name: '音频编辑' })).toBeVisible()
    await expect.poll(async () => (await page.evaluate(() => window.musicApp.extensions.list()))[0].compatibilityError, { timeout: 7000 }).toContain(failure === 'throw' ? '初始化失败' : '初始化超时')
    expect((await page.evaluate(() => window.musicApp.extensions.list()))[0].enabled).toBe(false)
    expect((await page.evaluate(() => window.musicApp.settings.read())).enabledSources).toContain(id)
  } finally { await app?.close(); await rm(directory, { recursive: true, force: true }) }
})
