import { expect, test, vi } from 'vitest'
import { copyFile, lstat, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { AssetRegistry } from '../../src/main/assets/asset-registry'
import { StorageRepository } from '../../src/main/storage/repository'
import { TaskService } from '../../src/main/jobs/task-service'
import { AudioExportService } from '../../src/main/export/audio-export-service'
import { FfmpegWorker, type FfmpegJob } from '../../src/main/export/ffmpeg-worker'
import { defaultEffects } from '../../src/shared/effects'
import { createIpcRouter, type LibraryHost } from '../../src/main/ipc'
import type { AudioEdit, AudioExportOptions } from '../../src/shared/audio-export'
import type { RequestContext } from '../../src/shared/contracts'
import { makeAudioFile } from '../helpers/fixtures'

const faults = vi.hoisted(() => ({ renameGate: null as Promise<void> | null, renameEntered: null as (() => void) | null, removeGate: null as Promise<void> | null, removeEntered: null as (() => void) | null, failRemove: null as ((path: string) => boolean) | null, calls: [] as string[], failRename: false,
  fileAlias: null as { path: string; target: string; ino: number; dev: number } | null,
  realpathGate: null as { path: string; wait: Promise<void>; entered(): void } | null }))
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual,
    realpath: async (path: string) => {
      if (faults.realpathGate?.path === path) { const gate = faults.realpathGate; faults.realpathGate = null; gate.entered(); await gate.wait }
      if (faults.fileAlias?.path === path) {
        const info = await actual.lstat(path)
        if (info.ino === faults.fileAlias.ino && info.dev === faults.fileAlias.dev) return actual.realpath(faults.fileAlias.target)
      }
      return actual.realpath(path)
    },
    rename: async (...args: Parameters<typeof actual.rename>) => { if (faults.renameGate) { faults.renameEntered?.(); await faults.renameGate }; if (faults.failRename) throw Object.assign(new Error(`forced EACCES ${args[1]}`), { code: 'EACCES' }); return actual.rename(...args) },
    rm: async (...args: Parameters<typeof actual.rm>) => { const path = String(args[0]); faults.calls.push(path); if (path.endsWith('.tmp') && faults.removeGate) { faults.removeEntered?.(); await faults.removeGate }; if (faults.failRemove?.(path)) throw Object.assign(new Error(`forced EBUSY ${path}`), { code: 'EBUSY' }); return actual.rm(...args) }
  }
})
const context = (): RequestContext => ({ requestId: 'lifecycle', signal: new AbortController().signal })
const options = { format: 'wav', bitrateKbps: null, bitDepth: 16 } as const
function deferred() { let resolve!: () => void; const promise = new Promise<void>(accept => { resolve = accept }); return { promise, resolve } }
function reset() { faults.renameGate = null; faults.renameEntered = null; faults.removeGate = null; faults.removeEntered = null; faults.failRemove = null; faults.failRename = false; faults.calls = []; faults.fileAlias = null; faults.realpathGate = null }
async function fixture(worker = new FfmpegWorker(), tasks = new TaskService()) {
  const directory = await mkdtemp(join(tmpdir(), 'export-lifecycle-'))
  const sourcePath = await makeAudioFile({ directory, name: '原曲 🎵.wav', durationSeconds: 1, toneHz: 440 })
  const original = await readFile(sourcePath)
  const assets = new AssetRegistry(new StorageRepository(join(directory, 'data')), join(directory, 'assets'))
  const asset = await assets.importFile(sourcePath, 'audio', context())
  const effects = defaultEffects(); effects[1].params = { wet: .5, decaySeconds: .1, seed: 1 }
  const edit = { assetId: asset.id, assetHash: asset.hash, range: { startSeconds: 0, endSeconds: 1 }, rate: 1, preservePitch: true, fadeInSeconds: 0, fadeOutSeconds: 0, effects }
  let destination = join(directory, '成品.wav')
  const exporter = new AudioExportService(assets, tasks, join(directory, 'derived'), async () => destination, worker)
  const trusted = { webContents: {}, frame: {}, url: 'file:///app/index.html' }
  const route = createIpcRouter(tasks, () => trusted, { exporter } as LibraryHost)
  const request = (method: string, params: object) => route(trusted, { method, params, requestId: 'lifecycle' })
  return { directory, sourcePath, original, assets, edit, tasks, exporter, destination,
    start(value: AudioEdit, encoder: AudioExportOptions, _ctx: RequestContext) { return request('export.start', { edit: value, options: encoder }) as Promise<string> },
    publicGet(jobId: string) { return request('export.get', { jobId }) }, publicCancel(jobId: string) { return request('jobs.cancel', { jobId }) },
    setDestination(path: string) { destination = path }, async cleanup() { reset(); await rm(directory, { recursive: true, force: true }) } }
}

