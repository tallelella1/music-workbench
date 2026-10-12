import { defaultEffects, EFFECT_PRESETS, EQ_FREQUENCIES, EqParamsSchema, ReverbParamsSchema, type EffectConfig } from '../../../shared/effects'
import type { PlayerSnapshot } from '../../../shared/player'
import type { PlayerEngine } from '../../audio/player-engine'
export function EffectsPanel({ engine, snapshot, configs, onChange, bypassed, onBypass, onClose }: {
  engine: PlayerEngine; snapshot: PlayerSnapshot; configs: EffectConfig[]; onChange(value: EffectConfig[]): void
  bypassed: boolean; onBypass(value: boolean): void; onClose(): void
}) {
  const eq = EqParamsSchema.parse(configs[0].params); const reverb = ReverbParamsSchema.parse(configs[1].params)
  const update = (index: number, params: Record<string, unknown>) => onChange(configs.map((value, i) => i === index ? { ...value, params: { ...value.params, ...params } } : value))
  return <aside className="effects-panel" aria-label="音效面板"><div className="effects-heading"><div><p className="eyebrow">MAKE IT YOURS</p><h2>音效</h2></div><button type="button" className="icon-button" aria-label="关闭音效面板" onClick={onClose}>×</button></div>
    <div className="effects-controls"><label className="check-label"><input type="checkbox" checked={bypassed} onChange={(event) => onBypass(event.target.checked)} />旁路所有音效</label>
      <label>音色预设<select aria-label="音色预设" value="" onChange={(event) => { const preset = EFFECT_PRESETS.find((value) => value.name === event.target.value); if (preset) onChange(structuredClone(preset.configs)) }}><option value="">自定义</option>{EFFECT_PRESETS.map((preset) => <option key={preset.name}>{preset.name}</option>)}</select></label>
      <h3>10 段均衡器</h3><label>前级增益 <output>{eq.preampDb} dB</output><input aria-label="前级增益" type="range" min="-24" max="12" step="0.5" value={eq.preampDb} onChange={(event) => update(0, { preampDb: Number(event.target.value) })} /></label>
      <div className="eq-controls">{EQ_FREQUENCIES.map((frequency, index) => { const available = !engine.context || frequency < engine.context.sampleRate / 2; return <label key={frequency}>{frequency >= 1000 ? `${frequency / 1000}k` : frequency} Hz <output>{eq.gainsDb[index]} dB</output><input type="range" aria-label={`EQ ${frequency} Hz`} min="-12" max="12" step="0.5" value={eq.gainsDb[index]} disabled={!available} title={!available ? '当前采样率不支持此频段' : undefined} onChange={(event) => update(0, { gainsDb: eq.gainsDb.map((gain, i) => i === index ? Number(event.target.value) : gain) })} /></label> })}</div>
      <h3>混响</h3><label>空间混合 <output>{Math.round(reverb.wet * 100)}%</output><input aria-label="混响混合" type="range" min="0" max="1" step="0.01" value={reverb.wet} onChange={(event) => update(1, { wet: Number(event.target.value) })} /></label><label>衰减 <output>{reverb.decaySeconds} 秒</output><input aria-label="混响衰减" type="range" min="0.1" max="5" step="0.1" value={reverb.decaySeconds} onChange={(event) => update(1, { decaySeconds: Number(event.target.value) })} /></label>
      <h3>播放速度</h3><label>速度 <output>{snapshot.rate}×</output><input aria-label="播放速度" type="range" min="0.5" max="2" step="0.05" value={snapshot.rate} onChange={(event) => engine.setRate(Number(event.target.value), snapshot.preservePitch)} /></label><label className="check-label"><input aria-label="保持音高" type="checkbox" checked={snapshot.preservePitch} onChange={(event) => engine.setRate(snapshot.rate, event.target.checked)} />保持音高</label>
      <button type="button" className="effects-reset" onClick={() => { onChange(defaultEffects()); onBypass(false) }}>重置音效</button>
      {engine.effects?.errors.map((error, index) => <p role="alert" key={index}>{error}</p>)}
      {!snapshot.trackId && <p className="effects-footnote">选择歌曲后即可试听调整</p>}
    </div></aside>
}
