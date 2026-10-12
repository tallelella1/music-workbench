import { afterEach, expect, test } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { StorageRepository } from '../../src/main/storage/repository'
import { migrateFile } from '../../src/main/storage/migrations'

const schema = z.strictObject({ schemaVersion: z.literal(1), count: z.number().int() })
const initial = { schemaVersion: 1 as const, count: 0 }
const directories: string[] = []
async function setup() { const directory = await mkdtemp(join(tmpdir(), 'music-storage-')); directories.push(directory); return { directory, repository: new StorageRepository(directory) } }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

test('only missing storage gets defaults; corrupt bytes survive read and write attempts', async () => {
  const { directory, repository } = await setup()
  expect(await repository.read('library', schema, initial)).toEqual(initial)
  const corrupt = Buffer.from('{ broken 音乐')
  await writeFile(join(directory, 'library.json'), corrupt)
  await expect(repository.read('library', schema, initial)).rejects.toThrow()
  await expect(repository.write('library', initial, schema)).rejects.toThrow()
  expect(await readFile(join(directory, 'library.json'))).toEqual(corrupt)
})
test('future schemas refuse writes and retain original bytes', async () => {
  const { directory, repository } = await setup()
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 2, count: 42, extra: 'keep' }))
  await writeFile(join(directory, 'library.json'), bytes)
  await expect(repository.read('library', schema, initial)).rejects.toThrow()
  await expect(repository.write('library', initial, schema)).rejects.toThrow()
  expect(await readFile(join(directory, 'library.json'))).toEqual(bytes)
})
test('module writes serialize and leave a complete JSON without temporary files', async () => {
  const { directory, repository } = await setup()
  await Promise.all(Array.from({ length: 15 }, (_, count) => repository.write('settings', { schemaVersion: 1, count }, schema)))
  expect(await new StorageRepository(directory).read('settings', schema, initial)).toEqual({ schemaVersion: 1, count: 14 })
  expect(await readdir(directory)).toEqual(['settings.json'])
})
test('failed migration leaves a byte-identical backup and original', async () => {
  const { directory } = await setup()
  const path = join(directory, 'library.json')
  const bytes = Buffer.from('{"schemaVersion":0,"count":10}')
  await writeFile(path, bytes)
  await expect(migrateFile(path, 1, [{ from: 0, schema, migrate: () => ({ schemaVersion: 1, count: 'bad' }) }])).rejects.toThrow()
  expect(await readFile(path)).toEqual(bytes)
  const backup = (await readdir(directory)).find((name) => name.endsWith('.bak'))!
  expect(await readFile(join(directory, backup))).toEqual(bytes)
})

test('successful migration validates each version and preserves original backup', async () => {
  const { directory, repository } = await setup()
  const path = join(directory, 'library.json'); const bytes = Buffer.from('{"schemaVersion":0,"count":10}')
  await writeFile(path, bytes)
  await migrateFile(path, 1, [{ from: 0, schema, migrate: (value) => ({ schemaVersion: 1, count: (value as { count: number }).count + 1 }) }])
  expect(await repository.read('library', schema, initial)).toEqual({ schemaVersion: 1, count: 11 })
  const backup = (await readdir(directory)).find((name) => name.endsWith('.bak'))!
  expect(await readFile(join(directory, backup))).toEqual(bytes)
})

test('close seals all module queues and drains accepted shared transactions before resolving', async () => {
  const { directory, repository } = await setup(); let release!: () => void; let entered!: () => void
  const held = new Promise<void>(done => { release = done }); const started = new Promise<void>(done => { entered = done })
  const first = repository.update('settings', schema, initial, async current => { entered(); await held; return { ...current, count: 1 } })
  const second = repository.update('settings', schema, initial, current => ({ ...current, count: current.count + 1 }))
  const other = repository.write('library', { ...initial, count: 3 }, schema)
  await started; let closed = false
  let closing = Promise.resolve()
  try {
    closing = repository.close().then(() => { closed = true })
    await expect(repository.update('settings', schema, initial, current => ({ ...current, count: 99 }))).rejects.toThrow('关闭')
    await expect(repository.write('library', { ...initial, count: 99 }, schema)).rejects.toThrow('关闭')
    expect(closed).toBe(false)
  } finally { release(); await Promise.all([first, second, other, closing]) }
  expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).count).toBe(2)
  expect(JSON.parse(await readFile(join(directory, 'library.json'), 'utf8')).count).toBe(3)
  expect((await readdir(directory)).sort()).toEqual(['library.json', 'settings.json'])
  await repository.close()
})

test('close reports a failed accepted transaction without overwriting corrupt data or hanging', async () => {
  const { directory, repository } = await setup(); const path = join(directory, 'settings.json'); const original = '{corrupt original'
  await writeFile(path, original)
  await expect(repository.write('settings', initial, schema)).rejects.toThrow('拒绝覆盖')
  await expect(repository.close()).rejects.toThrow('原始数据已保留')
  expect(await readFile(path, 'utf8')).toBe(original)
  expect(await readdir(directory)).toEqual(['settings.json'])
})
