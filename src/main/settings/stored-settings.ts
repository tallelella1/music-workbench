import { z } from 'zod'
import { AssetRecordSchema } from '../../shared/schemas'
import { MigratingSettingsSchema } from '../../shared/settings'
export const StoredSettingsSchema = z.strictObject({ schemaVersion: z.literal(1), assets: z.array(z.strictObject({ record: AssetRecordSchema, path: z.string().min(1) })), preferences: MigratingSettingsSchema.optional() })
export function emptyStoredSettings(): z.infer<typeof StoredSettingsSchema> { return { schemaVersion: 1, assets: [] } }
