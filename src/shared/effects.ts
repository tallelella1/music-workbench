import { z, type ZodType } from 'zod'
export interface EffectConfig { effectId: string; paramVersion: number; enabled: boolean; params: Record<string, unknown> }
export interface EffectDefinition { id: string; paramVersion: number; schema: ZodType; defaults: Record<string, unknown>; realtime: boolean; export: boolean }
export const EffectConfigSchema = z.strictObject({ effectId: z.string().min(1), paramVersion: z.number().int().positive(), enabled: z.boolean(), params: z.record(z.string(), z.unknown()) })
export const EQ_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const
export const EqParamsSchema = z.strictObject({ gainsDb: z.array(z.number().finite().min(-12).max(12)).length(10), preampDb: z.number().finite().min(-24).max(12) })
export const ReverbParamsSchema = z.strictObject({ wet: z.number().finite().min(0).max(1), decaySeconds: z.number().finite().min(0.1).max(5), seed: z.number().int().min(0).max(0xffffffff) })
export function defaultEffects(): EffectConfig[] {
  return [{ effectId: 'eq-10', paramVersion: 1, enabled: true, params: { gainsDb: Array(10).fill(0), preampDb: 0 } },
    { effectId: 'reverb', paramVersion: 1, enabled: true, params: { wet: 0, decaySeconds: 1.5, seed: 1 } }]
}
export const EFFECT_PRESETS = [
  { name: '原声', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], preamp: 0, wet: 0 },
  { name: '温暖', gains: [3, 3, 2, 1, 0, 0, -1, -2, -2, -2], preamp: -3, wet: 0.08 },
  { name: '人声', gains: [-2, -2, -1, 0, 1, 3, 3, 1, 0, -1], preamp: -3, wet: 0.12 },
  { name: '明亮', gains: [-1, -1, 0, 0, 0, 1, 2, 3, 3, 2], preamp: -3, wet: 0.05 }
].map((preset) => ({ name: preset.name, configs: [
  { effectId: 'eq-10', paramVersion: 1, enabled: true, params: { gainsDb: preset.gains, preampDb: preset.preamp } },
  { effectId: 'reverb', paramVersion: 1, enabled: true, params: { wet: preset.wet, decaySeconds: 1.5, seed: 1 } }
] satisfies EffectConfig[] }))
