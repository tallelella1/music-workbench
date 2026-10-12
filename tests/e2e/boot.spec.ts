import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from '../helpers/desktop'

test('built desktop opens a Chinese library, fixed player and safe bridge', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-boot-'))
  let desktop: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    desktop = await launchApp(directory)
    const { app, page } = desktop
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible()
    expect(await page.locator('.app-shell').evaluate((element) => getComputedStyle(element).display)).toBe('grid')
    await page.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = '.app-shell { display: block !important; }'
      document.head.appendChild(style)
    })
    expect(await page.locator('.app-shell').evaluate((element) => getComputedStyle(element).display)).toBe('grid')
    await expect(page.locator('meta[property="csp-nonce"]')).toHaveCount(0)
    await expect(page.getByText('让喜欢的音乐，从这里开始')).toBeVisible()
    await expect(page.getByRole('region', { name: '播放控制' })).toBeVisible()
    await expect(page.getByRole('button', { name: '播放', exact: true })).toBeDisabled()
    const player = await page.getByRole('region', { name: '播放控制' }).boundingBox()
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    expect(player).not.toBeNull()
    expect(Math.abs(player!.y + player!.height - viewportHeight)).toBeLessThan(2)
    expect(await page.evaluate(() => ({ require: typeof Reflect.get(window, 'require'), process: typeof Reflect.get(window, 'process') }))).toEqual({ require: 'undefined', process: 'undefined' })
    expect(await page.evaluate(() => Object.keys(window.musicApp).sort())).toEqual(['assets', 'effects', 'export', 'extensions', 'jobs', 'library', 'modules', 'onEvent', 'playback', 'search', 'settings'])
    await page.getByRole('button', { name: '音效', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '音效面板' })).toBeVisible()
    await page.getByRole('button', { name: '关闭音效面板' }).click()
    await expect(page.getByRole('complementary', { name: '音效面板' })).not.toBeVisible()
    const rendererProcess = await app.evaluate(({ app, BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId()
      return app.getAppMetrics().find((metric) => metric.pid === pid)
    })
    expect(rendererProcess).toMatchObject({ type: 'Tab', sandboxed: true })
    const unsubscribeResult = await page.evaluate(() => {
      const unsubscribe = window.musicApp.onEvent(() => {})
      unsubscribe()
      return typeof unsubscribe
    })
    expect(unsubscribeResult).toBe('function')
    const missingJobError = await page.evaluate(async () => {
      try { await window.musicApp.jobs.get('missing'); return null }
      catch (error) {
        const failure = error as Error & { code: string; moduleId: string }
        return { message: failure.message, code: failure.code, moduleId: failure.moduleId }
      }
    })
    expect(missingJobError).toEqual({ message: '找不到任务', code: 'IPC_REQUEST_REJECTED', moduleId: 'ipc' })
    const invalidRequestError = await page.evaluate(async () => {
      try { await window.musicApp.jobs.get(''); return null }
      catch (error) {
        const failure = error as { message: string; code: string; moduleId: string }
        return { message: failure.message, code: failure.code, moduleId: failure.moduleId }
      }
    })
    expect(invalidRequestError).toEqual({ message: '无效的请求', code: 'INVALID_REQUEST', moduleId: 'preload' })
    expect(await page.evaluate(() => window.open('https://example.org') === null)).toBe(true)
    expect(app.windows()).toHaveLength(1)
    expect(errors).toEqual([])
    await page.screenshot({ path: '.superpowers/sdd/2026-10-03-music-player-implementation/task-1-ui.png' })
  } finally {
    await desktop?.app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
