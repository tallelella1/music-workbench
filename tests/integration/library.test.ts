import { afterEach, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, copyFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AssetRegistry } from '../../src/main/assets/asset-registry'
import { LibraryService } from '../../src/main/library/library-service'
import { StorageRepository } from '../../src/main/storage/repository'
import { runtimeBinary } from '../../src/main/assets/media-probe'
import { makeAudioFile } from '../helpers/fixtures'
import { makeTrack } from '../helpers/fixtures'

const directories: string[] = []
const ctx = { requestId: 'import-test', signal: new AbortController().signal }
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'music-library-')); directories.push(directory)
  const data = join(directory, 'data'); const repository = new StorageRepository(data)
  const assets = new AssetRegistry(repository, join(data, 'artwork'))
  return { directory, data, assets, library: new LibraryService(repository, assets) }
}
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

test('same contents retain identity and removal preserves the original bytes', async () => {
  const { directory, library, assets } = await setup()
  const path = await makeAudioFile({ directory, name: '中文 音乐🎵.wav', durationSeconds: 0.2, toneHz: 440 })
  const bytes = await readFile(path)
  const copy = join(directory, '复制.wav'); await copyFile(path, copy)
  const first = await library.importPaths([path], ctx); const repeat = await library.importPaths([copy], ctx)
  expect(first.errors).toEqual([]); expect(repeat.tracks[0].id).toBe(first.tracks[0].id)
  expect((await library.list()).tracks).toHaveLength(1)
  expect(await assets.get(first.tracks[0].audioAssetId!)).toMatchObject({ media: { durationReliable: true, sampleRate: 44100, codec: 'pcm_s16le' } })
  await library.removeTrack(first.tracks[0].id)
  expect(await readFile(path)).toEqual(bytes); expect(await readFile(copy)).toEqual(bytes)
})
test('folder import preserves same-title versions, metadata, artwork and per-file failures', async () => {
  const { directory, library } = await setup()
  const source = await makeAudioFile({ directory, name: 'source.wav', durationSeconds: 0.3, toneHz: 330 })
  const folder = join(directory, '专辑 空格🎵'); await mkdir(folder)
  for (const [name, comment] of [['一', 'Studio'], ['二', 'Live']]) {
    await promisify(execFile)(runtimeBinary('ffmpeg'), ['-v', 'error', '-y', '-i', source, '-metadata', 'title=同名', '-metadata', `comment=${comment}`, '-metadata', 'artist=歌手', '-metadata', 'album=真实专辑', join(folder, `${name}.flac`)])
  }
  await writeFile(join(folder, '损坏.mp3'), 'invalid audio')
  const result = await library.importPaths([folder], ctx)
  expect(result.tracks).toHaveLength(2); expect(new Set(result.tracks.map((track) => track.id)).size).toBe(2)
  expect(result.tracks.map((track) => track.title)).toEqual(['同名', '同名'])
  expect(result.tracks.map((track) => track.version).sort()).toEqual(['live', 'studio'])
  expect(result.tracks[0]).toMatchObject({ artists: ['歌手'], album: '真实专辑' })
  expect(result.errors).toHaveLength(1); expect(result.errors[0].message).toContain('损坏.mp3')
  expect(result.errors[0].message).not.toContain(directory)
})
test('concurrent favorites and playlist mutations survive restart with ordered tracks', async () => {
  const { directory, data, library } = await setup()
  const paths = await Promise.all([440, 880].map((toneHz, index) => makeAudioFile({ directory, name: `${index}.wav`, durationSeconds: 0.2, toneHz })))
  const { tracks } = await library.importPaths(paths, ctx)
  const playlist = await library.createPlaylist('我的歌单')
  await Promise.all([library.setFavorite(tracks[0].id, true), library.setFavorite(tracks[1].id, true), library.updatePlaylist(playlist.id, [tracks[1].id, tracks[0].id])])
  const repository = new StorageRepository(data)
  const restarted = new LibraryService(repository, new AssetRegistry(repository, join(data, 'artwork')))
  expect(await restarted.list()).toMatchObject({ favorites: tracks.map((track) => track.id), playlists: [{ ...playlist, trackIds: [tracks[1].id, tracks[0].id] }] })
  await restarted.removeTrack(tracks[0].id)
  expect(await restarted.list()).toMatchObject({ favorites: [tracks[1].id], playlists: [{ ...playlist, trackIds: [tracks[1].id] }] })
  await restarted.deletePlaylist(playlist.id); expect((await restarted.list()).playlists).toEqual([])
})
test('actual MP3, FLAC and M4A decode and probe without modifying sources', async () => {
  const { directory, library } = await setup()
  const wav = await makeAudioFile({ directory, name: 'sample.wav', durationSeconds: 0.4, toneHz: 440 })
  const paths = [wav]
  for (const extension of ['mp3', 'flac', 'm4a']) {
    const path = join(directory, `音乐 空格🎵.${extension}`)
    await promisify(execFile)(runtimeBinary('ffmpeg'), ['-v', 'error', '-y', '-i', wav, '-metadata', 'title=实际样本', path])
    paths.push(path)
  }
  const bytes = await Promise.all(paths.map((path) => readFile(path)))
  const result = await library.importPaths(paths, ctx)
  expect(result.errors).toEqual([]); expect(result.tracks).toHaveLength(4)
  expect(result.tracks.every((track) => track.durationSeconds! > 0)).toBe(true)
  expect(await Promise.all(paths.map((path) => readFile(path)))).toEqual(bytes)
}, 30000)

