import { _electron, expect, type ElectronApplication } from '@playwright/test'
import { createServer, type ServerResponse } from 'node:http'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeAudioFile, makeTrack } from './fixtures'

export async function pendingNetworkShutdown(directory: string, mode: 'playback' | 'source-test' | 'search' | 'decode' | 'lx-network', executablePath?: string) {
  await mkdir(directory, { recursive: true }); const temporary = join(directory, 'temp'); await mkdir(temporary)
  const timeline = join(directory, 'shutdown.jsonl'); const data = join(directory, 'data')
  const path = await makeAudioFile({ directory, name: '实际网络退出.wav', durationSeconds: 20, toneHz: 440 }); const bytes = await readFile(path)
  let response: ServerResponse | undefined; let entered = false; let disconnected = false
  const server = createServer((_request, outgoing) => {
    entered = true; response = outgoing; outgoing.on('close', () => { disconnected = true })
    if (mode === 'search' || mode === 'lx-network') return
    outgoing.writeHead(200, { 'content-type': 'audio/wav', 'content-length': bytes.length })
    if (mode === 'decode') outgoing.end(bytes)
    else outgoing.write(bytes.subarray(0, 100)) // Real response body stays pending until abort, never auto-released.
  })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/media`
  const script = join(directory, 'source.js')
  await writeFile(script, `/** @name Shutdown source */\nlx.on(lx.EVENT_NAMES.request, async () => { ${mode === 'lx-network' ? `await new Promise((resolve, reject) => lx.request('${url}', {}, error => error ? reject(error) : resolve()));` : ''} return '${url}'; }); lx.send(lx.EVENT_NAMES.inited,{sources:{wy:{type:'music',actions:['musicUrl'],qualitys:['128k']}}});`)
  let app: ElectronApplication | undefined
  try {
    app = await _electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: [resolve('out/main/index.js')] }), env: { ...process.env, MUSIC_APP_USER_DATA_DIR: data, TEMP: temporary, TMP: temporary } })
    await expect.poll(() => app!.windows().some(page => page.url().includes('/renderer/index.html'))).toBe(true)
    const page = app.windows().find(page => page.url().includes('/renderer/index.html'))!; const child = app.process()
    await app.evaluate(({ app, dialog }, args) => {
      const fs = process.getBuiltinModule('node:fs') as typeof import('node:fs'); const cp = process.getBuiltinModule('node:child_process') as typeof import('node:child_process')
      const log = (event: string, more: object = {}) => fs.appendFileSync(args.timeline, JSON.stringify({ event, at: Date.now(), ...more }) + '\n')
      const realFetch = globalThis.fetch
      globalThis.fetch = (input, init) => {
        const address = String(input); const selected = args.mode === 'search' && !address.includes('127.0.0.1') ? args.url : input
        init?.signal?.addEventListener('abort', () => log('fetch-aborted'), { once: true })
        const work = realFetch(selected, init)
        return args.mode === 'search' || args.mode === 'lx-network' ? work.finally(async () => { log('transport-cleanup-pending'); await new Promise(done => setTimeout(done, 300)); log('transport-cleanup-complete') }) : work
      }
      const spawn = cp.spawn
      cp.spawn = ((...params: Parameters<typeof cp.spawn>) => {
        const decode = Array.isArray(params[1]) && params[1].includes('s16le') && params[1].some(arg => String(arg).includes('music-completeness-'))
        if (decode) params[1] = ['-re', ...params[1] as string[]]
        const worker = spawn(...params)
        if (decode) { log('decode-spawn', { pid: worker.pid }); worker.once('close', () => log('decode-close', { pid: worker.pid })) }
        return worker
      }) as typeof cp.spawn
      const remove = fs.promises.rm
      fs.promises.rm = async (location, options) => {
        if (String(location).includes('music-completeness-')) { log('cleanup-pending'); await new Promise(done => setTimeout(done, 300)); await remove(location, options); log('cleanup-complete') }
        else await remove(location, options)
      }
      app.on('will-quit', () => log('will-quit'))
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [args.script] })
    }, { timeline, script, mode, url })
    if (mode !== 'search') {
      await page.getByRole('button', { name: '音源脚本', exact: true }).click(); await page.getByRole('button', { name: '导入音源脚本', exact: true }).click()
      await expect(page.getByRole('article', { name: 'Shutdown source' }).getByText('已启用', { exact: true })).toBeVisible()
    }
    const track = makeTrack({ durationSeconds: 20, sources: [{ providerId: 'wy', songId: '1', identity: { originalTitle: '完整音乐', singer: 'Fixture', durationSeconds: 20 } }] })
    await page.evaluate(async args => {
      if (args.mode === 'search') void window.musicApp.search.run({ text: 'pending', page: 1, pageSize: 20, authRevision: '0' }, crypto.randomUUID(), { providerIds: ['wy'] }).catch(() => {})
      else if (args.mode === 'source-test') {
        const id = (await window.musicApp.extensions.list())[0].id
        void window.musicApp.extensions.test(id, args.track.sources[0], '128k', crypto.randomUUID()).catch(() => {})
      } else void window.musicApp.playback.resolve(args.track, { quality: '128k', strict: true }, crypto.randomUUID()).catch(() => {})
    }, { mode, track })
    await expect.poll(() => entered).toBe(true)
    if (mode === 'decode') await expect.poll(async () => (await readFile(timeline, 'utf8').catch(() => '')).includes('decode-spawn')).toBe(true)
    const rootPid = await app.evaluate(() => process.pid)
    const pids: number[] = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', `$all = @(Get-CimInstance Win32_Process); $owned = [Collections.Generic.List[int]]::new(); $owned.Add(${rootPid}); for ($index = 0; $index -lt $owned.Count; $index++) { foreach ($child in $all) { if ($child.ParentProcessId -eq $owned[$index] -and -not $owned.Contains([int]$child.ProcessId)) { $owned.Add([int]$child.ProcessId) } } }; ConvertTo-Json -InputObject @($owned.ToArray()) -Compress`], { encoding: 'utf8', windowsHide: true }))
    const started = Date.now()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/renderer/index.html'))!.close()).catch(() => {})
    await expect.poll(async () => (await readFile(timeline, 'utf8').catch(() => '')).includes(mode === 'decode' ? 'cleanup-complete' : 'fetch-aborted'), { timeout: 3000, intervals: [10, 25, 50] }).toBe(true)
    await expect.poll(() => child.exitCode, { timeout: 3000 }).toBe(0); app = undefined
    const closeMs = Date.now() - started; expect(closeMs).toBeLessThan(3000)
    const events = (await readFile(timeline, 'utf8')).trim().split('\n').map(line => JSON.parse(line)); const quit = events.findIndex(row => row.event === 'will-quit')
    expect(quit).toBeGreaterThanOrEqual(0)
    const beforeQuit = (name: string) => { const index = events.findIndex(row => row.event === name); expect(index).toBeGreaterThanOrEqual(0); expect(index).toBeLessThan(quit) }
    if (mode === 'decode') { beforeQuit('decode-close'); beforeQuit('cleanup-complete') }
    else { beforeQuit('fetch-aborted'); await expect.poll(() => disconnected).toBe(true) }
    if (mode === 'search' || mode === 'lx-network') beforeQuit('transport-cleanup-complete')
    const remaining = execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue).Count`], { encoding: 'utf8', windowsHide: true }).trim(); expect(remaining).toBe('0')
    expect((await readdir(temporary)).filter(name => name.startsWith('music-completeness-'))).toEqual([])
    expect(await readFile(path)).toEqual(bytes)
    return { mode, executable: executablePath ?? 'built Electron', closeMs, events, closedProcessIds: pids, remainingProcessCount: 0, temporaryMediaCount: 0, originalBytesPreserved: true }
  } finally {
    // A RED run must release its owned HTTP response before closing the unpatched app.
    response?.end(mode === 'search' || mode === 'lx-network' ? '{}' : bytes.subarray(100)); server.closeAllConnections()
    await app?.close(); await new Promise<void>(done => server.close(() => done()))
  }
}
