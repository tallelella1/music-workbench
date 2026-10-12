const { listPackage, extractFile } = require('@electron/asar')
const { resolve, join } = require('node:path')
const { readdir, readFile, writeFile } = require('node:fs/promises')
async function main(): Promise<void> {
  const resources = resolve(process.argv[2] ?? 'release/win-unpacked/resources')
  const archive = join(resources, 'app.asar'); const entries = listPackage(archive)
  const prohibited = /(?:electron-builder|app-builder-lib|@electron[\\/]get|cacheable-request|http-cache-semantics|global-agent|[\\/](?:got|roarr|sprintf-js)[\\/])/
  for (const name of entries) if (prohibited.test(name)) throw new Error(`Development downloader shipped: ${name}`)
  const out = entries.filter(name => /[\\/]out[\\/].*\.js$/.test(name))
  for (const name of out) { const source = extractFile(archive, name.replace(/^[\\/]/, '')).toString('utf8'); if (/\b(?:require|import)\s*\(?\s*['"](?:electron-builder|app-builder-lib|@electron\/get|got|cacheable-request|http-cache-semantics|global-agent|roarr|sprintf-js)/.test(source)) throw new Error(`Development downloader imported: ${name}`) }
  async function inspectDirectory(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.name === 'app.asar') continue; const path = join(directory, entry.name); if (prohibited.test(path)) throw new Error(`Development downloader outside ASAR: ${path}`); if (entry.isDirectory()) await inspectDirectory(path); else if (/\.(?:js|json)$/.test(entry.name) && prohibited.test(await readFile(path, 'utf8'))) throw new Error(`Downloader reference outside ASAR: ${path}`) }
  }
  await inspectDirectory(resources)
  for (const required of ['out/preload/index.js', 'out/preload/lx.js', 'out/lx-sandbox/runtime.js', 'out/lx-sandbox/index.html', 'THIRD_PARTY_NOTICES.md']) if (!entries.some(name => name.replaceAll('\\', '/').replace(/^\//, '') === required)) throw new Error(`Missing packaged resource: ${required}`)
  const result = { resources, asarEntries: entries.length, applicationJsChecked: out.length, prohibitedRuntimeCode: false, entries }
  await writeFile(resolve('docs/verification/checkpoint/task-7-package-content.json'), JSON.stringify(result, null, 2))
  console.log(`Verified ASAR (${entries.length} entries, ${out.length} app JS) and all extra/unpacked resources; no builder/download-cache code shipped`)
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
