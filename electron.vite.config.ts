import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { buildLX } from './scripts/build-lx'
const fixZodComments = () => ({ name: 'zod-explanatory-pure-comments', enforce: 'pre' as const, transform(code: string, id: string) {
  if (!/node_modules[\\/]zod[\\/]v4[\\/]core[\\/](regexes|util)\.js$/.test(id)) return null
  // Explanatory prose is not a call-site PURE annotation; actual annotations stay intact.
  return code.replace(/\/\*\* Anchors a pattern source\.[\s\S]*?\*\//g, comment => comment.replaceAll('@__PURE__', 'PURE')).replace(/\/\/ Wrapped in a `@__PURE__` IIFE[^\r\n]*/g, comment => comment.replace('@__PURE__', 'PURE'))
} })

export default defineConfig({
  main: {},
  preload: { plugins: [fixZodComments(), { name: 'standalone-lx-sandbox', buildStart() { for (const file of ['src/preload/lx.ts', 'src/lx-sandbox/runtime.ts', 'src/lx-sandbox/index.html', 'src/shared/extensions.ts']) this.addWatchFile(resolve(file)) }, writeBundle: buildLX }], build: { externalizeDeps: false, rollupOptions: { output: { format: 'cjs', inlineDynamicImports: true } } } },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [fixZodComments(), {
      name: 'development-style-nonce',
      apply: 'serve',
      transformIndexHtml(html) {
        const nonce = randomBytes(18).toString('base64')
        return {
          html: html.replace("style-src 'self'", `style-src 'self' 'nonce-${nonce}'`),
          // Vite's CSS client reads this meta tag when creating inline style elements.
          tags: [{ tag: 'meta', attrs: { property: 'csp-nonce', nonce }, injectTo: 'head' }]
        }
      }
    }],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } }
  }
})
