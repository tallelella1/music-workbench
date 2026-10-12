import { useEffect, useState } from 'react'
import { defaultSettings, type AppSettings } from '../../../shared/settings'
export function SettingsView({ onSaved }: { onSaved(value: AppSettings): void }) {
  const [value, setValue] = useState(defaultSettings); const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(true)
  const [sources, setSources] = useState<{ id: string; name: string; enabled: boolean; compatibilityError: string | null }[]>([])
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout> | undefined
    const updateSources = (extensions: typeof sources, enabled: string[], deadline: number) => {
      if (!active) return
      setSources(extensions)
      if (Date.now() < deadline && extensions.some(source => enabled.includes(source.id) && !source.enabled && source.compatibilityError === null)) {
        timer = setTimeout(() => { void window.musicApp.extensions.list().then(next => updateSources(next, enabled, deadline)).catch(failure => { if (active) setError(failure.message) }) }, 250)
      }
    }
    void Promise.all([window.musicApp.settings.read(), window.musicApp.extensions.list()]).then(([settings, extensions]) => {
      if (active) { setValue(settings); updateSources(extensions, settings.enabledSources, Date.now() + (extensions.length + 1) * 5000) }
    }).catch(failure => { if (active) setError(failure.message) }).finally(() => { if (active) setBusy(false) })
    return () => { active = false; clearTimeout(timer) }
  }, [])
  const save = async () => { setBusy(true); setError(''); setNotice(''); try { const { schemaVersion: _, effects: _effects, ...patch } = value; const saved = await window.musicApp.settings.update(patch); setValue(saved); onSaved(saved); setSources(await window.musicApp.extensions.list()); setNotice('设置已保存') } catch (failure) { setError(failure && typeof failure === 'object' && 'message' in failure ? String(failure.message) : '设置保存失败') } finally { setBusy(false) } }
  const choices = [{ id: 'wy', name: '网易云搜索' }, { id: 'kg', name: '酷狗搜索' }, { id: 'tx', name: 'QQ 搜索' }, ...sources]
  const ordered = [...new Set([...value.sourceOrder, ...choices.map(source => source.id)])].filter(id => choices.some(source => source.id === id))
  const move = (id: string, direction: number) => { const index = ordered.indexOf(id); const next = [...ordered]; const other = index + direction; if (other < 0 || other >= next.length) return; [next[index], next[other]] = [next[other], next[index]]; setValue({ ...value, sourceOrder: next }) }
  return <section className="source-settings" aria-label="应用设置"><h1>应用设置</h1><fieldset disabled={busy}>
    <label>默认音量<input aria-label="默认音量" type="number" min="0" max="1" step="0.05" value={value.volume} onChange={event => setValue({ ...value, volume: Number(event.target.value) })} /></label>
    <label>播放速度<input aria-label="默认播放速度" type="number" min="0.5" max="2" step="0.05" value={value.rate} onChange={event => setValue({ ...value, rate: Number(event.target.value) })} /></label>
    <label><input type="checkbox" checked={value.preservePitch} onChange={event => setValue({ ...value, preservePitch: event.target.checked })} />保持音高</label>
    <label>默认导出格式<select aria-label="默认导出格式" value={value.exportDefaults.format} onChange={event => setValue({ ...value, exportDefaults: event.target.value === 'mp3' ? { format: 'mp3', bitrateKbps: 320, bitDepth: null } : { format: event.target.value as 'wav' | 'flac', bitrateKbps: null, bitDepth: 24 } })}><option value="wav">WAV</option><option value="flac">FLAC</option><option value="mp3">MP3</option></select></label>
    {value.exportDefaults.format === 'mp3' ? <label>默认码率<select aria-label="默认导出码率" value={value.exportDefaults.bitrateKbps} onChange={event => setValue({ ...value, exportDefaults: { format: 'mp3', bitrateKbps: Number(event.target.value) as 128 | 320, bitDepth: null } })}><option value="128">128 kbps</option><option value="320">320 kbps</option></select></label> : <label>默认位深<select aria-label="默认导出位深" value={value.exportDefaults.bitDepth} onChange={event => setValue({ ...value, exportDefaults: { format: value.exportDefaults.format as 'wav', bitrateKbps: null, bitDepth: Number(event.target.value) as 16 | 24 | 32 } })}><option value="16">16 bit</option><option value="24">24 bit</option>{value.exportDefaults.format === 'wav' && <option value="32">32 bit</option>}</select></label>}
    <h2>音源顺序与启用偏好</h2>{ordered.map((id, index) => { const source = choices.find(source => source.id === id)!; const runtime = sources.find(source => source.id === id); return <article key={id}><label><input aria-label={`启用 ${source.name}`} type="checkbox" checked={value.enabledSources.includes(id)} onChange={event => setValue({ ...value, enabledSources: event.target.checked ? [...new Set([...value.enabledSources, id])] : value.enabledSources.filter(value => value !== id) })} />{source.name}</label><button type="button" aria-label={`上移 ${source.name}`} disabled={index === 0} onClick={() => move(id, -1)}>上移</button><button type="button" aria-label={`下移 ${source.name}`} disabled={index === ordered.length - 1} onClick={() => move(id, 1)}>下移</button>{runtime && <p>{runtime.enabled ? '实际状态：已运行' : '实际状态：未运行'}{runtime.compatibilityError ? ` · ${runtime.compatibilityError}` : ''}</p>}</article> })}
    <p>音效面板的调整自动保存。单源完整播放测试在“音源脚本”中执行。</p><button type="button" onClick={() => void save()}>保存设置</button>
  </fieldset>{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}</section>
}