test.each(['rename', 'cleanup'] as const)('cancel during %s retains committed destination and completed result', async phase => {
  const f = await fixture(); const entered = deferred(); const release = deferred()
  if (phase === 'rename') { faults.renameGate = release.promise; faults.renameEntered = entered.resolve }
  else { faults.removeGate = release.promise; faults.removeEntered = entered.resolve }
  try {
    await writeFile(f.destination, 'previous approved output')
    const id = await f.start(f.edit, options, context()); await entered.promise
    const before = await readFile(f.destination)
    let rejection: unknown; try { f.tasks.cancel(id) } catch (error) { rejection = error }
    expect(f.tasks.get(id).status).toBe('running')
    expect(String(rejection)).toMatch(/保存|提交|取消/)
    await expect(f.publicCancel(id)).rejects.toThrow('成品正在保存，已无法取消')
    if (phase === 'rename') expect(before.toString()).toBe('previous approved output')
    let drained = false; const drain = f.exporter.shutdown().then(() => { drained = true })
    await Promise.resolve(); expect(drained).toBe(false)
    release.resolve()
    await drain
    await expect.poll(() => f.tasks.get(id).status).toBe('completed')
    expect(f.tasks.get(id).result).toMatchObject({ format: 'wav', sourceTimeMap: { sourceAssetId: f.edit.assetId } })
    expect(await f.publicGet(id)).toEqual(f.tasks.get(id))
    expect((await readFile(f.destination)).toString('ascii',0,4)).toBe('RIFF')
    expect(await readFile(f.sourcePath)).toEqual(f.original)
    expect((await readdir(f.directory)).filter(n => n.startsWith('.audio-'))).toEqual([])
  } finally { release.resolve(); reset(); await new Promise(done => setTimeout(done, 100)); await f.cleanup() }
})

class HeldWorker extends FfmpegWorker {
  readonly entered = deferred(); readonly release = deferred()
  override async run(spec: FfmpegJob, ctx: RequestContext, report: (progress: number) => void) { const media = await super.run(spec,ctx,report); this.entered.resolve(); await this.release.promise; return media }
}

