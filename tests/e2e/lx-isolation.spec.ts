import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from '../helpers/desktop'
import { makeAudioFile } from '../helpers/fixtures'

test('hidden LX sandbox resolves real HTTP media, keeps local playback alive after infinite loops and isolates bridges', async () => {
  test.setTimeout(60000)
  const directory = await mkdtemp(join(tmpdir(), 'lx-isolation-'))
  const wavPath = await makeAudioFile({ directory, name: '本地保留.wav', durationSeconds: 20, toneHz: 440 }); const bytes = await readFile(wavPath)
  const secondLocal = await makeAudioFile({ directory, name: '下一首本地.wav', durationSeconds: 20, toneHz: 880 })
  let mediaRequests = 0
  let inheritedHeader = false
  let holdMetadata = false; let releaseMetadata: (() => void) | null = null
  const server = createServer((request, response) => {
    if (request.url === '/metadata') { const send = () => response.writeHead(200, { 'content-type': 'text/plain' }).end(JSON.stringify({ duration: 20 })); if (holdMetadata) releaseMetadata = () => { send() }; else send(); return }
    if (request.url === '/20.wav') { mediaRequests++; inheritedHeader ||= !!request.headers['x-fixture']; response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': bytes.length }).end(bytes); return }
    response.writeHead(404).end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const basic = join(directory, 'basic.js'); await writeFile(basic, (await readFile('tests/fixtures/lx/basic-source.js', 'utf8')).replaceAll('__BASE__', base))
  const resolveHang = join(directory, 'resolve-hang.js')
  await writeFile(resolveHang, `/** @name Hanging resolve */\nlx.on(lx.EVENT_NAMES.request, async () => { while (true) {} }); lx.send(lx.EVENT_NAMES.inited,{sources:{wy:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});`)
  const desktop = await launchApp(join(directory, 'data'))
  const { app, page } = desktop
  const choose = (path: string | string[]) => app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: Array.isArray(selected) ? selected : [selected] }) }, path)
  try {
    await choose([wavPath, secondLocal]); await page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await page.getByRole('button', { name: '播放 本地保留', exact: true }).click()
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    await page.getByRole('button', { name: '音源脚本', exact: true }).click()
    const initStarted = Date.now()
    await choose(resolve('tests/fixtures/lx/hanging-source.js')); await page.getByRole('button', { name: '导入音源脚本', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('初始化超时', { timeout: 8000 })
    expect(Date.now() - initStarted).toBeGreaterThanOrEqual(4500)
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    await choose(basic); await page.getByRole('button', { name: '导入音源脚本', exact: true }).click()
    const source = page.getByRole('article', { name: 'Local HTTP fixture' })
    await expect(source.getByText('已启用', { exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: '测试歌曲 ID' }).fill('123')
    await page.getByRole('textbox', { name: '测试歌曲标题' }).fill('HTTP 完整短曲')
    await page.getByRole('textbox', { name: '测试歌手' }).fill('Fixture Artist')
    await page.getByRole('spinbutton', { name: '预期时长（秒）' }).fill('20')
    holdMetadata = true; releaseMetadata = null
    await source.getByRole('button', { name: '测试完整播放' }).click()
    await expect.poll(() => !!releaseMetadata).toBe(true)
    await page.getByRole('button', { name: '下一首', exact: true }).click()
    await expect(page.locator('.now-playing')).toContainText('下一首本地')
    holdMetadata = false; releaseMetadata!()
    await expect(page.getByRole('status')).toContainText('完整性通过')
    await expect(page.locator('.now-playing')).toContainText('下一首本地')
    const isolation = await app.evaluate(async ({ BrowserWindow, app }) => {
      const hidden = BrowserWindow.getAllWindows().find((window) => !window.isVisible())!
      return { globals: await hidden.webContents.executeJavaScript(`({require:typeof require,process:typeof process,musicApp:typeof musicApp,version:lx.version})`), sandboxed: app.getAppMetrics().find((metric) => metric.pid === hidden.webContents.getOSProcessId())?.sandboxed,
        separateProcess: hidden.webContents.getOSProcessId() !== BrowserWindow.getAllWindows().find((window) => window.isVisible())!.webContents.getOSProcessId() }
    })
    expect(isolation).toEqual({ separateProcess: true, sandboxed: true, globals: { require: 'undefined', process: 'undefined', musicApp: 'undefined', version: '2.0.0' } })
    expect(mediaRequests).toBe(1)
    expect(inheritedHeader).toBe(false)
    await source.getByRole('button', { name: '播放已验证歌曲' }).click()
    await expect(page.locator('.now-playing')).toContainText('HTTP 完整短曲')
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    // A source test's late response must not replace a newer local choice after navigation.
    holdMetadata = true; releaseMetadata = null
    await source.getByRole('button', { name: '测试完整播放' }).click()
    await expect.poll(() => !!releaseMetadata).toBe(true)
    await page.getByRole('button', { name: '音乐库', exact: false }).click()
    await page.getByRole('button', { name: '播放 本地保留', exact: true }).click()
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    holdMetadata = false; releaseMetadata!()
    await page.waitForTimeout(1000)
    await expect(page.locator('.now-playing')).toContainText('本地保留')
    await page.getByRole('button', { name: '音源脚本', exact: true }).click()
    if (await source.getByRole('button', { name: '启用', exact: true }).count()) await source.getByRole('button', { name: '启用', exact: true }).click()
    await expect(source.getByText('已启用', { exact: true })).toBeVisible()
    // Controlled platform search response; source network and audio remain real HTTP.
    await app.evaluate(() => {
      const realFetch = globalThis.fetch
      globalThis.fetch = async (url, init) => {
        const address = new URL(String(url))
        if (address.hostname === '127.0.0.1') return realFetch(url, init)
        const body = address.hostname.includes('163') ? { code: 200, data: { resources: [{ baseInfo: { simpleSongData: { id: 123, name: 'HTTP 完整短曲', ar: [{ name: 'Fixture Artist' }], al: { name: 'HTTP album', id: 1 }, dt: 20000 } } }], totalCount: 1 } }
          : address.hostname.includes('kugou') ? { error_code: 0, data: { lists: [], total: 0 } } : { code: 0, req: { code: 0, data: { body: { song: { list: [] } }, meta: { sum: 0 } } } }
        return new Response(JSON.stringify(body))
      }
    })
    await page.getByRole('button', { name: '在线搜索', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索歌曲、歌手或专辑' }).fill('HTTP')
    await page.getByRole('button', { name: '开始搜索', exact: true }).click()
    await page.getByRole('button', { name: '完整播放 HTTP 完整短曲', exact: true }).click()
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    expect(mediaRequests).toBe(2)
    // Library refresh must retain online metadata and queue entries.
    await page.getByRole('button', { name: '音乐库', exact: false }).click()
    await page.getByRole('button', { name: '移除 本地保留', exact: true }).click()
    await expect(page.locator('.now-playing')).toContainText('HTTP 完整短曲')
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    await page.getByRole('button', { name: '播放队列', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '播放队列' })).toContainText('HTTP 完整短曲')
    const end = await page.getByRole('slider', { name: '播放进度' }).evaluate((element: HTMLInputElement) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(element, '19'); element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return element.max })
    expect(Number(end)).toBeCloseTo(20, 1)
    await expect(page.locator('.timeline')).toContainText('0:19')
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'paused', { timeout: 5000 })
    expect(mediaRequests).toBe(2)
    await page.screenshot({ path: resolve('.superpowers/sdd/2026-10-03-music-player-implementation/task-5-http-playback.png') })
    await page.getByRole('button', { name: '音源脚本', exact: true }).click()
    await page.getByRole('textbox', { name: '测试歌曲 ID' }).fill('123')
    await page.getByRole('textbox', { name: '测试歌曲标题' }).fill('HTTP 完整短曲')
    await page.getByRole('textbox', { name: '测试歌手' }).fill('Fixture Artist')
    await page.getByRole('spinbutton', { name: '预期时长（秒）' }).fill('20')
    await choose(resolveHang); await page.getByRole('button', { name: '导入音源脚本', exact: true }).click()
    const hanging = page.getByRole('article', { name: 'Hanging resolve' })
    await expect(hanging.getByText('已启用', { exact: true })).toBeVisible()
    const processes = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.webContents.getOSProcessId()))
    expect(processes.length).toBe(3); expect(new Set(processes).size).toBe(3)
    const resolveStarted = Date.now()
    await hanging.getByRole('button', { name: '测试完整播放' }).click()
    await expect(page.getByRole('alert')).toContainText('解析超时', { timeout: 18000 })
    expect(Date.now() - resolveStarted).toBeGreaterThanOrEqual(14500)
    await expect(hanging.getByText('未启用', { exact: true })).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    await source.getByRole('button', { name: '测试完整播放' }).click()
    await expect(page.getByRole('status')).toContainText('完整性通过')
    await source.getByRole('button', { name: '播放已验证歌曲' }).click()
    await source.getByRole('button', { name: '禁用' }).click()
    await expect(source.getByText('未启用', { exact: true })).toBeVisible()
    await source.getByRole('button', { name: '启用' }).click()
    await expect(source.getByText('已启用', { exact: true })).toBeVisible()
    await source.getByRole('button', { name: '测试完整播放' }).click()
    await expect(page.getByRole('status')).toContainText('完整性通过')
    await source.getByRole('button', { name: '播放已验证歌曲' }).click()
    const previousId = (await page.evaluate(() => window.musicApp.extensions.list())).find((source) => source.name === 'Local HTTP fixture')!.id
    const brokenReplacement = join(directory, 'broken-replacement.js')
    await writeFile(brokenReplacement, '/** @name Local HTTP fixture\n * @version 2.0.0\n */\nthrow new Error("replacement failure")')
    await choose(brokenReplacement); await page.getByRole('button', { name: '导入音源脚本', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('初始化失败')
    expect((await page.evaluate(() => window.musicApp.extensions.list())).find((source) => source.id === previousId)?.enabled).toBe(true)
    if (await page.getByRole('button', { name: '关闭播放队列', exact: true }).count()) await page.getByRole('button', { name: '关闭播放队列', exact: true }).click()
    await page.getByRole('heading', { name: '音源脚本', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: resolve('.superpowers/sdd/2026-10-03-music-player-implementation/task-5-source-settings.png') })
  } finally { await app.close(); await new Promise<void>((done) => server.close(() => done())); await rm(directory, { recursive: true, force: true }) }
})
