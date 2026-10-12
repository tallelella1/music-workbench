import { expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { launchApp } from '../helpers/desktop'
import { makeAudioFile } from '../helpers/fixtures'

async function desktopFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'music-search-ui-'))
  const desktop = await launchApp(join(directory, 'data'))
  const raw = Object.fromEntries(await Promise.all(['wy', 'kg', 'tx'].map(async (id) => [id, JSON.parse(await readFile(`tests/fixtures/providers/${id}-search.json`, 'utf8')).response])))
  await desktop.app.evaluate((_electron, fixtures) => {
    const control = { mode: 'partial', pending: [] as (() => void)[] }
    Reflect.set(globalThis, 'searchUiControl', control)
    globalThis.fetch = async (url, init) => {
      const address = new URL(String(url))
      const id = address.hostname.includes('163') ? 'wy' : address.hostname.includes('kugou') ? 'kg' : 'tx'
      const mode = control.mode
      // This seam replaces the owned native transport, so its pending fetch must
      // settle on abort as real fetch does; uncooperative providers use injected adapters.
      if (mode === 'partial' && id === 'kg') return new Promise((_done, fail) => {
        const signal = init!.signal!
        if (signal.aborted) fail(signal.reason)
        else signal.addEventListener('abort', () => fail(signal.reason), { once: true })
      })
      if (mode === 'partial' && id === 'tx') return new Response('', { status: 429 })
      const body = structuredClone(fixtures[id])
      if (mode === 'old' || mode === 'cancel' || mode === 'new') {
        const title = `${mode}结果`
        if (id === 'wy') body.data.resources[0].baseInfo.simpleSongData.name = title
        if (id === 'kg') body.data.lists[0].OriSongName = title
        if (id === 'tx') body.req.data.body.song.list[0].title = title
      }
      if (id === 'kg' && address.searchParams.get('page') === '2') body.data.lists[0].OriSongName = '酷狗第二页'
      const response = new Response(JSON.stringify(body), { headers: { 'Content-Type': 'text/plain' } })
      if (mode === 'old' || mode === 'cancel' || mode === 'slow-tx' && id === 'tx') return new Promise((finish) => control.pending.push(() => finish(response)))
      return response
    }
  }, raw)
  const setMode = async (mode: string, release = false) => desktop.app.evaluate((_electron, change) => {
    const state = Reflect.get(globalThis, 'searchUiControl') as { mode: string; pending: (() => void)[] }
    state.mode = change.mode
    if (change.release) state.pending.splice(0).forEach((finish) => finish())
  }, { mode, release })
  return { ...desktop, directory, setMode, close: async () => { await desktop.app.close(); await rm(directory, { recursive: true, force: true }) } }
}

