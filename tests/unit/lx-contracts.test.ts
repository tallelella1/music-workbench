import { expect, test } from 'vitest'
import { lxMusicInfo } from '../../src/main/extensions/lx-host'
import { LXNetworkSchema, LXMusicRequestSchema } from '../../src/shared/extensions'
test('LX musicInfo preserves real wy/kg/tx ids and only known kg quality hashes', () => {
  const wy = lxMusicInfo({ providerId: 'wy', songId: '123', identity: { originalTitle: 'Song', singer: 'Artist', albumId: 9 } })
  expect(wy).toMatchObject({ songmid: 123, name: 'Song', singer: 'Artist', albumId: 9, types: [], _types: {} })
  const kg = lxMusicInfo({ providerId: 'kg', songId: '456', identity: { FileHash: 'main-hash', HQFileHash: 'high-hash', MixSongID: 7, AlbumID: 8 } })
  expect(kg).toMatchObject({ songmid: 456, hash: 'main-hash', albumAudioId: 7, albumId: 8, types: [{ type: '128k' }, { type: '320k' }], _types: { '128k': { hash: 'main-hash' }, '320k': { hash: 'high-hash' } } })
  const tx = lxMusicInfo({ providerId: 'tx', songId: 'mid', identity: { id: 789, media_mid: 'media-mid', albumMid: 'album-mid' } })
  expect(tx).toMatchObject({ songmid: 'mid', songId: 789, strMediaMid: 'media-mid', albumMid: 'album-mid', types: [], _types: {} })
  expect(lxMusicInfo({ providerId: 'tx', songId: 'mid', identity: {} })).not.toHaveProperty('songId')
})
test('LX boundary rejects object musicUrl results and unsupported filesystem or network forms', () => {
  const requestId = crypto.randomUUID()
  expect(LXNetworkSchema.safeParse({ requestId, url: 'file:///secret', options: {} }).success).toBe(false)
  expect(LXNetworkSchema.safeParse({ requestId, url: 'https://example.com', options: { formData: { path: 'secret' } } }).success).toBe(false)
  expect(LXMusicRequestSchema.safeParse({ requestId, source: 'local', action: 'musicUrl', info: { type: '128k', musicInfo: {} } }).success).toBe(false)
})
