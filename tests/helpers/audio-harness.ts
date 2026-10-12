import type { Page } from '@playwright/test'
import { build } from 'vite'
import { resolve } from 'node:path'
let bundle: Promise<string> | undefined
export async function installAudioHarness(page: Page): Promise<void> {
  bundle ??= (async () => {
    const result = await build({ configFile: false, logLevel: 'error', build: { write: false, minify: false, lib: { entry: resolve('tests/helpers/audio-browser.ts'), name: 'AudioHarness', formats: ['iife'] } } })
    const output = Array.isArray(result) ? result[0] : result
    if (!('output' in output)) throw new Error('Expected in-memory browser bundle')
    const code = output.output.find((item) => item.type === 'chunk')
    if (!code || code.type !== 'chunk') throw new Error('Audio harness bundle missing')
    return code.code
  })()
  // DevTools evaluates this test-only bundle. UI and bridge E2E retain production CSP.
  const session = await page.context().newCDPSession(page)
  const result = await session.send('Runtime.evaluate', { expression: await bundle })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  await session.detach()
}
