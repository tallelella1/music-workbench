import { useEffect, useRef, useState } from 'react'
import type { AssetRecord, Track } from '../../../shared/contracts'
import { AudioEditSchema, AudioExportOptionsSchema, type ExportCapabilities } from '../../../shared/audio-export'
import type { EffectConfig } from '../../../shared/effects'
import type { AudioExportOptions } from '../../../shared/audio-export'
export function AudioEditor({ track, effects, rate: initialRate, preservePitch: initialPitch, exportDefaults, onPreviewPlay, onClose }: { track: Track; effects: EffectConfig[]; rate: number; preservePitch: boolean; exportDefaults?: AudioExportOptions; onPreviewPlay(): void; onClose(): void }) {
  const [asset, setAsset] = useState<AssetRecord | null>(null); const [caps, setCaps] = useState<ExportCapabilities | null>(null)
  const [start, setStart] = useState(0); const [end, setEnd] = useState(track.durationSeconds ?? 0)
  const [rate, setRate] = useState(initialRate); const [preservePitch, setPitch] = useState(initialPitch)
  const [fadeIn, setFadeIn] = useState(0); const [fadeOut, setFadeOut] = useState(0)
  const [format, setFormat] = useState<'mp3' | 'flac' | 'wav'>(exportDefaults?.format ?? 'wav'); const [depth, setDepth] = useState<number>(exportDefaults?.bitDepth ?? 24); const [bitrate, setBitrate] = useState<number>(exportDefaults?.bitrateKbps ?? 320)
  const [preview, setPreview] = useState<AssetRecord | null>(null); const [busy, setBusy] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null); const [status, setStatus] = useState(''); const [progress, setProgress] = useState<number | null>(null); const [error, setError] = useState('')
  const requestId = useRef<string | null>(null); const mounted = useRef(true)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    const element = audio.current
    return () => { if (element) { element.pause(); element.removeAttribute('src'); element.load() } }
  }, [preview?.id])
  const showError = (failure: unknown) => setError(failure && typeof failure === 'object' && 'message' in failure ? String(failure.message) : '编辑失败')
  useEffect(() => {
    mounted.current = true
    void Promise.all([window.musicApp.assets.get(track.audioAssetId!), window.musicApp.export.capabilities()]).then(([record, capabilities]) => { if (mounted.current) { setAsset(record); setCaps(capabilities); setEnd(record.media.durationSeconds ?? 0) } }).catch(showError)
    return () => { mounted.current = false; if (requestId.current) void window.musicApp.export.cancelPreview(requestId.current) }
  }, [track.audioAssetId])
  useEffect(() => {
    if (!jobId) return
    let active = true
    const update = async () => {
      try {
        const job = await window.musicApp.export.get(jobId)
        if (!active) return
        setProgress(job.progress)
        const terminal = ['completed', 'cancelled', 'failed'].includes(job.status)
        setStatus(job.status === 'completed' ? '导出完成' : job.status === 'cancelled' ? '已取消导出' : job.status === 'failed' ? '导出失败' : '正在导出…')
        if (job.error) showError(job.error)
        if (job.result?.cleanupWarning) setError(job.result.cleanupWarning)
        if (terminal) { setBusy(false); setJobId(null) }
      } catch (failure) { if (active) { showError(failure); setBusy(false); setJobId(null) } }
    }
    void update(); const timer = window.setInterval(() => void update(), 300)
    return () => { active = false; window.clearInterval(timer) }
  }, [jobId])
  const edit = () => AudioEditSchema.parse({ assetId: asset!.id, assetHash: asset!.hash, range: { startSeconds: start, endSeconds: end }, rate, preservePitch, fadeInSeconds: fadeIn, fadeOutSeconds: fadeOut, effects })
  const generate = async () => {
    setError(''); setBusy(true); setPreview(null); const id = crypto.randomUUID(); requestId.current = id
    try { const result = await window.musicApp.export.preview(edit(), id); if (mounted.current) setPreview(result) }
    catch (failure) { if (mounted.current) showError(failure) }
    finally { requestId.current = null; if (mounted.current) setBusy(false) }
  }
  const save = async () => {
    setError(''); setStatus(''); setBusy(true)
    try { const options = AudioExportOptionsSchema.parse({ format, bitrateKbps: format === 'mp3' ? bitrate : null, bitDepth: format === 'mp3' ? null : depth }); setJobId(await window.musicApp.export.start(edit(), options)) }
    catch (failure) { showError(failure); setBusy(false) }
  }
  const change = (setter: (value: number) => void, value: string) => { setter(Number(value)); setPreview(null) }
  const depths = format === 'flac' ? caps?.flacBitDepths : caps?.wavBitDepths
  const outputSeconds = (end - start) / rate
  const valid = !!asset && !!caps && Number.isFinite(outputSeconds) && start >= 0 && end <= (asset.media.durationSeconds ?? 0) && outputSeconds > 0 && fadeIn <= outputSeconds && fadeOut <= outputSeconds && fadeIn >= 0 && fadeOut >= 0
  return <div className="modal-backdrop"><section className="audio-editor" role="dialog" aria-modal="true" aria-label="音频编辑">
    <div className="effects-heading"><div><p className="eyebrow">EDIT & EXPORT</p><h2>音频编辑</h2><p>{track.title} · {track.artists.join(' / ')}</p></div><button type="button" aria-label="关闭音频编辑" className="icon-button" onClick={onClose}>×</button></div>
    <p className="editor-note">保存新文件，原音乐保持不变。成品使用当前均衡器与混响设置。</p>
    <fieldset disabled={busy} className="editor-grid">
      <label>开始秒<input aria-label="开始秒" type="number" min="0" step="0.001" value={start} onChange={e => change(setStart, e.target.value)} /></label>
      <label>结束秒<input aria-label="结束秒" type="number" min="0" step="0.001" value={end} onChange={e => change(setEnd, e.target.value)} /></label>
      <label>导出速度<input aria-label="导出速度" type="number" min="0.5" max="2" step="0.05" value={rate} onChange={e => change(setRate, e.target.value)} /></label>
      <label className="check-label"><input aria-label="导出保持音高" type="checkbox" checked={preservePitch} onChange={e => { setPitch(e.target.checked); setPreview(null) }} />保持音高</label>
      <label>淡入秒<input aria-label="淡入秒" type="number" min="0" step="0.1" value={fadeIn} onChange={e => change(setFadeIn, e.target.value)} /></label>
      <label>淡出秒<input aria-label="淡出秒" type="number" min="0" step="0.1" value={fadeOut} onChange={e => change(setFadeOut, e.target.value)} /></label>
      <label>导出格式<select aria-label="导出格式" value={format} onChange={e => { const next = e.target.value as typeof format; setFormat(next); if (next !== 'mp3') setDepth((next === 'flac' ? caps?.flacBitDepths : caps?.wavBitDepths)?.[0] ?? 16) }}><option value="wav" disabled={!caps?.wavBitDepths.length}>WAV</option><option value="flac" disabled={!caps?.flacBitDepths.length}>FLAC</option><option value="mp3" disabled={!caps?.mp3Bitrates.length}>MP3</option></select></label>
      {format === 'mp3' ? <label>码率<select aria-label="导出码率" value={bitrate} onChange={e => setBitrate(Number(e.target.value))}>{caps?.mp3Bitrates.map(v => <option key={v} value={v}>{v} kbps</option>)}</select></label> : <label>位深<select aria-label="导出位深" value={depth} onChange={e => setDepth(Number(e.target.value))}>{depths?.map(v => <option key={v} value={v}>{v} bit</option>)}</select></label>}
    </fieldset>
    <p className="editor-duration">预计成品 <strong>{outputSeconds > 0 ? outputSeconds.toFixed(3) : '—'}</strong> 秒</p>
    {preview && <div className="editor-preview"><p>精确预览 · 已应用裁剪与音效</p><audio ref={audio} key={preview.id} controls onPlay={onPreviewPlay} src={window.musicApp.assets.url(preview.id)} /></div>}
    {error && <p role="alert" className="library-error">{error}</p>}
    {status && <p role="status">{status}</p>}{busy && jobId && <progress value={progress ?? undefined} max="1" aria-label="导出进度" />}
    <div className="editor-actions"><button type="button" disabled={!valid || busy} onClick={() => void generate()}>生成精确预览</button><button type="button" className="primary-button" disabled={!valid || busy} onClick={() => void save()}>保存成品</button>{busy && <button type="button" onClick={() => { if (jobId) void window.musicApp.jobs.cancel(jobId).catch(showError); else if (requestId.current) void window.musicApp.export.cancelPreview(requestId.current).catch(showError) }}>取消处理</button>}</div>
  </section></div>
}
