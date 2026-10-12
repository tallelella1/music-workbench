import { _electron, expect, type ElectronApplication } from '@playwright/test'
import { readFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { makeAudioFile } from './fixtures'

/** Real atomic rename is delayed to model slow IO; production code has no test hooks. */
export async function pendingSettingsShutdown(directory: string, executablePath?: string) {
  const data = join(directory, 'data'); const timeline = join(directory, 'shutdown.jsonl'); await mkdir(directory, { recursive: true })
  let app: ElectronApplication | undefined
  const launch = async () => {
    app = await _electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [resolve('out/main/index.js')] }), env: { ...process.env, MUSIC_APP_USER_DATA_DIR: data } })
    await expect.poll(() => app!.windows().some(page => page.url().includes('/renderer/index.html'))).toBe(true)
    const page = app.windows().find(page => page.url().includes('/renderer/index.html'))!; await page.waitForLoadState('domcontentloaded'); return page
  }
  try {
    const page = await launch(); const child = app!.process()
    await page.getByRole('button', { name: '应用设置', exact: true }).click()
    await page.evaluate(() => window.musicApp.settings.update({ volume: .2 }))
    await app!.evaluate(({ app }, timeline) => {
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs'); const promises = fs.promises; const rename = promises.rename
      const log = (event: string) => fs.appendFileSync(timeline, JSON.stringify({ event, at: Date.now() }) + '\n')
      promises.rename = async (from, to) => {
        if (String(to).endsWith('settings.json')) { log('rename-pending'); await new Promise(done => setTimeout(done, 1000)); await rename(from, to); log('rename-committed') }
        else await rename(from, to)
      }
      app.on('will-quit', () => log('will-quit'))
    }, timeline)
    await page.evaluate(() => { void window.musicApp.settings.update({ volume: .9 }).catch(() => {}) })
    await expect.poll(async () => (await readFile(timeline, 'utf8').catch(() => '')).includes('rename-pending'), { intervals: [10] }).toBe(true)
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/renderer/index.html'))!.close()).catch(() => {})
    await expect.poll(() => child.exitCode).toBe(0); app = undefined
    const stored = JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')); expect(stored.preferences.volume).toBe(.9)
    const events = (await readFile(timeline, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(events.findIndex(row => row.event === 'rename-committed')).toBeGreaterThanOrEqual(0)
    expect(events.findIndex(row => row.event === 'will-quit')).toBeGreaterThan(events.findIndex(row => row.event === 'rename-committed'))
    const restarted = await launch(); expect((await restarted.evaluate(() => window.musicApp.settings.read())).volume).toBe(.9)
    await app!.close(); app = undefined
    return { executable: executablePath ?? 'built Electron', requestedVolume: .9, persistedVolume: stored.preferences.volume, restartVolume: .9, events }
  } finally { await app?.close() }
}

/** An accepted import has not reached repository.update yet when close begins. */
export async function pendingImportShutdown(directory: string, executablePath?: string) {
  const data = join(directory, 'data'); const marker = join(directory, 'stat-pending'); await mkdir(directory, { recursive: true })
  const path = await makeAudioFile({ directory, name: '关闭中保留音乐.wav', durationSeconds: 1, toneHz: 440 }); const original = await readFile(path)
  let app: ElectronApplication | undefined
  try {
    app = await _electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [resolve('out/main/index.js')] }), env: { ...process.env, MUSIC_APP_USER_DATA_DIR: data } })
    await expect.poll(() => app!.windows().some(page => page.url().includes('/renderer/index.html'))).toBe(true)
    const page = app.windows().find(page => page.url().includes('/renderer/index.html'))!; await page.getByRole('button', { name: '应用设置', exact: true }).click()
    await page.evaluate(() => window.musicApp.settings.update({ volume: .2 })); const child = app.process()
    await app.evaluate(({ dialog }, args) => {
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs'); const originalStat = fs.promises.stat; let held = false; let release!: () => void
      const gate = new Promise<void>(done => { release = done })
      Object.assign(globalThis, { releaseImportStat: release })
      fs.promises.stat = (async (...params: Parameters<typeof originalStat>) => {
        if (!held && String(params[0]) === args.path) { held = true; fs.writeFileSync(args.marker, 'pending'); await gate }
        return originalStat(...params)
      }) as typeof originalStat
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.path] })
    }, { path, marker })
    await page.evaluate(() => { void window.musicApp.library.importFiles().catch(() => {}) })
    await expect.poll(async () => await readFile(marker, 'utf8').catch(() => '')).toBe('pending')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/renderer/index.html'))!.close())
    const rejection = await page.evaluate(async () => { try { await window.musicApp.settings.update({ volume: .8 }); return 'accepted' } catch (error) { return String(error && typeof error === 'object' && 'message' in error ? error.message : error) } })
    expect(rejection).toContain('应用正在关闭')
    await app.evaluate(() => (globalThis as typeof globalThis & { releaseImportStat(): void }).releaseImportStat())
    await expect.poll(() => child.exitCode).toBe(0); app = undefined
    const stored = JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')); const library = JSON.parse(await readFile(join(data, 'library.json'), 'utf8'))
    expect(stored.preferences.volume).toBe(.2); expect(stored.assets).toHaveLength(1); expect(library.tracks).toHaveLength(1)
    expect(library.tracks[0].audioAssetId).toBe(stored.assets[0].record.id); expect(await readFile(path)).toEqual(original)
    return { executable: executablePath ?? 'built Electron', acceptedImportCompleted: true, assetIndexCount: 1, libraryCount: 1, lateUpdateRejected: rejection, persistedVolume: .2, originalBytesPreserved: true }
  } finally {
    if (app) { await app.evaluate(() => (globalThis as typeof globalThis & { releaseImportStat?: () => void }).releaseImportStat?.()).catch(() => {}); await app.close() }
  }
}
