import { z } from 'zod'
import { EffectConfigSchema, EqParamsSchema, ReverbParamsSchema, defaultEffects } from './effects'
import { AudioExportOptionsSchema } from './audio-export'
const effect = EffectConfigSchema.superRefine((value, ctx) => {
  const schema = value.effectId === 'eq-10' ? EqParamsSchema : value.effectId === 'reverb' ? ReverbParamsSchema : null
  if (!schema || value.paramVersion !== 1 || !schema.safeParse(value.params).success) ctx.addIssue({ code: 'custom', message: '不支持的音效参数' })
})
const ids = z.array(z.string().min(1).max(256)).max(40).refine(value => new Set(value).size === value.length)
export const AppSettingsSchema = z.strictObject({ schemaVersion: z.literal(1), volume: z.number().finite().min(0).max(1), rate: z.number().finite().min(.5).max(2), preservePitch: z.boolean(), effects: z.array(effect).length(2).refine(value => value[0]?.effectId === 'eq-10' && value[1]?.effectId === 'reverb', '基础音效需包含顺序固定的 eq-10/reverb'), sourceOrder: ids, enabledSources: ids, exportDefaults: AudioExportOptionsSchema })
export const SettingsPatchSchema = AppSettingsSchema.omit({ schemaVersion: true }).partial()
export type AppSettings = z.infer<typeof AppSettingsSchema>
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>
export function defaultSettings(): AppSettings { return { schemaVersion: 1, volume: .75, rate: 1, preservePitch: true, effects: defaultEffects(), sourceOrder: ['wy', 'kg', 'tx'], enabledSources: ['wy', 'kg', 'tx'], exportDefaults: { format: 'wav', bitrateKbps: null, bitDepth: 24 } } }
/** Only the documented v0 field names migrate; malformed/newer preferences stay protected. */
export const MigratingSettingsSchema = z.preprocess(input => {
  if (!input || typeof input !== 'object' || !('schemaVersion' in input) || input.schemaVersion !== 0) return input
  const legacy = input as Record<string, unknown>
  const effects = Array.isArray(legacy.effects) ? legacy.effects.map(raw => {
    const value = EffectConfigSchema.extend({ paramVersion: z.number().int().nonnegative() }).parse(raw)
    if (value.paramVersion !== 0) return value
    const p = value.params
    if (value.effectId === 'eq-10') return { ...value, paramVersion: 1, params: { gainsDb: p.gains, preampDb: p.preamp ?? 0 } }
    if (value.effectId === 'reverb') return { ...value, paramVersion: 1, params: { wet: typeof p.wetPercent === 'number' ? p.wetPercent / 100 : p.wet, decaySeconds: p.decay, seed: p.seed ?? 1 } }
    return value
  }) : defaultEffects()
  return { ...defaultSettings(), ...legacy, schemaVersion: 1, effects }
}, AppSettingsSchema)
