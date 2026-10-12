import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from '../helpers/desktop'
import { makeAudioFile } from '../helpers/fixtures'

async function setup(hangs = false) {
  const directory = await mkdtemp(join(tmpdir(), 'lx-lifecycle-'))
  const local = await makeAudioFile({ directory, name: '本地保留.wav', durationSeconds: 20, toneHz: 440 })
  const bytes = await readFile(local)
  let releaseA: (() => void) | null = null
  let enteredHang = false
  const server = createServer((request, response) => {
    if (request.url === '/started') { enteredHang = true; response.writeHead(200).end('{}'); return }
    if (request.url === '/resolve/123') { releaseA = () => response.writeHead(200).end('{}'); return }
    if (request.url!.startsWith('/resolve/')) { response.writeHead(200).end('{}'); return }
    response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': bytes.length }).end(bytes)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const script = join(directory, 'source.js')
  const scriptCode = `/** @name Lifecycle source */
lx.on(lx.EVENT_NAMES.request, async ({info}) => {
  ${hangs ? `if (info.musicInfo.songmid === 123) { await new Promise((resolve) => lx.request('${base}/started', {}, () => resolve())); while (true) {} }` : ''}
  await new Promise((resolve,reject) => lx.request('${base}/resolve/'+info.musicInfo.songmid, {}, (error) => error ? reject(error) : resolve()));
  return '${base}/20.wav';
}); lx.send(lx.EVENT_NAMES.inited,{sources:{wy:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});`
  await writeFile(script, scriptCode)
  const healthyScript = join(directory, 'healthy.js')
  await writeFile(healthyScript, `/** @name Healthy source */
lx.on(lx.EVENT_NAMES.request, async () => '${base}/20.wav');
lx.send(lx.EVENT_NAMES.inited,{sources:{wy:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});`)
  const { app, page } = await launchApp(join(directory, 'data'))
  const child = app.process()
  const choose = (path: string) => app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }) }, path)
  const importSource = async (path: string) => {
    await choose(path); await page.getByRole('button', { name: '音源脚本', exact: true }).click()
    await page.getByRole('button', { name: '导入音源脚本', exact: true }).click()
    await expect(page.getByRole('article', { name: 'Lifecycle source' }).getByText('已启用', { exact: true })).toBeVisible()
  }
  await importSource(script)
  const id = (await page.evaluate(() => window.musicApp.extensions.list()))[0].id
  const search = async () => {
    await app.evaluate(() => {
      const realFetch = globalThis.fetch
      globalThis.fetch = async (url, init) => {
        const address = new URL(String(url)); if (address.hostname === '127.0.0.1') return realFetch(url, init)
        const body = address.hostname.includes('163') ? { code: 200, data: { resources: [123, 124].map((id) => ({ baseInfo: { simpleSongData: { id, name: id === 123 ? '在线 A' : '在线 B', ar: [{ name: 'Fixture Artist' }], al: { name: 'HTTP album', id: 1 }, dt: 20000 } } })), totalCount: 2 } }
          : address.hostname.includes('kugou') ? { error_code: 0, data: { lists: [], total: 0 } } : { code: 0, req: { code: 0, data: { body: { song: { list: [] } }, meta: { sum: 0 } } } }
        return new Response(JSON.stringify(body))
      }
    })
    await page.getByRole('button', { name: '在线搜索', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索歌曲、歌手或专辑' }).fill('在线')
    await page.getByRole('button', { name: '开始搜索', exact: true }).click()
    await expect(page.getByRole('button', { name: '完整播放 在线 A', exact: true })).toBeVisible()
  }
  return { app, page, child, id, local, healthyScript, choose, search, release: () => { releaseA?.(); releaseA = null }, blocked: () => !!releaseA, enteredHang: () => enteredHang,
    async cleanup() { if (child.exitCode === null) await app.close(); server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done())); await rm(directory, { recursive: true, force: true }) } }
}