test('Windows long paths and real embedded artwork retain readable opaque assets', async () => {
  const { directory, library, assets } = await setup()
  const deep = join(directory, ...Array.from({ length: 7 }, (_, index) => `目录 ${index} ${'长'.repeat(30)}`))
  const wav = await makeAudioFile({ directory: deep, name: '长路径 🎵.wav', durationSeconds: 0.2, toneHz: 440 })
  expect(wav.length).toBeGreaterThan(260)
  const cover = join(directory, 'cover.png')
  await promisify(execFile)(runtimeBinary('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=pink:s=32x32', '-frames:v', '1', cover])
  const mp3 = join(directory, '真实封面.mp3')
  await promisify(execFile)(runtimeBinary('ffmpeg'), ['-v', 'error', '-y', '-i', wav, '-i', cover, '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'copy', '-id3v2_version', '3', '-metadata', 'album=带封面专辑', mp3])
  const result = await library.importPaths([wav, mp3], ctx)
  expect(result.errors).toEqual([])
  expect(result.tracks).toHaveLength(2)
  const imageId = result.tracks[1].artworkAssetId!
  expect(imageId).toBeTruthy()
  expect(await assets.get(imageId)).toMatchObject({ kind: 'image', parentAssetId: result.tracks[1].audioAssetId, media: { width: 32, height: 32 } })
  expect(await assets.readBytes(imageId)).toEqual(await readFile(cover))
}, 30000)

test('opaque read streams work immediately after registry restart', async () => {
  const { directory, data, library } = await setup()
  const path = await makeAudioFile({ directory, name: '重启读取.wav', durationSeconds: 0.1, toneHz: 440 })
  const { tracks } = await library.importPaths([path], ctx)
  const restarted = new AssetRegistry(new StorageRepository(data), join(data, 'artwork'))
  const chunks: Buffer[] = []
  for await (const chunk of restarted.openRead(tracks[0].audioAssetId!)) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks)).toEqual(await readFile(path))
  const range: Buffer[] = []
  for await (const chunk of restarted.openRead(tracks[0].audioAssetId!, { start: 0, end: 43 })) range.push(Buffer.from(chunk))
  expect(Buffer.concat(range)).toEqual((await readFile(path)).subarray(0, 44))
})

test('unlabeled real WAV is unknown and real explicit tag evidence survives restart unchanged', async () => {
  const { directory, data, library } = await setup()
  const wav = await makeAudioFile({ directory, name: 'Oliver.wav', durationSeconds: 0.2, toneHz: 440 })
  const raw = 'Ｌｉｖｅ at 上海 2026 🎵'
  const tagged = join(directory, '有明确标签.flac')
  await promisify(execFile)(runtimeBinary('ffmpeg'), ['-v', 'error', '-y', '-i', wav, '-metadata', 'title=Live Forever', '-metadata', `comment=${raw}`, tagged])
  const result = await library.importPaths([wav, tagged], ctx)
  expect(result.errors).toEqual([])
  expect(result.tracks[0]).toMatchObject({ title: 'Oliver', version: 'unknown', versionDisplay: null })
  expect(result.tracks[1]).toMatchObject({ title: 'Live Forever', version: 'live', versionDisplay: raw })
  const repository = new StorageRepository(data)
  const reopened = new LibraryService(repository, new AssetRegistry(repository, join(data, 'artwork')))
  expect((await reopened.list()).tracks[1]).toMatchObject({ title: 'Live Forever', version: 'live', versionDisplay: raw })
})

test('reading schemaVersion 1 legacy tracks adds null display only in memory and keeps raw file bytes', async () => {
  const { data, library } = await setup()
  await mkdir(data, { recursive: true })
  const legacy = makeTrack({ title: 'Oliver', version: 'live' }); Reflect.deleteProperty(legacy, 'versionDisplay')
  const path = join(data, 'library.json')
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, tracks: [legacy], favorites: [], playlists: [] }, null, 4))
  await writeFile(path, bytes)
  expect((await library.list()).tracks[0]).toMatchObject({ title: 'Oliver', version: 'live', versionDisplay: null })
  expect(await readFile(path)).toEqual(bytes)
})
