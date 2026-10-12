import type { Track } from '../../../shared/contracts'
import type { LibrarySnapshot } from '../../../shared/library'
export interface LibraryViewProps {
  snapshot: LibrarySnapshot
  tracks: Track[]
  run(operation: () => Promise<unknown>): void
  playlistId?: string
  busy?: boolean
  onPlay?(track: Track): void
}
export function LibraryView({ snapshot, tracks, run, playlistId, busy = false, onPlay }: LibraryViewProps) {
  const playlist = snapshot.playlists.find((value) => value.id === playlistId)
  function move(id: string, direction: number) {
    if (!playlist) return
    const ids = [...playlist.trackIds]; const index = ids.indexOf(id); const destination = index + direction
    if (destination < 0 || destination >= ids.length) return
    ;[ids[index], ids[destination]] = [ids[destination], ids[index]]
    run(() => window.musicApp.library.updatePlaylist(playlist.id, ids))
  }
  return <div className="track-table-wrap"><table className="track-table"><thead><tr><th>歌曲</th><th>专辑</th><th>时长</th><th>收藏与歌单</th></tr></thead><tbody>{tracks.map((track, index) => <tr key={track.id}>
    <td><div className="track-identity">{track.artworkAssetId ? <img className="track-cover" src={window.musicApp.assets.url(track.artworkAssetId)} alt={`${track.album ?? track.title} 封面`} /> : <span className="track-cover no-artwork">♪</span>}<div><strong>{track.title}</strong><small>{track.artists.join(' / ') || '未知艺人'}{track.versionDisplay && <> · <span className="version-evidence">{track.versionDisplay}</span></>}</small></div></div></td>
    <td>{track.album ?? '未标注专辑'}</td><td>{track.durationSeconds === null ? '未知' : `${Math.floor(track.durationSeconds / 60)}:${String(Math.floor(track.durationSeconds % 60)).padStart(2, '0')}`}</td>
    <td><div className="track-actions"><button type="button" aria-label={`播放 ${track.title}`} onClick={() => onPlay?.(track)}>▶</button><button type="button" disabled={busy} className={snapshot.favorites.includes(track.id) ? 'favorite active' : 'favorite'} aria-label={`${snapshot.favorites.includes(track.id) ? '取消收藏' : '收藏'} ${track.title}`} onClick={() => run(() => window.musicApp.library.setFavorite(track.id, !snapshot.favorites.includes(track.id)))}>♥</button>
      {playlist ? <><button type="button" aria-label={`上移 ${track.title}`} disabled={busy || index === 0} onClick={() => move(track.id, -1)}>↑</button><button type="button" aria-label={`下移 ${track.title}`} disabled={busy || index === tracks.length - 1} onClick={() => move(track.id, 1)}>↓</button><button disabled={busy} type="button" aria-label={`从歌单移除 ${track.title}`} onClick={() => run(() => window.musicApp.library.updatePlaylist(playlist.id, playlist.trackIds.filter((id) => id !== track.id)))}>移除</button></> : <><select disabled={busy} aria-label={`添加 ${track.title} 到歌单`} value="" onChange={(event) => { const selected = snapshot.playlists.find((value) => value.id === event.target.value); if (selected) run(() => window.musicApp.library.updatePlaylist(selected.id, [...selected.trackIds, track.id])) }}><option value="">加入歌单</option>{snapshot.playlists.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</select><button disabled={busy} type="button" aria-label={`移除 ${track.title}`} onClick={() => run(() => window.musicApp.library.removeTrack(track.id))}>移除</button></>}
    </div></td></tr>)}</tbody></table>{!tracks.length && <p className="view-empty">这里还没有歌曲</p>}</div>
}
