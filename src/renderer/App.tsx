import { PlayerEngine } from './audio/player-engine'
import { PlayerController } from './audio/player-controller'
import { PlayerBar } from './features/player/PlayerBar'
import { QueueView } from './features/player/QueueView'
import { EffectsPanel } from './features/effects/EffectsPanel'
import { defaultEffects } from '../shared/effects'
import type { Track } from '../shared/contracts'
import { useEffect, useState, useRef } from 'react'
import { emptyLibrary, type LibrarySnapshot } from '../shared/library'
import { LibraryView } from './features/library/LibraryView'
import { PlaylistView } from './features/library/PlaylistView'
import { SearchView } from './features/search/SearchView'
import { SourceSettings } from './features/extensions/SourceSettings'
import { AudioEditor } from './features/editor/AudioEditor'
import { SettingsView } from './features/settings/SettingsView'
import { defaultSettings, type AppSettings } from '../shared/settings'
import type { AppModule } from '../shared/app-modules'

const iconPaths: Record<string, string> = {
  note: 'M9 18V5l11-2v13M9 8l11-2M9 18c0 1.7-1.6 3-3.5 3S2 19.9 2 18.5 3.6 16 5.5 16 9 16.6 9 18ZM20 16c0 1.7-1.6 3-3.5 3S13 17.9 13 16.5 14.6 14 16.5 14 20 14.6 20 16Z',
  library: 'M3 4v16M8 4v16M13 4v16M17 4l4 15',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  album: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 6 0 0 1 16 0v2',
  heart: 'M12 21 3.5 12.5a5.5 5.5 0 0 1 8.5-7 5.5 5.5 0 0 1 8.5 7L12 21Z',
  list: 'M4 5h16M4 11h16M4 17h10',
  plus: 'M12 5v14M5 12h14',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7',
  previous: 'M5 5v14M19 5l-11 7 11 7V5Z', next: 'M19 5v14M5 5l11 7-11 7V5Z',
  play: 'M7 4l14 8-14 8V4Z',
  shuffle: 'M3 6h4l10 12h4M3 18h4l10-12h4M18 3l3 3-3 3M18 15l3 3-3 3',
  repeat: 'M4 8V6h15l-3-3M20 16v2H5l3 3M16 9l3-3M8 15l-3 3',
  volume: 'M3 9h4l5-5v16l-5-5H3V9ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
  sliders: 'M4 4v16M12 4v16M20 4v16M1 9h6M9 15h6M17 7h6',
  close: 'M6 6l12 12M18 6 6 18',
  folder: 'M3 7V4h7l2 3h9v13H3V7Z',
  headphones: 'M3 14v-3a9 9 0 0 1 18 0v3M3 13h4v8H3v-8ZM17 13h4v8h-4v-8Z'
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>
}

function IconButton({ name, label, disabled = false, onClick, active = false }: {
  name: string; label: string; disabled?: boolean; onClick?: () => void; active?: boolean
}) {
  return <button type="button" className={`icon-button${active ? ' is-active' : ''}`} aria-label={label} disabled={disabled} onClick={onClick}><Icon name={name} /></button>
}

