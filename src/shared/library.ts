import { z } from 'zod'
import { PlaylistSchema, LibrarySnapshotSchema } from './schemas'
export { PlaylistSchema, LibrarySnapshotSchema, ImportResultSchema } from './schemas'
export type Playlist = z.infer<typeof PlaylistSchema>
export type LibrarySnapshot = z.infer<typeof LibrarySnapshotSchema>
export const emptyLibrary: LibrarySnapshot = { schemaVersion: 1, tracks: [], favorites: [], playlists: [] }
