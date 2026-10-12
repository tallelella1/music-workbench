import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchDevApp } from '../helpers/desktop'

test('npm dev renders the real Electron library with CSP-approved styles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'music-dev-'))
  let desktop: Awaited<ReturnType<typeof launchDevApp>> | undefined
  try {
    desktop = await launchDevApp(directory)
    const { page } = desktop
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible()
    await expect.poll(() => page.locator('.app-shell').evaluate((element) => getComputedStyle(element).display)).toBe('grid')
    expect(await page.getByRole('region', { name: '播放控制' }).evaluate((element) => getComputedStyle(element).position)).toBe('fixed')
    const styles = await page.evaluate(() => {
      const nonce = (document.querySelector('meta[property="csp-nonce"]') as HTMLMetaElement | null)?.nonce
      const injected = Array.from(document.querySelectorAll('style[data-vite-dev-id]'))
      return { nonce, count: injected.length, matching: injected.every((style) => (style as HTMLStyleElement).nonce === nonce) }
    })
    expect(styles.nonce).toBeTruthy()
    expect(styles.count).toBeGreaterThan(0)
    expect(styles.matching).toBe(true)
    await page.reload()
    await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible()
    await expect.poll(() => page.locator('.app-shell').evaluate((element) => getComputedStyle(element).display)).toBe('grid')
    expect(await page.locator('meta[property="csp-nonce"]').evaluate((element) => (element as HTMLMetaElement).nonce)).not.toBe(styles.nonce)
  } finally {
    await desktop?.close()
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})
