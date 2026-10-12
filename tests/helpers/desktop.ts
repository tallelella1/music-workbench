import { _electron, chromium, type Browser, type ElectronApplication, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import { access } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'

export async function launchApp(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  await access(resolve('out/main/index.js'))
  const app = await _electron.launch({
    args: [resolve('out/main/index.js')],
    env: { ...process.env, MUSIC_APP_USER_DATA_DIR: userDataDir }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** Starts the actual npm dev command and connects to its real Electron renderer. */
export async function launchDevApp(userDataDir: string): Promise<{ page: Page; close(): Promise<void> }> {
  if (!process.env.npm_execpath) throw new Error('Run the desktop test through npm')
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const debugPort = (reservation.address() as { port: number }).port
  await new Promise<void>((finish) => reservation.close(() => finish()))
  const child = spawn(process.execPath, [process.env.npm_execpath, 'run', 'dev', '--', '--remoteDebuggingPort', String(debugPort)], {
    cwd: resolve('.'), env: { ...process.env, MUSIC_APP_USER_DATA_DIR: userDataDir }, stdio: ['ignore', 'pipe', 'pipe']
  })
  let browser: Browser | undefined
  const stop = async () => {
    await browser?.close()
    if (child.exitCode !== null || !child.pid) return
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      await once(killer, 'close')
    } else child.kill('SIGTERM')
  }
  try {
    const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
      let output = ''
      const timeout = setTimeout(() => reject(new Error(`Dev Electron startup timed out: ${output}`)), 20_000)
      const readOutput = (chunk: Buffer) => {
        output = (output + chunk.toString()).slice(-6000)
        const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/)
        if (match) { clearTimeout(timeout); resolveEndpoint(match[1]) }
      }
      child.stdout.on('data', readOutput)
      child.stderr.on('data', readOutput)
      child.once('error', (error) => { clearTimeout(timeout); reject(error) })
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Dev Electron exited ${code}: ${output}`)) })
    })
    browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    const page = context.pages()[0] ?? await context.waitForEvent('page')
    await page.waitForLoadState('domcontentloaded')
    return { page, close: stop }
  } catch (error) { await stop(); throw error }
}
