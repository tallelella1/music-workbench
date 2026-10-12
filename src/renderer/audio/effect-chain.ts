import { EffectRegistry } from '../../shared/effect-registry'
import { defaultEffects, EQ_FREQUENCIES, EqParamsSchema, ReverbParamsSchema, type EffectConfig } from '../../shared/effects'
import { createImpulseResponse } from '../../shared/impulse-response'

export class EffectChain {
  readonly input: GainNode
  readonly output: GainNode
  readonly availableFrequencies: number[]
  errors: string[] = []
  private readonly preamp: GainNode
  private readonly filters: BiquadFilterNode[]
  private readonly dry: GainNode
  private readonly wet: GainNode
  private readonly convolver: ConvolverNode
  private readonly direct: GainNode
  private readonly processed: GainNode
  private impulseKey = ''
  private bypassed = false
  constructor(private readonly context: BaseAudioContext, private readonly registry = new EffectRegistry()) {
    this.input = context.createGain(); this.output = context.createGain(); this.preamp = context.createGain()
    this.direct = context.createGain(); this.processed = context.createGain()
    this.dry = context.createGain(); this.wet = context.createGain(); this.convolver = context.createConvolver()
    this.convolver.normalize = false
    this.availableFrequencies = EQ_FREQUENCIES.filter((frequency) => frequency < context.sampleRate / 2)
    this.filters = this.availableFrequencies.map((frequency) => { const filter = context.createBiquadFilter(); filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1; return filter })
    this.input.connect(this.direct).connect(this.output)
    this.input.connect(this.preamp)
    let last: AudioNode = this.preamp
    for (const filter of this.filters) { last.connect(filter); last = filter }
    last.connect(this.dry).connect(this.processed)
    last.connect(this.convolver).connect(this.wet).connect(this.processed)
    this.processed.connect(this.output)
    this.direct.gain.value = 0; this.wet.gain.value = 0
    this.apply(defaultEffects())
  }
  private smooth(param: AudioParam, value: number) {
    param.cancelScheduledValues(this.context.currentTime)
    param.setTargetAtTime(value, this.context.currentTime, 0.015)
  }
  apply(configs: EffectConfig[]): void {
    this.errors = []
    const valid = new Map<string, EffectConfig>()
    for (const config of configs) {
      try {
        const parsed = this.registry.validate(config, 'realtime')
        if (valid.has(parsed.effectId)) throw new Error('重复音效')
        valid.set(parsed.effectId, parsed)
      } catch (error) { this.errors.push(error instanceof Error ? error.message : '音效失败') }
    }
    const defaults = defaultEffects()
    const eqConfig = valid.get('eq-10')
    const eq = EqParamsSchema.parse(eqConfig?.enabled ? eqConfig.params : defaults[0].params)
    this.smooth(this.preamp.gain, 10 ** (eq.preampDb / 20))
    this.filters.forEach((filter, index) => this.smooth(filter.gain, eq.gainsDb[index]))
    const reverbConfig = valid.get('reverb')
    const reverb = ReverbParamsSchema.parse(reverbConfig?.enabled ? reverbConfig.params : defaults[1].params)
    try {
      const key = `${reverb.decaySeconds}:${reverb.seed}`
      if (this.impulseKey !== key) {
        const channels = createImpulseResponse(this.context.sampleRate, reverb.decaySeconds, reverb.seed)
        const buffer = this.context.createBuffer(2, channels[0].length, this.context.sampleRate)
        channels.forEach((channel, index) => buffer.getChannelData(index).set(channel))
        this.convolver.buffer = buffer; this.impulseKey = key
      }
      this.smooth(this.wet.gain, reverb.wet); this.smooth(this.dry.gain, 1 - reverb.wet)
    } catch (error) {
      this.errors.push(error instanceof Error ? error.message : '混响失败')
      this.smooth(this.wet.gain, 0); this.smooth(this.dry.gain, 1)
    }
  }
  bypass(value: boolean): void {
    this.bypassed = value
    this.smooth(this.direct.gain, value ? 1 : 0); this.smooth(this.processed.gain, value ? 0 : 1)
  }
  get isBypassed(): boolean { return this.bypassed }
  dispose(): void {
    for (const node of [this.input, this.output, this.preamp, ...this.filters, this.dry, this.wet, this.convolver, this.direct, this.processed]) node.disconnect()
  }
}
