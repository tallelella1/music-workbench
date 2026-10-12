import { LibraryView, type LibraryViewProps } from './LibraryView'
export function PlaylistView(props: LibraryViewProps & { playlistId: string; onDelete(): void }) {
  return <section aria-label="歌单歌曲"><div className="playlist-tools"><span>用箭头调整歌曲顺序</span><button type="button" disabled={props.busy} onClick={props.onDelete}>删除歌单</button></div><LibraryView {...props} /></section>
}
