import type { Track } from '../../../shared/contracts'
import type { PlayerSnapshot } from '../../../shared/player'
import type { PlayerEngine } from '../../audio/player-engine'
function time(value: number) { return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}` }
export function PlayerBar({ engine, snapshot, track, onStep, onPlay, effectsOpen, onEffects, onQueue, quality, strictQuality, onQuality }: {
  engine: PlayerEngine; snapshot: PlayerSnapshot; track: Track | undefined; onStep(direction: number): void; onPlay(): void
  effectsOpen: boolean; onEffects(): void; onQueue(): void
  quality?: string; strictQuality?: boolean; onQuality?(quality: string, strict: boolean): void
}) {
  const ready = !!track && !['loading', 'error'].includes(snapshot.status)
  return <section className="player-bar" aria-label="播放控制" data-status={snapshot.status}>
    <div className="now-playing"><div className="empty-cover">{track?.artworkAssetId ? <img src={window.musicApp.assets.url(track.artworkAssetId)} alt="当前封面" /> : '♪'}</div><div><strong>{track?.title ?? '未在播放'}</strong><span>{snapshot.status === 'loading' ? '正在加载…' : track?.artists.join(' / ') || '从音乐库选择一首歌'}</span>{snapshot.actualQuality && <small className="actual-quality">{snapshot.actualQuality}</small>}</div></div>
    <div className="transport"><div className="transport-buttons">
      <button type="button" className={`icon-button${snapshot.shuffle ? ' is-active' : ''}`} aria-label="随机播放" aria-pressed={snapshot.shuffle} onClick={() => engine.setShuffle(!snapshot.shuffle)}>⇄</button>
      <button type="button" className="icon-button" aria-label="上一首" disabled={!track} onClick={() => onStep(-1)}>⏮</button>
      <button type="button" className="play-button" aria-label={snapshot.status === 'playing' ? '暂停' : '播放'} disabled={!ready} onClick={onPlay}>{snapshot.status === 'playing' ? 'Ⅱ' : '▶'}</button>
      <button type="button" className="icon-button" aria-label="下一首" disabled={!track} onClick={() => onStep(1)}>⏭</button>
      <button type="button" className={`icon-button${snapshot.repeat !== 'off' ? ' is-active' : ''}`} aria-label="循环播放" title={`循环：${snapshot.repeat}`} onClick={() => engine.setRepeat(snapshot.repeat === 'off' ? 'all' : snapshot.repeat === 'all' ? 'one' : 'off')}>{snapshot.repeat === 'one' ? '↻1' : '↻'}</button>
    </div><div className="timeline"><span>{time(snapshot.sourceSeconds)}</span><input type="range" aria-label="播放进度" min="0" max={snapshot.durationSeconds || 1} step="0.01" value={snapshot.sourceSeconds} disabled={!ready} onChange={(event) => engine.seek(Number(event.target.value))} /><span>{time(snapshot.durationSeconds)}</span></div></div>
    <div className="player-tools">{onQuality && <div className="playback-quality"><select aria-label="在线播放音质" value={quality} onChange={(event) => onQuality(event.target.value, strictQuality ?? false)}>{['128k', '320k', 'flac', 'flac24bit'].map((value) => <option key={value}>{value}</option>)}</select><label><input type="checkbox" aria-label="严格音质" checked={strictQuality} onChange={(event) => onQuality(quality ?? '128k', event.target.checked)} />严格</label></div>}<label className="volume-label">音量<input type="range" aria-label="音量" value={snapshot.volume} min="0" max="1" step="0.01" onChange={(event) => engine.setVolume(Number(event.target.value))} /></label><button type="button" className={`effects-toggle${effectsOpen ? ' is-active' : ''}`} aria-expanded={effectsOpen} onClick={onEffects}>音效</button><button type="button" className="icon-button" aria-label="播放队列" onClick={onQueue}>☷</button></div>
  </section>
}
