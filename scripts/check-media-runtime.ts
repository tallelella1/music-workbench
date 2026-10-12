const { createHash } = require('node:crypto')
const { readFile, stat } = require('node:fs/promises')
const { resolve, join, relative, isAbsolute } = require('node:path')
const { execFileSync } = require('node:child_process')
async function main(): Promise<void> {
  const directory = resolve(process.argv[2] ?? 'resources')
  const manifest = JSON.parse(await readFile(join(directory, 'media-runtime.json'), 'utf8'))
  for (const entry of manifest.binaries) {
    const path = resolve(directory, entry.file); const delta = relative(directory, path)
    if (delta.startsWith('..') || isAbsolute(delta)) throw new Error('Runtime manifest path escapes resources')
    const bytes = await readFile(path)
    if (bytes.length !== entry.byteLength || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Runtime hash mismatch: ${entry.file}`)
  }
  if (!(await stat(join(directory, manifest.notices))).isFile()) throw new Error('Media license missing')
  const ffmpeg = join(directory, 'bin', 'ffmpeg.exe'); const ffprobe = join(directory, 'bin', 'ffprobe.exe')
  for (const file of [ffmpeg, ffprobe]) if (!execFileSync(file, ['-version'], { encoding: 'utf8', windowsHide: true }).includes(manifest.version)) throw new Error('Runtime version mismatch')
  const filters = execFileSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true })
  for (const name of ['equalizer', 'afir', 'atempo', 'afade', 'atrim']) if (!new RegExp(`\\b${name}\\b`).test(filters)) throw new Error(`Required filter missing: ${name}`)
  const encoders = execFileSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true })
  for (const name of ['libmp3lame', 'flac', 'pcm_s24le']) if (!encoders.includes(name)) throw new Error(`Required encoder missing: ${name}`)
  console.log(`Verified ${manifest.binaries.length} media binaries: ${manifest.version}, ${manifest.license}; required audio encoders/filters present`)
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
