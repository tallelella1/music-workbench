import type { ZodType } from 'zod'
import { mkdir, readFile, rename, rm, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function atomicWrite(path: string, bytes: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx')
    try { await file.writeFile(bytes, 'utf8'); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}
export class StorageRepository {
  private readonly queues = new Map<string, Promise<unknown>>()
  private closing = false
  private closeWork: Promise<void> | null = null
  constructor(public readonly directory: string) {}
  private path(module: string): string {
    if (!['library', 'settings', 'extensions'].includes(module)) throw new Error('未知存储模块')
    return join(this.directory, `${module}.json`)
  }
  async read<T>(module: string, schema: ZodType<T>, initial: T): Promise<T> {
    await this.queues.get(module)?.catch(() => {})
    try { return schema.parse(JSON.parse(await readFile(this.path(module), 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return schema.parse(structuredClone(initial))
      throw new Error(`${module} 数据无法读取，已保留原文件`, { cause: error })
    }
  }
  write<T>(module: string, value: T, schema: ZodType<T>): Promise<void> {
    if (this.closing) return Promise.reject(new Error('存储正在关闭，拒绝新写入'))
    const path = this.path(module)
    const validated = schema.parse(structuredClone(value))
    const previous = this.queues.get(module) ?? Promise.resolve()
    const work = previous.catch(() => {}).then(async () => {
      try { schema.parse(JSON.parse(await readFile(path, 'utf8'))) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`${module} 数据结构不受支持，拒绝覆盖原文件`, { cause: error })
      }
      await atomicWrite(path, JSON.stringify(validated, null, 2))
    })
    this.queues.set(module, work)
    return work
  }
  /** Read, validate, mutate and atomically replace under one shared module queue. */
  update<T>(module: string, schema: ZodType<T>, initial: T, mutate: (current: T) => T | Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('存储正在关闭，拒绝新写入'))
    const path = this.path(module)
    const work = (this.queues.get(module) ?? Promise.resolve()).catch(() => {}).then(async () => {
      let current: T
      try { current = schema.parse(JSON.parse(await readFile(path, 'utf8'))) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`${module} 数据无法读取，已保留原文件`, { cause: error }); current = schema.parse(structuredClone(initial)) }
      const value = schema.parse(await mutate(current))
      await atomicWrite(path, JSON.stringify(value, null, 2))
      return structuredClone(value)
    })
    this.queues.set(module, work); return work
  }
  /** Seal synchronously, then drain every accepted module transaction. */
  close(): Promise<void> {
    if (!this.closeWork) {
      this.closing = true
      this.closeWork = Promise.allSettled([...this.queues.values()]).then(outcomes => {
        const errors = outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason)
        if (errors.length) throw new AggregateError(errors, '存储关闭前写入失败，原始数据已保留')
      })
    }
    return this.closeWork
  }
}
