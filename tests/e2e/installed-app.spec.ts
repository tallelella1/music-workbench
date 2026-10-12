import { _electron, expect, test, type ElectronApplication } from '@playwright/test'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { makeAudioFile } from '../helpers/fixtures'
import { pendingSettingsShutdown, pendingImportShutdown } from '../helpers/settings-shutdown'
import { pendingNetworkShutdown } from '../helpers/network-shutdown'

const evidencePrefix = process.env.MUSIC_APP_VERIFICATION_PREFIX ?? 'task-7-fix-1'
const acceptancePrefix = process.env.MUSIC_APP_VERIFICATION_PREFIX ? `${evidencePrefix}-installed` : 'task-7-installed'
for (const mode of ['playback', 'source-test', 'search', 'decode', 'lx-network'] as const) test(`actual installed binary aborts pending ${mode} and waits owned cleanup`, async () => {
  test.skip(!process.env.MUSIC_APP_INSTALLED_EXECUTABLE, 'Run only against the explicitly installed binary')
  const root = resolve('.superpowers/sdd/2026-10-03-music-player-implementation/Installed acceptance with spaces'); await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, `network ${mode} `))
  try {
    const evidence = await pendingNetworkShutdown(directory, mode, resolve(process.env.MUSIC_APP_INSTALLED_EXECUTABLE!))
    await writeFile(`docs/verification/checkpoint/${evidencePrefix}-installed-${mode}.json`, JSON.stringify(evidence, null, 2))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('actual installed binary closes accepted import transactions and rejects writes past the close boundary', async () => {
  test.skip(!process.env.MUSIC_APP_INSTALLED_EXECUTABLE, 'Run only against the explicitly installed binary')
  const root = resolve('.superpowers/sdd/2026-10-03-music-player-implementation/Installed acceptance with spaces'); await mkdir(root, { recursive: true })
  const evidence = await pendingImportShutdown(await mkdtemp(join(root, 'pending import ')), resolve(process.env.MUSIC_APP_INSTALLED_EXECUTABLE!))
  await writeFile(`docs/verification/checkpoint/${evidencePrefix}-installed-import.json`, JSON.stringify(evidence, null, 2))
})

test('actual installed binary drains accepted slow-IO preferences on normal close and restart', async () => {
  test.skip(!process.env.MUSIC_APP_INSTALLED_EXECUTABLE, 'Run only against the explicitly installed binary')
  const root = resolve('.superpowers/sdd/2026-10-03-music-player-implementation/Installed acceptance with spaces'); await mkdir(root, { recursive: true })
  const directory = await mkdtemp(join(root, 'pending shutdown '))
  const evidence = await pendingSettingsShutdown(directory, resolve(process.env.MUSIC_APP_INSTALLED_EXECUTABLE!))
  await writeFile(`docs/verification/checkpoint/${evidencePrefix}-installed-shutdown.json`, JSON.stringify(evidence, null, 2))
})
test('actual installed Windows binary imports, plays, seeks, persists settings, exports and starts shipped LX sandbox', async () => {
  test.skip(!process.env.MUSIC_APP_INSTALLED_EXECUTABLE, 'Run only against the explicitly installed binary')
  test.setTimeout(90000)
  const executable = resolve(process.env.MUSIC_APP_INSTALLED_EXECUTABLE!); const directory = resolve('.superpowers/sdd/2026-10-03-music-player-implementation/Installed acceptance with spaces'); await mkdir(directory, { recursive: true })
  const data = await mkdtemp(join(directory, 'test user data ')); const path = await makeAudioFile({ directory, name: '安装版旋律 🎵.wav', durationSeconds: 20, toneHz: 440 }); const original = await readFile(path); const output = join(directory, '安装成品 🎵.flac'); const script = join(directory, 'installed-test-source.js')
  const server = createServer((_request, response) => { response.setHeader('content-type', 'audio/wav'); response.end(original) }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = (server.address() as { port: number }).port
  await writeFile(script, `/** @name Installed fixture source */\nlx.on(lx.EVENT_NAMES.request, async () => 'http://127.0.0.1:${port}/fixture.wav'); lx.send(lx.EVENT_NAMES.inited, {sources:{wy:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});`)
  let app: ElectronApplication | undefined
  const startupTimesMs: number[] = []
  const errors: string[] = []
  const launch = async () => { const started = Date.now(); const application = await _electron.launch({ executablePath: executable, args: [], env: { ...process.env, MUSIC_APP_USER_DATA_DIR: data } }); app = application; await expect.poll(() => application.windows().some(page => page.url().includes('/renderer/index.html')), { timeout: 3000 }).toBe(true); const page = application.windows().find(page => page.url().includes('/renderer/index.html'))!; await page.waitForLoadState('domcontentloaded'); page.on('pageerror', error => errors.push(error.message)); startupTimesMs.push(Date.now() - started); return { application, page } }
  try {
    let desktop = await launch(); app = desktop.application; let page = desktop.page
    const identity = await app.evaluate(({ app }) => ({ executable: process.execPath, packaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath }))
    expect(identity.executable).toBe(executable); expect(identity.packaged).toBe(true); expect(identity.appPath).toContain('app.asar')
    await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.path] }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.output }) }, { path, output })
    await page.getByRole('button', { name: '添加音乐', exact: true }).click(); await page.getByRole('button', { name: '播放 安装版旋律 🎵', exact: true }).click(); await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing'); const seek = page.getByRole('slider', { name: '播放进度', exact: true }); await seek.fill('5'); await expect.poll(async () => Number(await seek.inputValue())).toBeGreaterThanOrEqual(5)
    await page.getByRole('button', { name: '应用设置', exact: true }).click(); await page.getByLabel('默认音量').fill('.4'); await page.getByLabel('默认播放速度').fill('1.25'); await page.getByLabel('默认导出格式').selectOption('flac'); await page.getByRole('button', { name: '保存设置', exact: true }).click(); await expect(page.getByText('设置已保存', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '音源脚本', exact: true }).click(); await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, script); await page.getByRole('button', { name: '导入音源脚本', exact: true }).click(); await expect(page.getByRole('article', { name: 'Installed fixture source' }).getByText('已启用', { exact: true })).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    const extensionId = (await page.evaluate(() => window.musicApp.extensions.list()))[0].id
    await page.getByLabel('测试歌曲 ID').fill('1'); await page.getByLabel('测试歌曲标题').fill('安装测试完整曲目'); await page.getByLabel('测试歌手').fill('Fixture'); await page.getByLabel('预期时长（秒）').fill('20'); await page.getByRole('button', { name: '测试完整播放', exact: true }).click(); await expect(page.getByRole('button', { name: '播放已验证歌曲', exact: true })).toBeVisible({ timeout: 20000 }); await page.getByRole('button', { name: '播放已验证歌曲', exact: true }).click(); await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    await mkdir('docs/verification/screenshots', { recursive: true }); await page.screenshot({ path: `docs/verification/screenshots/${acceptancePrefix}-lx.png` })
    await app.close(); app = undefined; desktop = await launch(); app = desktop.application; page = desktop.page
    await page.getByRole('button', { name: '应用设置', exact: true }).click(); await expect(page.getByLabel('默认音量')).toHaveValue('0.4'); await expect(page.getByLabel('默认播放速度')).toHaveValue('1.25'); await expect(page.getByLabel('默认导出格式')).toHaveValue('flac')
    await expect.poll(async () => (await page.evaluate(() => window.musicApp.extensions.list()))[0]).toMatchObject({ id: extensionId, enabled: true, compatibilityError: null }); expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    await page.getByRole('button', { name: '音乐库', exact: false }).click(); await page.getByRole('button', { name: '播放 安装版旋律 🎵', exact: true }).click(); await page.getByRole('button', { name: '编辑当前歌曲', exact: true }).click(); const editor = page.getByRole('dialog', { name: '音频编辑' }); await expect(editor.getByLabel('导出格式')).toHaveValue('flac'); await editor.getByLabel('开始秒').fill('2'); await editor.getByLabel('结束秒').fill('10')
    await app.evaluate(({ dialog }, output) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: output }) }, output); await editor.getByRole('button', { name: '保存成品' }).click(); await expect(editor.getByText('导出完成', { exact: true })).toBeVisible({ timeout: 20000 }); expect(await readFile(path)).toEqual(original); expect((await readFile(output)).length).toBeGreaterThan(1000); await page.screenshot({ path: `docs/verification/screenshots/${acceptancePrefix}-export.png` })
    const rootPid = await app.evaluate(() => process.pid)
    const pids: number[] = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `$processes = @(Get-CimInstance Win32_Process); $owned = [Collections.Generic.List[int]]::new(); $owned.Add(${rootPid}); for ($index = 0; $index -lt $owned.Count; $index++) { foreach ($child in $processes) { if ($child.ParentProcessId -eq $owned[$index] -and -not $owned.Contains([int]$child.ProcessId)) { $owned.Add([int]$child.ProcessId) } } }; ConvertTo-Json -InputObject @($owned.ToArray()) -Compress`], { encoding: 'utf8', windowsHide: true }))
    expect(pids.length).toBeGreaterThanOrEqual(3)
    const child = app.process(); const closed = once(child, 'close'); await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.isVisible())!.close() }); await closed; app = undefined
    const remaining = execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue).Count`], { encoding: 'utf8', windowsHide: true }).trim(); expect(remaining).toBe('0'); expect(errors).toEqual([])
    const extensionsPath = join(data, 'extensions.json'); const stored = JSON.parse(await readFile(extensionsPath, 'utf8')); const originalScript = stored[0].script.rawScript; stored[0].script.rawScript = "throw new Error('fixture startup failure')"; await writeFile(extensionsPath, JSON.stringify(stored))
    desktop = await launch(); app = desktop.application; page = desktop.page
    await expect.poll(async () => (await page.evaluate(() => window.musicApp.extensions.list()))[0].compatibilityError).toContain('初始化失败')
    const failed = (await page.evaluate(() => window.musicApp.extensions.list()))[0]
    expect(failed.enabled).toBe(false); expect(failed.compatibilityError).toContain('初始化失败'); expect((await page.evaluate(() => window.musicApp.settings.read())).enabledSources).toContain(extensionId)
    await page.getByRole('button', { name: '应用设置', exact: true }).click(); await expect(page.getByLabel('启用 Installed fixture source')).toBeChecked(); await expect(page.getByText(/实际状态：未运行/)).toBeVisible(); await page.screenshot({ path: `docs/verification/screenshots/${acceptancePrefix}-source-failure.png` })
    await page.getByRole('button', { name: '音乐库', exact: false }).click(); await page.getByRole('button', { name: '播放 安装版旋律 🎵', exact: true }).click(); await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing'); await page.getByRole('button', { name: '编辑当前歌曲', exact: true }).click(); await expect(page.getByRole('dialog', { name: '音频编辑' })).toBeVisible()
    await app.close(); app = undefined; stored[0].script.rawScript = 'while (true) {}'; await writeFile(extensionsPath, JSON.stringify(stored))
    desktop = await launch(); app = desktop.application; page = desktop.page
    await page.getByRole('button', { name: '播放 安装版旋律 🎵', exact: true }).click(); await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing'); await page.getByRole('button', { name: '编辑当前歌曲', exact: true }).click(); await expect(page.getByRole('dialog', { name: '音频编辑' })).toBeVisible()
    await expect.poll(async () => (await page.evaluate(() => window.musicApp.extensions.list()))[0].compatibilityError, { timeout: 7000 }).toContain('初始化超时')
    const hung = (await page.evaluate(() => window.musicApp.extensions.list()))[0]; expect(hung.enabled).toBe(false); expect((await page.evaluate(() => window.musicApp.settings.read())).enabledSources).toContain(extensionId)
    await app.close(); app = undefined; stored[0].script.rawScript = originalScript; await writeFile(extensionsPath, JSON.stringify(stored))
    await writeFile(`docs/verification/checkpoint/${acceptancePrefix}-acceptance.json`, JSON.stringify({ identity, testData: data, fixture: path, output, extensionId, shippedLX: true, restartEnabled: true, startupTimesMs, failedStartup: { enabledPreferencePreserved: true, runtimeEnabled: failed.enabled, message: failed.compatibilityError, localPlaybackAndEditorUsable: true }, hungStartup: { enabledPreferencePreserved: true, runtimeEnabled: hung.enabled, message: hung.compatibilityError, localPlaybackAndEditorUsable: true }, settings: { volume: .4, rate: 1.25, format: 'flac' }, originalBytesPreserved: true, closedProcessIds: pids, remainingProcessCount: Number(remaining), errors }, null, 2))
  } finally { await app?.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
})
