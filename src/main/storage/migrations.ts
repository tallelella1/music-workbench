import type { ZodType } from 'zod'
import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { atomicWrite } from './repository'
export async function migrateFile(path: string, version: number, steps: { from: number; schema: ZodType; migrate(value: unknown): unknown }[]): Promise<void> {
  const bytes = await readFile(path)
  let value = JSON.parse(bytes.toString('utf8')) as { schemaVersion: number }
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion < 0 || value.schemaVersion > version) throw new Error('不支持的数据版本')
  if (value.schemaVersion === version) return
  await writeFile(`${path}.${randomUUID()}.bak`, bytes, { flag: 'wx' })
  while (value.schemaVersion < version) {
    const step = steps.find((entry) => entry.from === value.schemaVersion)
    if (!step) throw new Error('缺少数据迁移步骤')
    const next = step.schema.parse(step.migrate(structuredClone(value))) as { schemaVersion: number }
    if (next.schemaVersion !== value.schemaVersion + 1) throw new Error('迁移必须逐版本执行')
    value = next
  }
  await atomicWrite(path, JSON.stringify(value, null, 2))
}
