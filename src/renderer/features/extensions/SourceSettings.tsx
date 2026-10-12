import { useEffect, useState, useRef } from 'react'
import type { Track } from '../../../shared/contracts'
import type { ExtensionManifest } from '../../../shared/extensions'
import type { PlaybackResource } from '../../../shared/player'
export function SourceSettings({ onValidated }: { onValidated(track: Track, resource: PlaybackResource, options: { quality: string; strict: boolean }): Promise<void> }) {
  const [sources, setSources] = useState<ExtensionManifest[]>([])
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [platform, setPlatform] = useState('wy'); const [songId, setSongId] = useState(''); const [title, setTitle] = useState(''); const [singer, setSinger] = useState(''); const [duration, setDuration] = useState(''); const [quality, setQuality] = useState('128k')
  const [hash, setHash] = useState(''); const [numericId, setNumericId] = useState(''); const [mediaMid, setMediaMid] = useState('')
  const [validated, setValidated] = useState<{ sourceId: string; track: Track; resource: PlaybackResource; options: { quality: string; strict: boolean } } | null>(null)
  const mounted = useRef(true); const activeTest = useRef<string | null>(null)
  const refresh = async () => setSources(await window.musicApp.extensions.list())
  useEffect(() => {
    mounted.current = true; void refresh().catch(() => { if (mounted.current) setError('音源记录无法读取，原文件已保留') })
    return () => { mounted.current = false; if (activeTest.current) void window.musicApp.playback.cancel(activeTest.current).catch(() => {}) }
  }, [])
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (failure) { setError(typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '音源操作失败') }
    finally { if (mounted.current) { await refresh().catch(() => {}); setBusy(false) } }
  }
  const testSource = (source: ExtensionManifest) => run(async () => {
    setValidated(null)
    const ref = { providerId: platform, songId: songId.trim(), identity: { originalTitle: title.trim(), singer: singer.trim(), durationSeconds: Number(duration), ...(platform === 'kg' ? { FileHash: hash.trim() || null } : {}), ...(platform === 'tx' ? { id: numericId.trim() ? Number(numericId) : null, media_mid: mediaMid.trim() || null } : {}) } }
    const requestId = crypto.randomUUID(); activeTest.current = requestId
    let resource: PlaybackResource
    try { resource = await window.musicApp.extensions.test(source.id, ref, quality, requestId) }
    finally { if (activeTest.current === requestId) activeTest.current = null }
    if (!mounted.current) return
    const track: Track = { id: `test-${source.id}-${platform}-${songId}`, title: title.trim() || songId, artists: [singer.trim()].filter(Boolean), album: null, version: 'unknown', versionDisplay: null, durationSeconds: Number(duration), artworkAssetId: null, audioAssetId: null, sources: [ref] }
    setValidated({ sourceId: source.id, track, resource, options: { quality, strict: true } })
    setNotice(`完整性通过 · ${resource.actualQuality} · 可以播放`)
  })
  return <section className="source-settings" aria-label="音源脚本设置"><p className="eyebrow">PLAYBACK SOURCES</p><h1>音源脚本</h1>
    <p>导入 LX 自定义音源；播放前核验完整媒体。重启后按保存的启用偏好初始化，失败原因显示在对应音源下。</p>
    <button type="button" className="import-button" disabled={busy} onClick={() => void run(async () => { const manifest = await window.musicApp.extensions.importScript(); if (manifest) setNotice(`${manifest.name} 已导入并启用`) })}>{busy ? '正在处理…' : '导入音源脚本'}</button>
    {error && <p role="alert" className="library-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <fieldset disabled={busy}><legend>测试指定歌曲</legend>
      <label>平台<select aria-label="测试平台" value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="wy">网易云</option><option value="kg">酷狗</option><option value="tx">QQ 音乐</option></select></label>
      <label>歌曲 ID<input aria-label="测试歌曲 ID" value={songId} onChange={(event) => setSongId(event.target.value)} /></label>
      <label>标题<input aria-label="测试歌曲标题" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>歌手<input aria-label="测试歌手" value={singer} onChange={(event) => setSinger(event.target.value)} /></label>
      <label>预期时长（秒）<input type="number" aria-label="预期时长（秒）" min="0.01" max="21600" step="0.01" value={duration} onChange={(event) => setDuration(event.target.value)} /></label>
      {platform === 'kg' && <label>平台 FileHash<input aria-label="酷狗 FileHash" value={hash} onChange={(event) => setHash(event.target.value)} /></label>}
      {platform === 'tx' && <><label>数字歌曲 ID<input aria-label="QQ 数字歌曲 ID" value={numericId} onChange={(event) => setNumericId(event.target.value)} /></label><label>media_mid<input aria-label="QQ media_mid" value={mediaMid} onChange={(event) => setMediaMid(event.target.value)} /></label></>}
      <label>音质<select aria-label="测试音质" value={quality} onChange={(event) => setQuality(event.target.value)}>{['128k', '320k', 'flac', 'flac24bit'].map((value) => <option key={value}>{value}</option>)}</select></label>
    </fieldset>
    {!sources.length && <p>尚未导入音源；在线搜索结果可以查看，完整播放需可用音源。</p>}
    {sources.map((source) => <article className="search-source" aria-label={source.name} key={source.id}><h2>{source.name} <small>{source.version}</small></h2><p>{source.enabled ? '已启用' : '未启用'}</p><p>{source.platformIds.join(' / ')} · {source.qualities.join(' / ')}</p>
      {source.compatibilityError && <p className="source-error">{source.compatibilityError}</p>}
      <button type="button" disabled={busy} onClick={() => void run(() => window.musicApp.extensions.enable(source.id, !source.enabled))}>{source.enabled ? '禁用' : '启用'}</button>
      <button type="button" disabled={busy || !source.enabled || !source.platformIds.includes(platform as 'wy') || !source.qualities.includes(quality as '128k') || !songId.trim() || !title.trim() || !singer.trim() || !(Number(duration) > 0)} onClick={() => void testSource(source)}>测试完整播放</button>
      {validated?.sourceId === source.id && <button type="button" disabled={busy || !source.enabled} onClick={() => void run(async () => { await onValidated(validated.track, validated.resource, validated.options); setNotice('已开始播放完整歌曲') })}>播放已验证歌曲</button>}
    </article>)}
  </section>
}
