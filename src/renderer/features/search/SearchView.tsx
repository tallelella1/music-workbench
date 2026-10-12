import { useEffect, useRef, useState } from 'react'
import type { Track } from '../../../shared/contracts'
import type { SearchSourceState } from '../../../shared/providers'

type SourceView = Omit<SearchSourceState, 'status'> & { status: SearchSourceState['status'] | 'idle' | 'cancelled' }
const sourceNames: Record<string, string> = { wy: '网易云', kg: '酷狗', tx: 'QQ 音乐', kw: '酷我', mg: '咪咕' }
const statuses: Record<SourceView['status'], string> = { idle: '等待搜索', loading: '搜索中', ok: '已完成', empty: '暂无结果', timeout: '响应超时', 'rate-limited': '请求受限', error: '来源失败', cancelled: '已取消' }
const versions: Record<Track['version'], string> = { studio: '录音室', live: '现场', cover: '翻唱', instrumental: '伴奏', remix: '混音', unknown: '版本未知' }
function seconds(value: number | null): string { return value === null ? '时长未知' : `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` }

export function SearchView({ initialText = '', localTracks, onPlay }: { initialText?: string; localTracks: Track[]; onPlay(track: Track): void }) {
  const [text, setText] = useState(initialText)
  const [submittedText, setSubmittedText] = useState('')
  const [sources, setSources] = useState<SourceView[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const owners = useRef(new Map<string, string>())
  const active = useRef(new Set<string>())
  const ids = useRef<string[]>([])
  const lastInitial = useRef<string | null>(null)
  const mounted = useRef(true)
  const cancel = () => {
    owners.current.clear()
    for (const requestId of active.current) void window.musicApp.search.cancel(requestId).catch(() => {})
    active.current.clear()
    setSources((current) => current.map((source) => source.status === 'loading' ? { ...source, status: 'cancelled' } : source))
  }
  const run = (queryText: string, page = 1, providerId?: string, manualRetry = false) => {
    const clean = queryText.trim()
    if (!clean) return
    const selected = providerId ? [providerId] : ids.current
    if (!providerId) { cancel(); setSubmittedText(clean) }
    const requestId = crypto.randomUUID()
    for (const id of selected) owners.current.set(id, requestId)
    active.current.add(requestId)
    setNotice(''); setError('')
    setSources((current) => current.map((source) => selected.includes(source.providerId) ? { ...source, page, status: 'loading', error: null, tracks: [], total: null, nextPage: null } : source))
    void window.musicApp.search.run({ text: clean, page, pageSize: 20, authRevision: '0' }, requestId, { providerIds: selected, manualRetry }).catch((failure: unknown) => {
      if (!mounted.current) return
      const message = typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '搜索失败，请重试'
      setSources((current) => current.map((source) => owners.current.get(source.providerId) === requestId && source.status === 'loading' ? { ...source, status: 'error', error: { code: 'SEARCH_FAILED', message, moduleId: source.providerId, requestId } } : source))
    }).finally(() => active.current.delete(requestId))
  }
  useEffect(() => {
    mounted.current = true
    const unsubscribe = window.musicApp.onEvent((event) => {
      if (event.type !== 'search.updated') return
      setSources((current) => current.map((source) => {
        if (owners.current.get(source.providerId) !== event.requestId) return source
        return event.payload.providers.find((value) => value.providerId === source.providerId) ?? source
      }))
    })
    void window.musicApp.search.providers().then((providerIds) => {
      if (!mounted.current) return
      ids.current = providerIds
      setSources(providerIds.map((providerId) => ({ providerId, status: 'idle', error: null, tracks: [], page: 1, total: null, nextPage: null })))
    }).catch(() => { if (mounted.current) setError('搜索来源无法读取，请重新打开搜索') })
    return () => {
      mounted.current = false; unsubscribe(); owners.current.clear()
      for (const requestId of active.current) void window.musicApp.search.cancel(requestId).catch(() => {})
      active.current.clear()
    }
  }, [])
  useEffect(() => {
    if (!sources.length || !initialText.trim() || lastInitial.current === initialText) return
    lastInitial.current = initialText; setText(initialText); run(initialText)
  }, [initialText, sources.length])
  const tokens = text.normalize('NFKC').trim().toLowerCase().split(/\s+/).filter(Boolean)
  const localMatches = tokens.length ? localTracks.filter((track) => {
    const fields = [track.title, ...track.artists, track.album ?? ''].join(' ').normalize('NFKC').toLowerCase()
    return tokens.every((token) => fields.includes(token))
  }) : []
  const loading = sources.some((source) => source.status === 'loading')
  return <section className="search-view" aria-label="音乐搜索">
    <p className="eyebrow">FIND YOUR MUSIC</p><h1>搜索音乐</h1>
    <p className="search-intro">搜索本地珍藏与三个音乐平台，按来源查看歌曲。</p>
    <form className="search-form" onSubmit={(event) => { event.preventDefault(); run(text) }}>
      <input aria-label="搜索歌曲、歌手或专辑" placeholder="歌曲、歌手或专辑" maxLength={200} value={text} onChange={(event) => setText(event.target.value)} autoFocus />
      <button type="submit" disabled={!text.trim() || !sources.length}>开始搜索</button>
      {loading && <button type="button" className="search-cancel" onClick={() => { cancel(); setNotice('搜索已取消') }}>取消搜索</button>}
    </form>
    {notice && <p role="status" className="search-notice">{notice}</p>}
    {error && <p role="alert" className="library-error">{error}</p>}
    <nav className="search-overview" aria-label="来源状态">{sources.map((source) => {
      const name = sourceNames[source.providerId] ?? source.providerId
      const status = source.error?.code === 'SOURCE_PAUSED' ? '请求暂缓' : statuses[source.status]
      return <button key={source.providerId} type="button" onClick={() => document.getElementById(`search-source-${source.providerId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })} aria-label={`${name} ${status}`}><strong>{name}</strong><span className={`source-${source.status}`}>{status}</span></button>
    })}</nav>
    <section className="search-local" aria-label="本地搜索结果"><div className="source-heading"><h2>本地音乐</h2><span>{localMatches.length} 首</span></div>
      {localMatches.map((track) => <article className="search-track" key={track.id}><div><strong>{track.title}</strong><small>{track.artists.join(' / ') || '歌手未知'} · {track.album ?? '专辑未知'}</small></div><span>{seconds(track.durationSeconds)}</span><button type="button" aria-label={`播放 ${track.title}`} onClick={() => onPlay(track)}>播放</button></article>)}
      {!localMatches.length && <p className="source-empty">{tokens.length ? '本地曲库暂无匹配歌曲' : '输入关键词查找本地歌曲'}</p>}
    </section>
    <div className="search-summary"><span>{submittedText ? `“${submittedText}”的在线结果` : '在线来源'}</span><small>完整播放：尚未解析 · 版本或身份信息不足的歌曲分别保留</small></div>
    <div className="search-sources">{sources.map((source) => {
      const name = sourceNames[source.providerId] ?? source.providerId
      const failed = ['error', 'timeout', 'rate-limited', 'cancelled'].includes(source.status)
      return <section className="search-source" id={`search-source-${source.providerId}`} key={source.providerId} aria-label={`${name}搜索结果`} aria-busy={source.status === 'loading'}>
        <div className="source-heading"><h2>{name}</h2><span className={`source-status source-${source.status}`}>{source.error?.code === 'SOURCE_PAUSED' ? '请求暂缓' : statuses[source.status]}</span>{failed && submittedText && <button type="button" onClick={() => run(submittedText, source.page, source.providerId, true)} aria-label={`重试${name}`}>重试</button>}</div>
        {source.error && <p className="source-error">{source.error.message}</p>}
        {source.tracks.map((track, index) => <article className="search-track" key={`${track.id}:${index}`}><span className="search-track-number">{(source.page - 1) * 20 + index + 1}</span><div className="search-track-description"><strong>{track.title}</strong><small>{track.artists.join(' / ')} · {track.album ?? '专辑未知'}</small><small className="version-evidence">{versions[track.version]}{track.versionDisplay ? ` · ${track.versionDisplay}` : ''}</small></div><span className="search-duration">{seconds(track.durationSeconds)}</span><span className="search-playback">完整播放：尚未解析<button type="button" aria-label={`完整播放 ${track.title}`} onClick={() => onPlay(track)}>完整播放</button></span></article>)}
        {!source.tracks.length && !source.error && <p className="source-empty">{source.status === 'loading' ? '正在获取歌曲…' : source.status === 'empty' ? '没有找到匹配歌曲' : source.status === 'cancelled' ? '此来源搜索已取消' : '输入关键词开始搜索'}</p>}
        {source.status !== 'idle' && <div className="source-pagination"><span>第 {source.page} 页{source.total !== null ? ` · 共 ${source.total} 首` : ''}</span><div><button type="button" aria-label={`${name}上一页`} disabled={source.page <= 1 || source.status === 'loading' || !submittedText} onClick={() => run(submittedText, source.page - 1, source.providerId)}>上一页</button><button type="button" aria-label={`${name}下一页`} disabled={source.nextPage === null || source.status === 'loading' || !submittedText} onClick={() => run(submittedText, source.nextPage!, source.providerId)}>下一页</button></div></div>}
      </section>
    })}</div>
  </section>
}
