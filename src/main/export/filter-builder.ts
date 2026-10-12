import type { MediaProbe } from '../../shared/contracts'
import { AudioEditSchema, type AudioEdit } from '../../shared/audio-export'
import { EffectRegistry } from '../../shared/effect-registry'
import { EQ_FREQUENCIES, EqParamsSchema, ReverbParamsSchema } from '../../shared/effects'
import { createImpulseResponse } from '../../shared/impulse-response'
export function buildFilterGraph(raw: AudioEdit, input: MediaProbe): { filters: string; impulseResponse: Float32Array[] | null; outputDurationSeconds: number } {
  const edit = AudioEditSchema.parse(raw)
  if (!input.durationReliable || input.durationSeconds === null || !input.sampleRate || !input.channels || edit.range.endSeconds > input.durationSeconds) throw new Error('裁剪超出可靠音频区间')
  const sampleRate = input.sampleRate
  const frames = Math.round((edit.range.endSeconds - edit.range.startSeconds) / edit.rate * sampleRate)
  if (frames < 1) throw new Error('成品不足一个采样')
  const outputDurationSeconds = frames / sampleRate
  if (edit.fadeInSeconds > outputDurationSeconds || edit.fadeOutSeconds > outputDurationSeconds) throw new Error('淡入淡出超出成品区间')
  const configs = new EffectRegistry().validateAll(edit.effects, 'export')
  const eqConfig = configs.find(c => c.effectId === 'eq-10' && c.enabled)
  const verbConfig = configs.find(c => c.effectId === 'reverb' && c.enabled)
  const chain = [`atrim=start=${edit.range.startSeconds}:end=${edit.range.endSeconds}`, 'asetpts=PTS-STARTPTS']
  if (edit.rate !== 1) chain.push(edit.preservePitch ? `atempo=${edit.rate}` : `asetrate=${sampleRate * edit.rate},aresample=${sampleRate}`)
  chain.push(`apad=whole_len=${frames}`, `atrim=end_sample=${frames}`)
  if (input.channels === 1) chain.push('pan=stereo|c0=c0|c1=c0') // Match Web Audio mono upmix (unity in both channels).
  chain.push('aformat=sample_fmts=fltp:channel_layouts=stereo')
  if (eqConfig) {
    const eq = EqParamsSchema.parse(eqConfig.params)
    chain.push(`volume=${10 ** (eq.preampDb / 20)}`)
    EQ_FREQUENCIES.forEach((frequency, i) => { if (frequency < sampleRate / 2) chain.push(`equalizer=f=${frequency}:t=q:w=1:g=${eq.gainsDb[i]}:r=f64`) })
  }
  const verb = verbConfig ? ReverbParamsSchema.parse(verbConfig.params) : null
  const impulseResponse = verb && verb.wet > 0 ? createImpulseResponse(sampleRate, verb.decaySeconds, verb.seed) : null
  let filters = `[0:a:0]${chain.join(',')}[processed];`
  if (impulseResponse && verb) {
    // afir dry is input gain, wet is convolution gain; mixing is explicit.
    filters += `[processed]asplit=2[dry][send];[send][1:a:0]afir=dry=1:wet=1:gtype=none:irnorm=-1:irgain=1:irfmt=input:precision=double[verb];[dry]volume=${1 - verb.wet}[d];[verb]volume=${verb.wet}[v];[d][v]amix=inputs=2:normalize=0:duration=first[mixed];`
  } else filters += '[processed]anull[mixed];'
  const finish = [`apad=whole_len=${frames}`, `atrim=end_sample=${frames}`]
  if (edit.fadeInSeconds) finish.push(`afade=t=in:st=0:d=${edit.fadeInSeconds}`)
  if (edit.fadeOutSeconds) finish.push(`afade=t=out:st=${outputDurationSeconds - edit.fadeOutSeconds}:d=${edit.fadeOutSeconds}`)
  filters += `[mixed]${finish.join(',')}[out]`
  return { filters, impulseResponse, outputDurationSeconds }
}