test('same hidden LX source survives online A to B cancellation and late replies; old watchers cannot kill re-enabled runtime', async () => {
  test.setTimeout(50000)
  const fixture = await setup(); const { app, page, id } = fixture
  try {
    await fixture.search()
    const a = page.getByRole('button', { name: '完整播放 在线 A', exact: true }); const b = page.getByRole('button', { name: '完整播放 在线 B', exact: true })
    await a.click(); await expect.poll(fixture.blocked).toBe(true)
    await b.click(); await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    await expect(page.locator('.now-playing')).toContainText('在线 B')
    expect((await page.evaluate(() => window.musicApp.extensions.list()))[0].enabled).toBe(true)
    fixture.release()
    await page.waitForTimeout(15500)
    await expect(page.locator('.now-playing')).toContainText('在线 B')
    expect((await page.evaluate(() => window.musicApp.extensions.list()))[0].enabled).toBe(true)
    await a.click(); await expect.poll(fixture.blocked).toBe(true)
    await b.click(); await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    await page.evaluate(async (id) => { await window.musicApp.extensions.enable(id, false); await window.musicApp.extensions.enable(id, true) }, id)
    fixture.release(); await b.click()
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    await page.waitForTimeout(15500)
    await expect(page.locator('.now-playing')).toContainText('在线 B')
    expect((await page.evaluate(() => window.musicApp.extensions.list()))[0].enabled).toBe(true)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    await b.click(); await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
  } finally { fixture.release(); await fixture.cleanup() }
})

test('closing the actual main window exits Electron even while an LX hidden window is enabled', async () => {
  const fixture = await setup()
  try {
    expect(await fixture.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    await fixture.app.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows().find((window) => window.isVisible())!; setTimeout(() => main.close(), 100) })
    await expect.poll(() => fixture.child.exitCode, { timeout: 5000 }).toBe(0)
  } finally { await fixture.cleanup() }
})

test('cancelled infinite-loop source still reaches its external watchdog while local playback and another source survive', async () => {
  test.setTimeout(30000)
  const fixture = await setup(true); const { app, page } = fixture
  try {
    await fixture.choose(fixture.local); await page.getByRole('button', { name: '音乐库', exact: false }).click()
    await page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await fixture.choose(fixture.healthyScript); await page.getByRole('button', { name: '音源脚本', exact: true }).click()
    await page.getByRole('button', { name: '导入音源脚本', exact: true }).click()
    await expect(page.getByRole('article', { name: 'Healthy source' }).getByText('已启用', { exact: true })).toBeVisible()
    await fixture.search(); const started = Date.now()
    await page.getByRole('button', { name: '完整播放 在线 A', exact: true }).click()
    await expect.poll(fixture.enteredHang).toBe(true)
    await page.getByRole('button', { name: '音乐库', exact: false }).click()
    await page.getByRole('button', { name: '播放 本地保留', exact: true }).click()
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    expect((await page.evaluate(() => window.musicApp.extensions.list()))[0].enabled).toBe(true)
    await expect.poll(async () => (await page.evaluate(() => window.musicApp.extensions.list()))[0].enabled, { timeout: 17000 }).toBe(false)
    expect(Date.now() - started).toBeGreaterThanOrEqual(14500)
    await expect(page.locator('.player-bar')).toHaveAttribute('data-status', 'playing')
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    const result = await page.evaluate(async () => {
      const source = (await window.musicApp.extensions.list()).find((entry) => entry.name === 'Healthy source')!
      return window.musicApp.extensions.test(source.id, { providerId: 'wy', songId: '124', identity: { originalTitle: '在线 B', singer: 'Fixture Artist', durationSeconds: 20 } }, '128k', crypto.randomUUID())
    })
    expect(result.probe?.durationSeconds).toBeCloseTo(20, 1)
  } finally { await fixture.cleanup() }
})