test('real Electron search renders each source immediately, retries failures and paginates independently', async () => {
  const desktop = await desktopFixture()
  try {
    const { page } = desktop
    await page.getByRole('button', { name: '在线搜索', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索歌曲、歌手或专辑' }).fill('周杰伦')
    await page.getByRole('button', { name: '开始搜索', exact: true }).click()
    const wy = page.getByRole('region', { name: '网易云搜索结果' })
    const kg = page.getByRole('region', { name: '酷狗搜索结果' })
    const tx = page.getByRole('region', { name: 'QQ 音乐搜索结果' })
    await expect(wy.getByText('想你就写信 (Live)', { exact: true })).toBeVisible()
    await expect(kg.getByText('搜索中', { exact: true })).toBeVisible()
    await expect(tx.getByText('请求受限', { exact: true })).toBeVisible()
    await expect(wy.getByText('完整播放：尚未解析')).toHaveCount(5)
    await expect(page.getByRole('navigation', { name: '来源状态' }).getByRole('button', { name: '酷狗 搜索中' })).toBeVisible()
    await expect(wy.getByRole('button', { name: /^完整播放 / })).toHaveCount(5)
    await page.screenshot({ path: resolve('.superpowers/sdd/2026-10-03-music-player-implementation/task-4-independent-ui.png') })
    await expect(kg.getByText('响应超时', { exact: true })).toBeVisible({ timeout: 11000 })
    await desktop.setMode('retry')
    await kg.getByRole('button', { name: '重试酷狗' }).click()
    await expect(kg.getByText('晴天', { exact: true })).toBeVisible()
    await kg.getByRole('button', { name: '酷狗下一页' }).click()
    await expect(kg.getByText('酷狗第二页', { exact: true })).toBeVisible()
    await expect(kg.getByText('第 2 页')).toBeVisible()
    await expect(wy.getByText('第 1 页')).toBeVisible()
    await expect(wy.getByText('想你就写信 (Live)', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => ({ require: typeof Reflect.get(window, 'require'), process: typeof Reflect.get(window, 'process') }))).toEqual({ require: 'undefined', process: 'undefined' })
    await page.screenshot({ path: resolve('.superpowers/sdd/2026-10-03-music-player-implementation/task-4-search-ui.png') })
  } finally { await desktop.close() }
})

test('a late source completion cannot reset another source independently selected page', async () => {
  const desktop = await desktopFixture()
  try {
    await desktop.setMode('slow-tx')
    const { page } = desktop
    await page.getByRole('button', { name: '在线搜索', exact: true }).click()
    await page.getByRole('textbox', { name: '搜索歌曲、歌手或专辑' }).fill('周杰伦')
    await page.getByRole('button', { name: '开始搜索', exact: true }).click()
    const kg = page.getByRole('region', { name: '酷狗搜索结果' })
    await expect(kg.getByText('晴天', { exact: true })).toBeVisible()
    await expect.poll(() => desktop.app.evaluate(() => Reflect.get(globalThis, 'searchUiControl').pending.length)).toBe(1)
    await kg.getByRole('button', { name: '酷狗下一页' }).click()
    await expect(kg.getByText('酷狗第二页', { exact: true })).toBeVisible()
    await desktop.setMode('new', true)
    await expect(page.getByRole('region', { name: 'QQ 音乐搜索结果' }).getByText('晴天', { exact: true })).toBeVisible()
    await expect(kg.getByText('第 2 页')).toBeVisible()
    await expect(kg.getByText('酷狗第二页', { exact: true })).toBeVisible()
  } finally { await desktop.close() }
})

test('switching queries and cancelling ignores late responses through the real bridge', async () => {
  const desktop = await desktopFixture()
  try {
    const { page } = desktop
    await page.getByRole('button', { name: '在线搜索', exact: true }).click()
    const input = page.getByRole('textbox', { name: '搜索歌曲、歌手或专辑' })
    await desktop.setMode('old'); await input.fill('旧词'); await page.getByRole('button', { name: '开始搜索', exact: true }).click()
    await expect.poll(() => desktop.app.evaluate(() => Reflect.get(globalThis, 'searchUiControl').pending.length)).toBe(3)
    await desktop.setMode('new'); await input.fill('新词'); await page.getByRole('button', { name: '开始搜索', exact: true }).click()
    await expect(page.getByText('new结果', { exact: true })).toHaveCount(3)
    await desktop.setMode('new', true)
    await expect(page.getByText('old结果', { exact: true })).toHaveCount(0)
    await desktop.setMode('cancel'); await input.fill('取消词'); await page.getByRole('button', { name: '开始搜索', exact: true }).click()
    await expect.poll(() => desktop.app.evaluate(() => Reflect.get(globalThis, 'searchUiControl').pending.length)).toBe(3)
    await page.getByRole('button', { name: '取消搜索', exact: true }).click()
    await expect(page.getByText('搜索已取消', { exact: true })).toBeVisible()
    await desktop.setMode('new', true)
    await expect(page.getByText('cancel结果', { exact: true })).toHaveCount(0)
    await expect(page.getByText('搜索中', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '开始搜索', exact: true })).toBeEnabled()
  } finally { await desktop.close() }
})

test('search includes imported local tracks and plays the local result', async () => {
  const desktop = await desktopFixture()
  try {
    const path = await makeAudioFile({ directory: desktop.directory, name: '本地晴天.wav', durationSeconds: 3, toneHz: 440 })
    await desktop.app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }) }, path)
    await desktop.page.getByRole('button', { name: '添加音乐', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '播放 本地晴天', exact: true })).toBeVisible()
    await desktop.page.getByRole('textbox', { name: '搜索音乐', exact: true }).fill('本地晴天')
    await desktop.page.getByRole('textbox', { name: '搜索音乐', exact: true }).press('Enter')
    const local = desktop.page.getByRole('region', { name: '本地搜索结果' })
    await expect(local.getByText('本地晴天', { exact: true })).toBeVisible()
    await local.getByRole('button', { name: '播放 本地晴天', exact: true }).click()
    await expect(desktop.page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()
    await expect(desktop.page.locator('.now-playing')).toContainText('本地晴天')
    await desktop.page.getByRole('textbox', { name: '搜索歌曲、歌手或专辑' }).fill('无匹配歌曲')
    await expect(local.getByText('本地晴天', { exact: true })).toHaveCount(0)
    await desktop.page.getByRole('textbox', { name: '搜索音乐', exact: true }).press('Enter')
    await expect(local.getByText('本地晴天', { exact: true })).toBeVisible()
  } finally { await desktop.close() }
})
