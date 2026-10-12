import { EffectConfigSchema, EqParamsSchema, ReverbParamsSchema, type EffectConfig, type EffectDefinition } from './effects'
export class EffectRegistry {
  private readonly definitions = new Map<string, EffectDefinition>()
  constructor() {
    this.register({ id: 'eq-10', paramVersion: 1, schema: EqParamsSchema, defaults: { gainsDb: Array(10).fill(0), preampDb: 0 }, realtime: true, export: true })
    this.register({ id: 'reverb', paramVersion: 1, schema: ReverbParamsSchema, defaults: { wet: 0, decaySeconds: 1.5, seed: 1 }, realtime: true, export: true })
  }
  register(definition: EffectDefinition): void {
    if (this.definitions.has(definition.id)) throw new Error('音效已注册')
    definition.schema.parse(definition.defaults)
    this.definitions.set(definition.id, definition)
  }
  validateAll(configs: EffectConfig[], purpose: 'realtime' | 'export'): EffectConfig[] {
    const seen = new Set<string>()
    return configs.map(config => {
      const parsed = this.validate(config, purpose)
      if (seen.has(parsed.effectId)) throw new Error('重复音效')
      seen.add(parsed.effectId)
      return parsed
    })
  }
  validate(config: EffectConfig, purpose: 'realtime' | 'export'): EffectConfig {
    const parsed = EffectConfigSchema.parse(config)
    const definition = this.definitions.get(parsed.effectId)
    if (!definition || definition.paramVersion !== parsed.paramVersion || !definition[purpose]) throw new Error('不支持此音效或参数版本')
    return { ...parsed, params: definition.schema.parse(parsed.params) as Record<string, unknown> }
  }
}