async function fileAlias(destination: string, target: string) {
  await writeFile(target,'previous referenced target')
  try { await symlink(target,destination,'file'); console.log('File alias mode: actual filesystem symlink') }
  catch (error) {
    if (!['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    // On Windows without symlink privilege, preserve actual rename/file bytes and model only the
    // old directory entry's target resolution. Its real inode changes when rename replaces it.
    await copyFile(target,destination)
    const info = await lstat(destination)
    faults.fileAlias = { path: destination, target, ino: info.ino, dev: info.dev }
    console.log('File alias mode: controlled target resolution; native file symlink denied:', (error as NodeJS.ErrnoException).code)
  }
  expect(await realpath(destination)).toBe(await realpath(target))
}

test('file symlink replacement keeps destination and resolved target reserved through cleanup, then releases both', async () => {
  const worker = new HeldWorker(); const f = await fixture(worker)
  const cleanupEntered = deferred(); const cleanupRelease = deferred(); const target = join(f.directory,'previous-target.wav')
  try {
    await fileAlias(f.destination,target)
    const previousEntry = await lstat(f.destination)
    const originalTarget = await readFile(target)
    const id = await f.start(f.edit,options,context()); await worker.entered.promise
    f.setDestination(target)
    await expect(f.start(f.edit,options,context())).rejects.toThrow(/正在|处理中|占用/)
    f.setDestination(f.destination)
    faults.removeGate = cleanupRelease.promise; faults.removeEntered = cleanupEntered.resolve
    worker.release.resolve(); await cleanupEntered.promise
    const currentEntry = await lstat(f.destination)
    expect(currentEntry.isSymbolicLink()).toBe(false)
    expect(currentEntry.ino).not.toBe(previousEntry.ino)
    expect(currentEntry.dev).toBe(previousEntry.dev)
    expect(await realpath(f.destination)).toBe(f.destination)
    const published = await readFile(f.destination); expect(published.toString('ascii',0,4)).toBe('RIFF')
    expect(f.tasks.get(id).status).toBe('running')
    console.log('Alias state: D resolves T before commit; actual rename replaced D; D resolves D while first job remains running in cleanup')
    await expect(f.start(f.edit,options,context())).rejects.toThrow(/正在|处理中|占用/)
    f.setDestination(target)
    await expect(f.start(f.edit,options,context())).rejects.toThrow(/正在|处理中|占用/)
    f.setDestination(f.destination)
    await expect(f.start(f.edit,options,context())).rejects.toThrow(/正在|处理中|占用/)
    expect(await readFile(f.destination)).toEqual(published)
    expect(await readFile(target)).toEqual(originalTarget)
    cleanupRelease.resolve(); await f.tasks.wait(id)
    expect(f.tasks.get(id).status).toBe('completed')
    f.setDestination(target); const targetRetry = await f.start(f.edit,options,context()); await f.tasks.wait(targetRetry)
    expect(f.tasks.get(targetRetry).status).toBe('completed')
    f.setDestination(f.destination); const destinationRetry = await f.start(f.edit,options,context()); await f.tasks.wait(destinationRetry)
    expect(f.tasks.get(destinationRetry).status).toBe('completed')
    expect(await readFile(f.sourcePath)).toEqual(f.original)
    expect((await readdir(f.directory)).filter(name => name.startsWith('.audio-'))).toEqual([])
    expect((await readdir(join(f.directory,'assets'))).filter(name => name.startsWith('snapshot-'))).toEqual([])
  } finally { worker.release.resolve(); cleanupRelease.resolve(); await f.exporter.shutdown(); await f.cleanup() }
})

test('file symlink replacement rejects an earlier save choice whose realpath finishes after first commit', async () => {
  const worker = new HeldWorker(); const f = await fixture(worker)
  const cleanupEntered = deferred(); const cleanupRelease = deferred(); const resolutionEntered = deferred(); const resolutionRelease = deferred()
  const target = join(f.directory,'previous-target.wav')
  try {
    await fileAlias(f.destination,target)
    const previousEntry = await lstat(f.destination); const originalTarget = await readFile(target)
    const id = await f.start(f.edit,options,context()); await worker.entered.promise
    faults.realpathGate = { path: f.destination, wait: resolutionRelease.promise, entered: resolutionEntered.resolve }
    const second = f.start(f.edit,options,context()).then(jobId => ({ jobId, error: null }), error => ({ jobId: null, error: error as Error }))
    await resolutionEntered.promise
    expect(await readFile(f.destination)).toEqual(await readFile(target))
    faults.removeGate = cleanupRelease.promise; faults.removeEntered = cleanupEntered.resolve
    worker.release.resolve(); await cleanupEntered.promise
    const published = await readFile(f.destination)
    expect(published.toString('ascii',0,4)).toBe('RIFF')
    const currentEntry = await lstat(f.destination)
    expect(currentEntry.ino).not.toBe(previousEntry.ino); expect(currentEntry.dev).toBe(previousEntry.dev)
    expect(currentEntry.isSymbolicLink()).toBe(false)
    resolutionRelease.resolve(); const result = await second
    console.log('Alias race: second save selected old D→T; target realpath resumed after first rename; first job still held in cleanup')
    expect(result.jobId).toBeNull(); expect(result.error?.message).toMatch(/正在|处理中|占用/)
    expect(await readFile(f.destination)).toEqual(published)
    expect(await readFile(target)).toEqual(originalTarget)
    cleanupRelease.resolve(); await f.tasks.wait(id)
    const retry = await f.start(f.edit,options,context()); await f.tasks.wait(retry)
    expect(f.tasks.get(retry).status).toBe('completed')
    expect(await readFile(f.sourcePath)).toEqual(f.original)
    expect((await readdir(f.directory)).filter(name => name.startsWith('.audio-'))).toEqual([])
    expect((await readdir(join(f.directory,'assets'))).filter(name => name.startsWith('snapshot-'))).toEqual([])
  } finally { worker.release.resolve(); resolutionRelease.resolve(); cleanupRelease.resolve(); await f.exporter.shutdown(); await f.cleanup() }
})

test.each(['rename failure','queued cancellation','processing cancellation','cleanup warning'] as const)('file alias reservations release both keys after %s', async ending => {
  class QueuedCancelTasks extends TaskService {
    cancelNext = ending === 'queued cancellation'
    override start<T>(...args: Parameters<TaskService['start']>): string {
      const id = super.start(...args)
      if (this.cancelNext) { this.cancelNext = false; this.cancel(id) }
      return id
    }
  }
  const worker = new HeldWorker(); const f = await fixture(worker,new QueuedCancelTasks())
  const target = join(f.directory,'previous-target.wav'); const log = vi.spyOn(console,'error').mockImplementation(() => {})
  try {
    await fileAlias(f.destination,target)
    const originalTarget = await readFile(target); const previousEntry = await lstat(f.destination)
    const id = await f.start(f.edit,options,context())
    if (ending !== 'queued cancellation') {
      await worker.entered.promise
      if (ending === 'processing cancellation') await f.publicCancel(id)
      if (ending === 'rename failure') faults.failRename = true
      if (ending === 'cleanup warning') faults.failRemove = path => path.endsWith('.tmp.ir')
    }
    worker.release.resolve(); await f.tasks.wait(id)
    const job = await f.publicGet(id)
    expect(job).toMatchObject({ status: ending === 'rename failure' ? 'failed' : ending === 'cleanup warning' ? 'completed' : 'cancelled' })
    if (ending === 'cleanup warning') {
      expect(job).toMatchObject({ result: { cleanupWarning: '成品已保存，但临时资源清理失败' } })
      expect((await readFile(f.destination)).toString('ascii',0,4)).toBe('RIFF')
      expect((await lstat(f.destination)).ino).not.toBe(previousEntry.ino)
    }
    else expect(await readFile(f.destination)).toEqual(originalTarget)
    expect(await readFile(target)).toEqual(originalTarget)
    expect((await readdir(join(f.directory,'assets'))).filter(name => name.startsWith('snapshot-'))).toEqual([])
    const remaining = (await readdir(f.directory)).filter(name => name.startsWith('.audio-'))
    expect(remaining.length).toBe(ending === 'cleanup warning' ? 1 : 0)
    if (ending === 'cleanup warning') expect(remaining[0].endsWith('.tmp.ir')).toBe(true)
    faults.failRename = false; faults.failRemove = null
    for (const name of remaining) await rm(join(f.directory,name),{ force: true })
    f.setDestination(target); const targetRetry = await f.start(f.edit,options,context()); await f.tasks.wait(targetRetry)
    expect(f.tasks.get(targetRetry).status).toBe('completed')
    f.setDestination(f.destination); const destinationRetry = await f.start(f.edit,options,context()); await f.tasks.wait(destinationRetry)
    expect(f.tasks.get(destinationRetry).status).toBe('completed')
    expect(await readFile(f.sourcePath)).toEqual(f.original)
    expect((await readdir(f.directory)).filter(name => name.startsWith('.audio-'))).toEqual([])
  } finally { worker.release.resolve(); await f.exporter.shutdown(); log.mockRestore(); await f.cleanup() }
})
test('canonical destination conflict is rejected across Windows case and parent junction aliases, then released', async () => {
  const worker = new HeldWorker(); const f = await fixture(worker)
  try {
    const alias = `${f.directory}-alias`; await symlink(f.directory, alias, 'junction')
    try {
      const id = await f.start(f.edit,options,context()); await worker.entered.promise
      f.setDestination(join(alias,basename(f.destination).toUpperCase()))
      await expect(f.start(f.edit,options,context())).rejects.toThrow(/正在|处理中|占用/)
      f.tasks.cancel(id); worker.release.resolve()
      await expect.poll(async () => (await readdir(join(f.directory,'assets'))).filter(n => n.startsWith('snapshot-')).length).toBe(0)
      const next = await f.start(f.edit,options,context())
      await expect.poll(() => f.tasks.get(next).status).toBe('completed')
    } finally { worker.release.resolve(); reset(); await rm(alias,{ force: true, recursive: true }) }
  } finally { worker.release.resolve(); await f.cleanup() }
})

test('shutdown aborts uncommitted operations, waits cleanup, and refuses new export or preview', async () => {
  const worker = new HeldWorker(); const f = await fixture(worker)
  try {
    const id = await f.start(f.edit,options,context()); await worker.entered.promise
    expect(typeof f.exporter.shutdown, 'exporter shutdown/drain is missing').toBe('function')
    let drained = false; const drain = f.exporter.shutdown().then(() => { drained = true })
    await expect(f.start(f.edit,options,context())).rejects.toThrow(/关闭|退出/)
    await expect(f.exporter.renderPreview(f.edit,context())).rejects.toThrow(/关闭|退出/)
    await Promise.resolve(); expect(drained).toBe(false)
    worker.release.resolve(); await drain
    expect(f.tasks.get(id).status).toBe('cancelled')
    expect((await readdir(f.directory)).filter(n => n.startsWith('.audio-'))).toEqual([])
    expect((await readdir(join(f.directory,'assets'))).filter(n => n.startsWith('snapshot-'))).toEqual([])
    expect(await readFile(f.sourcePath)).toEqual(f.original)
  } finally { worker.release.resolve(); reset(); await new Promise(done => setTimeout(done,100)); await f.cleanup() }
})

test.each(['output', 'ir', 'snapshot'] as const)('cleanup failure at %s still attempts all resources with safe completed warning and private diagnostics', async resource => {
  const worker = new HeldWorker(); const f = await fixture(worker); const diagnostics: unknown[] = []; const log = vi.spyOn(console,'error').mockImplementation((...args) => { diagnostics.push(args) })
  try {
    const id = await f.start(f.edit,options,context())
    await worker.entered.promise
    faults.calls = []
    faults.failRemove = path => resource === 'output' ? path.endsWith('.tmp') : resource === 'ir' ? path.endsWith('.tmp.ir') : basename(path).startsWith('snapshot-')
    worker.release.resolve()
    await expect.poll(() => ['failed','completed'].includes(f.tasks.get(id).status)).toBe(true)
    const job = f.tasks.get<{ cleanupWarning?: string }>(id)
    expect(faults.calls.some(path => path.endsWith('.tmp.ir'))).toBe(true)
    expect(faults.calls.some(path => path.endsWith('.tmp'))).toBe(true)
    expect(faults.calls.some(path => basename(path).startsWith('snapshot-'))).toBe(true)
    expect((await readdir(join(f.directory,'assets'))).filter(n => n.startsWith('snapshot-')).length).toBe(resource === 'snapshot' ? 1 : 0)
    expect((await readdir(f.directory)).filter(n => n.endsWith('.tmp.ir')).length).toBe(resource === 'ir' ? 1 : 0)
    expect(job.status).toBe('completed'); expect(job.result?.cleanupWarning).toMatch(/清理失败/)
    expect(JSON.stringify(job)).not.toContain(f.directory)
    expect(await f.publicGet(id)).toEqual(job)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect((await readFile(f.destination)).toString('ascii',0,4)).toBe('RIFF')
    reset(); const retry = await f.start(f.edit,options,context()); await expect.poll(() => f.tasks.get(retry).status).toBe('completed')
  } finally { worker.release.resolve(); log.mockRestore(); await f.cleanup() }
})

test('failed publication preserves previous bytes, reports safe error and releases the canonical destination', async () => {
  const f = await fixture(); const log = vi.spyOn(console,'error').mockImplementation(() => {})
  try {
    await writeFile(f.destination,'old destination bytes'); faults.failRename = true
    const id = await f.start(f.edit,options,context())
    await f.tasks.wait(id)
    expect(f.tasks.get(id).status).toBe('failed')
    expect(f.tasks.get(id).error?.message).toBe('音频导出失败，请检查保存位置')
    expect(JSON.stringify(f.tasks.get(id))).not.toContain(f.directory)
    expect((await readFile(f.destination)).toString()).toBe('old destination bytes')
    expect((await readdir(f.directory)).filter(n => n.startsWith('.audio-'))).toEqual([])
    expect((await readdir(join(f.directory,'assets'))).filter(n => n.startsWith('snapshot-'))).toEqual([])
    reset(); const retry = await f.start(f.edit,options,context()); await f.tasks.wait(retry)
    expect(f.tasks.get(retry).status).toBe('completed'); expect(await readFile(f.sourcePath)).toEqual(f.original)
  } finally { log.mockRestore(); await f.cleanup() }
})

test('queued cancellation releases its reservation although processing never starts', async () => {
  class QueuedCancelTasks extends TaskService {
    cancelNext = true
    override start<T>(...args: Parameters<TaskService['start']>): string {
      const id = super.start(...args)
      if (this.cancelNext) { this.cancelNext = false; this.cancel(id) }
      return id
    }
  }
  const tasks = new QueuedCancelTasks(); const f = await fixture(new FfmpegWorker(),tasks)
  try {
    const id = await f.start(f.edit,options,context()); await tasks.wait(id)
    expect(tasks.get(id).status).toBe('cancelled')
    const retry = await f.start(f.edit,options,context()); await tasks.wait(retry)
    expect(tasks.get(retry).status).toBe('completed')
  } finally { await f.cleanup() }
})

test('snapshot creation failure and release cleanup never expose host paths and retain diagnostics', async () => {
  const f = await fixture(); const diagnostics: unknown[] = []; const log = vi.spyOn(console,'error').mockImplementation((...args) => { diagnostics.push(args) })
  try {
    const snapshot = await f.assets.checkedSnapshot(f.edit.assetId,f.edit.assetHash,context())
    faults.failRemove = path => basename(path).startsWith('snapshot-')
    const releaseError = await snapshot.release().then(() => new Error('unexpected success'), error => error as Error)
    expect(releaseError.message).toMatch(/清理失败/); expect(releaseError.message).not.toContain(f.directory)
    await writeFile(f.sourcePath,'changed')
    const creationError = await f.assets.checkedSnapshot(f.edit.assetId,f.edit.assetHash,context()).then(() => new Error('unexpected success'), error => error as Error)
    expect(creationError.message).not.toContain(f.directory)
    expect(diagnostics.length).toBeGreaterThan(0)
  } finally { log.mockRestore(); await f.cleanup() }
})

test('shutdown drains pre-processing even while the native save dialog remains pending', async () => {
  const f = await fixture(); const entered = deferred(); const dialog = deferred()
  const exporter = new AudioExportService(f.assets, f.tasks, join(f.directory,'derived'), async () => { entered.resolve(); await dialog.promise; return f.destination })
  try {
    const starting = exporter.start(f.edit,options,context()).then(() => new Error('unexpected success'), error => error as Error)
    await entered.promise; await exporter.shutdown()
    expect((await starting).name).toBe('AbortError')
    expect((await readdir(join(f.directory,'assets'))).filter(n => n.startsWith('snapshot-'))).toEqual([])
    expect(await readFile(f.sourcePath)).toEqual(f.original)
  } finally { dialog.resolve(); await f.cleanup() }
})

test('preview commit finishes registration despite a late cancel and shutdown, without deleting the result', async () => {
  const f = await fixture(); const entered = deferred(); const release = deferred(); const controller = new AbortController()
  faults.renameGate = release.promise; faults.renameEntered = entered.resolve
  try {
    const preview = f.exporter.renderPreview(f.edit,{ requestId: 'preview-commit', signal: controller.signal })
    await entered.promise; controller.abort()
    let drained = false; const drain = f.exporter.shutdown().then(() => { drained = true })
    await Promise.resolve(); expect(drained).toBe(false)
    release.resolve(); const asset = await preview; await drain
    expect(asset.sourceTimeMap?.sourceAssetId).toBe(f.edit.assetId)
    expect((await f.assets.readBytes(asset.id)).toString('ascii',0,4)).toBe('RIFF')
    expect((await readdir(join(f.directory,'derived'))).filter(name => name.startsWith('.audio-'))).toEqual([])
    expect((await readdir(join(f.directory,'assets'))).filter(name => name.startsWith('snapshot-'))).toEqual([])
    expect(await readFile(f.sourcePath)).toEqual(f.original)
  } finally { release.resolve(); reset(); await f.cleanup() }
})

test('shutdown interrupts pending runtime capability probes before waiting for operation drain', async () => {
  class PendingCapabilitiesWorker extends FfmpegWorker {
    readonly entered = deferred(); readonly release = deferred(); shutdownRequested = false
    override async capabilities() { this.entered.resolve(); await this.release.promise; return super.capabilities() }
    override async shutdown() { this.shutdownRequested = true; this.release.resolve(); await super.shutdown() }
  }
  const worker = new PendingCapabilitiesWorker(); const f = await fixture(worker)
  try {
    const id = await f.start(f.edit,options,context()); await worker.entered.promise
    const drain = f.exporter.shutdown()
    await expect.poll(() => worker.shutdownRequested, { timeout: 500 }).toBe(true)
    await drain; expect(f.tasks.get(id).status).toBe('cancelled')
  } finally { worker.release.resolve(); await f.exporter.shutdown(); await f.cleanup() }
})