export default function App() {
  const [settingsValue, setSettingsValue] = useState(defaultSettings)
  const [settingsReady, setSettingsReady] = useState(false)
  const [modules, setModules] = useState<AppModule[]>([])
  const lastPreferences = useRef('')
  const [effectsOpen, setEffectsOpen] = useState(false)
  const [editorTrack, setEditorTrack] = useState<Track | null>(null)
  const [engine] = useState(() => new PlayerEngine())
  const [controller] = useState(() => new PlayerController(engine, window.musicApp.playback))
  const [player, setPlayer] = useState(() => engine.snapshot())
  const [queueIds, setQueueIds] = useState<string[]>([])
  const remoteTracks = useRef(new Map<string, Track>())
  const [quality, setQuality] = useState('128k'); const [strictQuality, setStrictQuality] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [configs, setConfigs] = useState(defaultEffects)
  const [bypassed, setBypassed] = useState(false)
  // A pending load may start playing after the editor opens. Keep the source silent throughout editing.
  useEffect(() => { if (editorTrack && player.status === 'playing') engine.pause() }, [editorTrack, player.status, engine])
  useEffect(() => { const unsubscribe = engine.subscribe(setPlayer); return () => { unsubscribe(); engine.dispose() } }, [engine])
  useEffect(() => { engine.effects?.apply(configs); engine.effects?.bypass(bypassed) }, [engine, configs, bypassed, player.revisionId, player.status])
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>(emptyLibrary)
  const [view, setView] = useState('library')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [newPlaylist, setNewPlaylist] = useState(false)
  const [playlistName, setPlaylistName] = useState('')
  const [album, setAlbum] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [searchInitial, setSearchInitial] = useState('')
  const [searchRevision, setSearchRevision] = useState(0)
  const refresh = async () => {
    const library = await window.musicApp.library.list()
    const ids = [...library.tracks.map((track) => track.id), ...remoteTracks.current.keys()]
    setQueueIds(engine.reconcileQueue(ids))
    const currentId = engine.snapshot().trackId
    if (currentId && !ids.includes(currentId)) controller.stop()
    setSnapshot(library)
  }
  const run = (operation: () => Promise<unknown>) => {
    setBusy(true); setError('')
    void operation().then(async (result) => {
      const errors = (result as { errors?: { message: string }[] } | undefined)?.errors
      if (errors?.length) setError(errors.map((value) => value.message).join('；'))
      await refresh()
    }).catch((failure: unknown) => setError(typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '操作失败，请重试')).finally(() => setBusy(false))
  }
  useEffect(() => { void refresh().catch(() => setError('曲库数据无法读取，原文件已保留')) }, [])
  const applyPreferences = (value: AppSettings) => { setSettingsValue(value); engine.setVolume(value.volume); engine.setRate(value.rate, value.preservePitch); setConfigs(value.effects); lastPreferences.current = JSON.stringify({ volume: value.volume, rate: value.rate, preservePitch: value.preservePitch, effects: value.effects }) }
  useEffect(() => { let active = true; void Promise.all([window.musicApp.settings.read(), window.musicApp.modules.list()]).then(([value, available]) => { if (active) { applyPreferences(value); setModules(available); setSettingsReady(true) } }).catch(reportFailure); return () => { active = false } }, [])
  useEffect(() => {
    if (!settingsReady) return
    const patch = { volume: player.volume, rate: player.rate, preservePitch: player.preservePitch, effects: configs }
    const signature = JSON.stringify(patch); if (signature === lastPreferences.current) return
    lastPreferences.current = signature
    void window.musicApp.settings.update(patch).then(setSettingsValue).catch(failure => { lastPreferences.current = ''; reportFailure(failure) })
  }, [settingsReady, player.volume, player.rate, player.preservePitch, configs])
  const playlist = snapshot.playlists.find((value) => value.id === view)
  const tracks = playlist ? playlist.trackIds.map((id) => snapshot.tracks.find((track) => track.id === id)!).filter(Boolean) : view === 'favorites' ? snapshot.tracks.filter((track) => snapshot.favorites.includes(track.id)) : view === 'albums' && album ? snapshot.tracks.filter((track) => track.album === album) : snapshot.tracks
  const reportFailure = (failure: unknown) => setError(typeof failure === 'object' && failure && 'message' in failure ? String(failure.message) : '播放失败，请重试')
  const playTrack = (track: Track) => { if (!track.audioAssetId) remoteTracks.current.set(track.id, track); setError(''); void controller.playTrack(track, { quality: track.audioAssetId ? 'original' : quality, strict: track.audioAssetId ? true : strictQuality }).catch(reportFailure) }
  const selectTrack = (track: Track) => { const ids = tracks.map((value) => value.id); setQueueIds(ids); engine.setQueue(ids, ids.indexOf(track.id)); playTrack(track) }
  const findTrack = (id: string | null) => snapshot.tracks.find((track) => track.id === id) ?? (id ? remoteTracks.current.get(id) : undefined)
  const step = (direction: number) => { const id = direction > 0 ? engine.nextTrackId() : engine.previousTrackId(); const track = findTrack(id); if (track) playTrack(track) }
  useEffect(() => engine.onEnded(() => step(1)), [engine, snapshot.tracks, controller, quality, strictQuality])
  const currentTrack = findTrack(player.trackId)
  const queueTracks = queueIds.map(findTrack).filter((track): track is Track => !!track)
  const heading = playlist?.name ?? (view === 'favorites' ? '收藏' : view === 'albums' ? album ?? '专辑' : '音乐库')
  useEffect(() => {
    if (!effectsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setEffectsOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [effectsOpen])

  return <div className="app-shell" onDragOver={(event) => { event.preventDefault() }} onDrop={(event) => { event.preventDefault(); if (!busy && event.dataTransfer.files.length) run(() => window.musicApp.library.importDroppedFiles(Array.from(event.dataTransfer.files))) }}>
    <aside className="sidebar" aria-label="音乐导航">
      <div className="brand"><span className="brand-icon"><Icon name="note" size={24} /></span><div><strong>音乐工作台</strong><span>你的音乐，你的节奏</span></div></div>
      <form className="sidebar-search" onSubmit={(event) => { event.preventDefault(); setSearchInitial(searchText); setSearchRevision((value) => value + 1); setView('search') }}><Icon name="search" size={16} /><input aria-label="搜索音乐" placeholder="搜索音乐" value={searchText} onChange={(event) => setSearchText(event.target.value)} /><kbd>Enter</kbd></form>
      <nav aria-label="曲库"><p className="section-label">资料库</p>
        <button type="button" className={`nav-item${view === 'search' ? ' selected' : ''}`} onClick={() => { setSearchInitial(''); setView('search') }}><Icon name="search" />在线搜索</button>
        <button type="button" className={`nav-item${view === 'sources' ? ' selected' : ''}`} onClick={() => setView('sources')}><Icon name="headphones" />音源脚本</button>
        <button type="button" className={`nav-item${view === 'library' ? ' selected' : ''}`} aria-current={view === 'library' ? 'page' : undefined} onClick={() => setView('library')}><Icon name="library" />音乐库<span className="nav-count">{snapshot.tracks.length}</span></button>
        <button type="button" className="nav-item" disabled><Icon name="clock" />最近添加</button>
        <button type="button" className="nav-item" disabled><Icon name="person" />艺人</button>
        <button type="button" className={`nav-item${view === 'albums' ? ' selected' : ''}`} onClick={() => { setView('albums'); setAlbum(null) }}><Icon name="album" />专辑</button>
        <button type="button" className={`nav-item${view === 'favorites' ? ' selected' : ''}`} onClick={() => setView('favorites')}><Icon name="heart" />收藏</button>
      </nav>
      <div className="playlist-heading"><p className="section-label">播放列表</p><IconButton name="plus" label="新建播放列表" onClick={() => setNewPlaylist(true)} /></div>
      <div className="playlist-navigation">{snapshot.playlists.map((value) => <button key={value.id} type="button" className={`nav-item${view === value.id ? ' selected' : ''}`} onClick={() => setView(value.id)}><Icon name="list" />{value.name}</button>)}</div>
      {!snapshot.playlists.length && <p className="playlist-empty">把喜欢的音乐放在一起</p>}
      {modules.some(module => module.id === 'settings') && <button type="button" className={`nav-item${view === 'settings' ? ' selected' : ''}`} onClick={() => setView('settings')}><Icon name="sliders" />应用设置</button>}
      <div className="sidebar-bottom"><span className="local-dot" />本地音乐空间<Icon name="folder" size={15} /></div>
    </aside>

    <main className="library-content">
      <header className="toolbar"><div className="history-buttons"><IconButton name="left" label="返回" disabled /><IconButton name="right" label="前进" disabled /></div><span className="toolbar-note">每一首，都是你的选择</span><button type="button" className="editor-open" aria-label="编辑当前歌曲" disabled={!settingsReady || !modules.some(module => module.id === 'audio-editor') || !currentTrack?.audioAssetId} onClick={() => { if (currentTrack?.audioAssetId) { engine.pause(); setEditorTrack(currentTrack); setEffectsOpen(false) } }}>裁剪与导出</button><span className="avatar" aria-label="本地资料库"><Icon name="person" size={18} /></span></header>
      <div className="content-inner">
        {(view === 'search' || view === 'sources') && error && <p className="library-error" role="alert">{error}</p>}
        {view === 'settings' ? <SettingsView onSaved={applyPreferences} /> : view === 'sources' ? <SourceSettings onValidated={(track, resource, options) => { remoteTracks.current.set(track.id, track); setQueueIds([track.id]); engine.setQueue([track.id], 0); return controller.playResource(track, resource, options) }} /> : view === 'search' ? <SearchView key={searchRevision} initialText={searchInitial} localTracks={snapshot.tracks} onPlay={(track) => { if (!track.audioAssetId) remoteTracks.current.set(track.id, track); const ids = track.audioAssetId ? snapshot.tracks.map((value) => value.id) : [...new Set([...queueIds, track.id])]; setQueueIds(ids); engine.setQueue(ids, ids.indexOf(track.id)); playTrack(track) }} /> : <>
        <div className="page-heading"><div><p className="eyebrow">YOUR COLLECTION</p><h1>{heading}</h1><p className="collection-meta">{tracks.length} 首歌曲<span>·</span>你的私人音乐空间</p></div><div className="import-actions"><button type="button" className="import-button" disabled={busy} onClick={() => run(() => window.musicApp.library.importFiles())}><Icon name="plus" size={18} />{busy ? '正在导入…' : '添加音乐'}</button><button type="button" className="folder-import" disabled={busy} onClick={() => run(() => window.musicApp.library.importFolder())}>导入文件夹</button></div></div>
        {error && <p className="library-error" role="alert">{error}</p>}
        <div className="library-tabs" aria-label="音乐库视图"><span className="tab active">{playlist ? '歌单歌曲' : '全部音乐'}</span><span className="tab">本地歌曲</span><span className="tab-counter">{tracks.length} 首</span></div>
        {view === 'albums' && !album ? <div className="album-grid">{[...new Set(snapshot.tracks.map((track) => track.album).filter((value): value is string => value !== null))].map((name) => { const songs = snapshot.tracks.filter((track) => track.album === name); const cover = songs.find((track) => track.artworkAssetId)?.artworkAssetId; return <button key={name} type="button" className="album-card" onClick={() => setAlbum(name)}>{cover ? <img src={window.musicApp.assets.url(cover)} alt={`${name} 封面`} /> : <span>♪</span>}<strong>{name}</strong><small>{songs.length} 首歌曲</small></button> })}{!snapshot.tracks.some((track) => track.album) && <p className="view-empty">还没有带专辑标签的歌曲</p>}</div> : snapshot.tracks.length ? playlist ? <PlaylistView onPlay={selectTrack} busy={busy} snapshot={snapshot} tracks={tracks} run={run} playlistId={playlist.id} onDelete={() => run(async () => { await window.musicApp.library.deletePlaylist(playlist.id); setView('library') })} /> : <LibraryView onPlay={selectTrack} busy={busy} snapshot={snapshot} tracks={tracks} run={run} /> : <section className="empty-library" aria-labelledby="empty-title">
          <div className="record-art" aria-hidden="true"><div className="record-orbit orbit-one" /><div className="record-orbit orbit-two" /><div className="record-sleeve"><div className="sleeve-glow" /><Icon name="note" size={58} /><span>MUSIC</span></div><div className="vinyl"><div className="vinyl-label"><span /></div></div><span className="floating-note"><Icon name="note" size={22} /></span></div>
          <p className="empty-kicker">属于你的音乐故事</p><h2 id="empty-title">让喜欢的音乐，从这里开始</h2><p className="empty-description">这里还没有歌曲。添加本地音乐，<br />让珍藏的旋律拥有一个自己的地方。</p>
          <button type="button" className="primary-button" disabled={busy} onClick={() => run(() => window.musicApp.library.importFiles())}><Icon name="folder" size={18} />导入本地音乐</button>
          <p className="empty-footnote">音乐库为空 · 尚未添加任何歌曲</p>
        </section>}
        <div className="library-footer"><span><Icon name="note" size={14} />从一首歌开始，慢慢收藏</span><span>音乐工作台</span></div>
        </>}
      </div>
    </main>
    {newPlaylist && <div className="modal-backdrop"><form className="playlist-dialog" role="dialog" aria-label="新建歌单" onSubmit={(event) => { event.preventDefault(); run(async () => { await window.musicApp.library.createPlaylist(playlistName); setNewPlaylist(false); setPlaylistName('') }) }}><h2>新建歌单</h2><label>歌单名称<input aria-label="歌单名称" maxLength={100} value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} autoFocus /></label><div><button type="button" onClick={() => setNewPlaylist(false)}>取消</button><button type="submit" disabled={!playlistName.trim() || busy}>创建歌单</button></div></form></div>}

    {editorTrack && <AudioEditor exportDefaults={settingsValue.exportDefaults} track={editorTrack} effects={bypassed ? [] : configs} rate={player.rate} preservePitch={player.preservePitch} onPreviewPlay={() => engine.pause()} onClose={() => setEditorTrack(null)} />}
    {effectsOpen && <EffectsPanel engine={engine} snapshot={player} configs={configs} onChange={setConfigs} bypassed={bypassed} onBypass={setBypassed} onClose={() => setEffectsOpen(false)} />}
    {queueOpen && <QueueView tracks={queueTracks} currentId={player.trackId} onClose={() => setQueueOpen(false)} onSelect={(track, index) => { engine.setQueue(queueTracks.map((value) => value.id), index); playTrack(track) }} />}
    <PlayerBar quality={quality} strictQuality={strictQuality} onQuality={(nextQuality, nextStrict) => { setQuality(nextQuality); setStrictQuality(nextStrict); if (currentTrack && !currentTrack.audioAssetId) void controller.playTrack(currentTrack, { quality: nextQuality, strict: nextStrict }).catch(reportFailure) }} engine={engine} snapshot={player} track={currentTrack} onStep={step} onPlay={() => { if (player.status === 'playing') engine.pause(); else void controller.resume().catch(reportFailure) }} effectsOpen={effectsOpen} onEffects={() => { setQueueOpen(false); setEffectsOpen(!effectsOpen) }} onQueue={() => { setEffectsOpen(false); setQueueOpen(!queueOpen) }} />
  </div>
}
