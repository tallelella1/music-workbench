import type { StorageRepository } from '../storage/repository'
import type { AssetRegistry } from '../assets/asset-registry'
import { basename, extname, join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { parseFile } from 'music-metadata'
import type { AppError, RequestContext, Track } from '../../shared/contracts'
import { emptyLibrary, LibrarySnapshotSchema, PlaylistSchema, type LibrarySnapshot, type Playlist } from '../../shared/library'
import { inferTrackVersion } from '../../shared/track-version'
const extensions = new Set(['.wav', '.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.aiff', '.aif', '.wma'])
export class LibraryService {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly repository: StorageRepository, private readonly assets: AssetRegistry) {}
  private mutate<T>(operation: (snapshot: LibrarySnapshot) => Promise<T> | T): Promise<T> {
    const work = this.queue.catch(() => {}).then(async () => {
      const snapshot = await this.repository.read('library', LibrarySnapshotSchema, emptyLibrary)
      const result = await operation(snapshot)
      await this.repository.write('library', snapshot, LibrarySnapshotSchema)
      return structuredClone(result)
    })
    this.queue = work
    return work
  }
  async list(): Promise<LibrarySnapshot> { await this.queue.catch(() => {}); return this.repository.read('library', LibrarySnapshotSchema, emptyLibrary) }
  importPaths(paths: string[], ctx: RequestContext): Promise<{ tracks: Track[]; errors: AppError[] }> {
    return this.mutate(async (snapshot) => {
      const tracks: Track[] = []; const errors: AppError[] = []
      const errorFor = (path: string) => errors.push({ code: 'IMPORT_FAILED', message: `${basename(path)}：无法导入，请检查文件是否可读且音频完整`, moduleId: 'library', requestId: ctx.requestId })
      const visit = async (path: string): Promise<void> => {
        ctx.signal.throwIfAborted()
        try {
          const info = await stat(path)
          if (info.isDirectory()) {
            for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
              if (entry.isDirectory() || (entry.isFile() && extensions.has(extname(entry.name).toLowerCase()))) await visit(join(path, entry.name))
            }
            return
          }
          const asset = await this.assets.importFile(path, 'audio', ctx)
          const existing = snapshot.tracks.find((track) => track.audioAssetId === asset.id)
          if (existing) { if (!tracks.some((track) => track.id === existing.id)) tracks.push(existing); return }
          const metadata = await parseFile(path, { duration: true })
          const common = metadata.common
          const title = common.title?.trim() ? common.title : basename(path, extname(path))
          const { version, versionDisplay } = inferTrackVersion(title, common.comment?.map((comment) => comment.text ?? '') ?? [])
          const picture = common.picture?.[0]
          const artwork = picture ? await this.assets.importArtwork(picture.data, asset.id, ctx) : null
          const track: Track = { id: randomUUID(), title, artists: common.artists?.filter(Boolean) ?? (common.artist ? [common.artist] : []), album: common.album ?? null, version, versionDisplay, durationSeconds: asset.media.durationSeconds, artworkAssetId: artwork?.id ?? null, audioAssetId: asset.id, sources: [] }
          snapshot.tracks.push(track); tracks.push(track)
        } catch (error) { if (ctx.signal.aborted) throw error; errorFor(path) }
      }
      for (const path of paths) await visit(path)
      return { tracks, errors }
    })
  }
  setFavorite(trackId: string, favorite: boolean): Promise<void> {
    return this.mutate((snapshot) => {
      if (!snapshot.tracks.some((track) => track.id === trackId)) throw new Error('找不到歌曲')
      snapshot.favorites = snapshot.favorites.filter((id) => id !== trackId)
      if (favorite) snapshot.favorites.push(trackId)
    })
  }
  createPlaylist(name: string): Promise<Playlist> {
    return this.mutate((snapshot) => { const playlist = PlaylistSchema.parse({ id: randomUUID(), name, trackIds: [] }); snapshot.playlists.push(playlist); return playlist })
  }
  updatePlaylist(id: string, trackIds: string[]): Promise<void> {
    return this.mutate((snapshot) => {
      const playlist = snapshot.playlists.find((value) => value.id === id)
      if (!playlist) throw new Error('找不到歌单')
      if (trackIds.some((trackId) => !snapshot.tracks.some((track) => track.id === trackId))) throw new Error('歌单包含不存在的歌曲')
      playlist.trackIds = [...new Set(trackIds)]
    })
  }
  deletePlaylist(id: string): Promise<void> { return this.mutate((snapshot) => { snapshot.playlists = snapshot.playlists.filter((playlist) => playlist.id !== id) }) }
  removeTrack(id: string): Promise<void> {
    return this.mutate((snapshot) => {
      snapshot.tracks = snapshot.tracks.filter((track) => track.id !== id)
      snapshot.favorites = snapshot.favorites.filter((trackId) => trackId !== id)
      for (const playlist of snapshot.playlists) playlist.trackIds = playlist.trackIds.filter((trackId) => trackId !== id)
    })
  }
}
