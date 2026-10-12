import type { StorageRepository } from '../storage/repository'
import { StoredSettingsSchema as storedSchema, emptyStoredSettings } from '../settings/stored-settings'
import { createReadStream, readFileSync, type ReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile, mkdtemp, open, realpath, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import type { AssetRecord, RequestContext } from '../../shared/contracts'
import { AssetRecordSchema } from '../../shared/schemas'
import { probeMedia, validateAudioDecode } from './media-probe'
export class AssetRegistry {
  private queue: Promise<unknown> = Promise.resolve()
  private paths = new Map<string, string>()
  constructor(private readonly repository: StorageRepository, private readonly directory: string) {}
  private async entries() {
    const stored = await this.repository.read('settings', storedSchema, emptyStoredSettings())
    this.paths = new Map(stored.assets.map((entry) => [entry.record.id, entry.path]))
    return stored
  }
  importFile(path: string, kind: AssetRecord['kind'], ctx: RequestContext, derived?: { parentAssetId: string; sourceTimeMap: NonNullable<AssetRecord['sourceTimeMap']> }): Promise<AssetRecord> {
    const work = this.queue.catch(() => {}).then(async () => {
      ctx.signal.throwIfAborted()
      const absolutePath = resolve(path)
      const info = await stat(absolutePath)
      if (!info.isFile()) throw new Error('不是文件')
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(absolutePath, { signal: ctx.signal })) hash.update(chunk)
      const digest = hash.digest('hex')
      let imported!: AssetRecord
      await this.repository.update('settings', storedSchema, emptyStoredSettings(), async stored => {
        const previous = stored.assets.find((entry) => entry.record.hash === digest && entry.record.kind === kind && JSON.stringify(entry.record.sourceTimeMap) === JSON.stringify(derived?.sourceTimeMap))
        if (previous) {
          // A duplicate at a new location can recover a previously moved source.
          previous.path = absolutePath
          imported = structuredClone(previous.record)
          return stored
        }
        const media = await probeMedia(absolutePath, ctx)
        if (kind === 'audio') {
          if (media.sampleRate === null || media.channels === null) throw new Error('不是音频文件')
          await validateAudioDecode(absolutePath, ctx)
        }
        const record = AssetRecordSchema.parse({ id: randomUUID(), kind, hash: digest, byteLength: info.size, media, parentAssetId: derived?.parentAssetId ?? null, ...(derived ? { sourceTimeMap: derived.sourceTimeMap } : {}) })
        ctx.signal.throwIfAborted()
        stored.assets.push({ record, path: absolutePath })
        imported = record
        return stored
      })
      this.paths.set(imported.id, absolutePath)
      return imported
    })
    this.queue = work
    return work
  }
  async importArtwork(bytes: Uint8Array, parentAssetId: string, ctx: RequestContext): Promise<AssetRecord> {
    await mkdir(this.directory, { recursive: true })
    const digest = createHash('sha256').update(bytes).digest('hex')
    const path = join(this.directory, digest)
    try { await writeFile(path, bytes, { flag: 'wx' }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const asset = await this.importFile(path, 'image', ctx)
    // A cover can be shared by multiple songs; parent is only the first owner.
    const work = this.queue.catch(() => {}).then(async () => {
      const stored = await this.repository.update('settings', storedSchema, emptyStoredSettings(), current => {
        const entry = current.assets.find(value => value.record.id === asset.id)!
        if (!entry.record.parentAssetId) entry.record.parentAssetId = parentAssetId
        return current
      })
      return structuredClone(stored.assets.find(value => value.record.id === asset.id)!.record)
    })
    this.queue = work
    return work
  }
  async get(id: string): Promise<AssetRecord> {
    await this.queue.catch(() => {})
    const entry = (await this.entries()).assets.find((value) => value.record.id === id)
    if (!entry) throw new Error('找不到素材')
    return structuredClone(entry.record)
  }
  openRead(id: string, range?: { start: number; end: number }): ReadStream {
    if (!this.paths.has(id)) {
      try {
        const stored = storedSchema.parse(JSON.parse(readFileSync(join(this.repository.directory, 'settings.json'), 'utf8')))
        this.paths = new Map(stored.assets.map((entry) => [entry.record.id, entry.path]))
      } catch { throw new Error('素材索引无法读取，已保留原文件') }
    }
    const path = this.paths.get(id)
    if (!path) throw new Error('找不到素材')
    return createReadStream(path, range)
  }
  async readBytes(id: string): Promise<Buffer> { await this.get(id); return readFile(this.paths.get(id)!) }
  async verifyOriginal(id: string): Promise<AssetRecord> {
    const record = await this.get(id)
    try {
      const hash = createHash('sha256')
      let byteLength = 0
      for await (const chunk of this.openRead(id)) { hash.update(chunk); byteLength += chunk.length }
      if (byteLength !== record.byteLength || hash.digest('hex') !== record.hash) throw new Error('changed')
      return record
    } catch { throw new Error('原音乐文件已更改或丢失，请重新导入') }
  }
  /** Main-only checked bytes. Consumers never reopen the mutable original. */
  async checkedSnapshot(id: string, expectedHash: string, ctx: RequestContext): Promise<{ record: AssetRecord; path: string; originalPath: string; release(): Promise<void> }> {
    const record = await this.get(id)
    if (record.kind !== 'audio' || record.hash !== expectedHash) throw new Error('素材哈希不匹配或不可编辑')
    let directory: string
    try { await mkdir(this.directory, { recursive: true }); directory = await mkdtemp(join(this.directory, 'snapshot-')) }
    catch (error) { console.error('Audio snapshot allocation failed', error); throw new Error('无法创建受控音频快照') }
    const path = join(directory, 'input')
    const release = async () => {
      try { await rm(directory, { recursive: true, force: true }) }
      catch (error) { console.error('Audio snapshot cleanup failed', error); throw new Error('受控音频快照清理失败') }
    }
    try {
      const originalPath = await realpath(this.paths.get(id)!)
      const output = await open(path, 'wx')
      const hash = createHash('sha256'); let length = 0
      try {
        for await (const chunk of createReadStream(originalPath, { signal: ctx.signal })) {
          ctx.signal.throwIfAborted(); hash.update(chunk); length += chunk.length
          await output.writeFile(chunk)
        }
      } finally { await output.close() }
      ctx.signal.throwIfAborted()
      if (length !== record.byteLength || hash.digest('hex') !== expectedHash) throw new Error('原音乐文件已更改或丢失，请重新导入')
      return { record, path, originalPath, release }
    } catch (error) {
      console.error('Audio snapshot creation failed', error)
      await release().catch(() => {})
      if (ctx.signal.aborted) throw ctx.signal.reason
      if (error instanceof Error && !('code' in error)) throw error
      throw new Error('原音乐文件已更改或丢失，请重新导入')
    }
  }
  async registerDerived(path: string, parentAssetId: string, sourceTimeMap: NonNullable<AssetRecord['sourceTimeMap']>, ctx: RequestContext): Promise<AssetRecord> {
    return this.importFile(path, 'audio', ctx, { parentAssetId, sourceTimeMap })
  }
}
