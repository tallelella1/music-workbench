import { build } from 'esbuild'
import { mkdir, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
/** Self-contained output avoids electron-vite multi-entry TTY assumptions and shared require chunks. */
export async function buildLX(): Promise<void> {
  await mkdir(resolve('out/lx-sandbox'), { recursive: true })
  await build({ entryPoints: [resolve('src/preload/lx.ts')], outfile: resolve('out/preload/lx.js'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'es2022' })
  await build({ entryPoints: [resolve('src/lx-sandbox/runtime.ts')], outfile: resolve('out/lx-sandbox/runtime.js'), bundle: true, platform: 'browser', format: 'iife', target: 'es2022' })
  await copyFile(resolve('src/lx-sandbox/index.html'), resolve('out/lx-sandbox/index.html'))
}
