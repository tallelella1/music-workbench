import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Track } from '../../src/shared/contracts'

export function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-1', title: '测试歌曲', artists: ['测试歌手'], album: null,
    version: 'studio', versionDisplay: null, durationSeconds: 120, artworkAssetId: null,
    audioAssetId: null, sources: [], ...overrides
  }
}

export async function makeAudioFile(options: {
  directory: string; name: string; durationSeconds: number; toneHz: number
}): Promise<string> {
  const sampleRate = 44_100
  const sampleCount = Math.round(options.durationSeconds * sampleRate)
  if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0 ||
      !Number.isFinite(options.toneHz) || options.toneHz <= 0 || options.toneHz >= sampleRate / 2) {
    throw new RangeError('Invalid audio fixture parameters')
  }
  const data = Buffer.alloc(44 + sampleCount * 2)
  data.write('RIFF', 0)
  data.writeUInt32LE(data.length - 8, 4)
  data.write('WAVEfmt ', 8)
  data.writeUInt32LE(16, 16)
  data.writeUInt16LE(1, 20)
  data.writeUInt16LE(1, 22)
  data.writeUInt32LE(sampleRate, 24)
  data.writeUInt32LE(sampleRate * 2, 28)
  data.writeUInt16LE(2, 32)
  data.writeUInt16LE(16, 34)
  data.write('data', 36)
  data.writeUInt32LE(sampleCount * 2, 40)
  for (let i = 0; i < sampleCount; i++) {
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * options.toneHz * i / sampleRate) * 8000), 44 + i * 2)
  }
  await mkdir(options.directory, { recursive: true })
  const path = join(options.directory, options.name)
  await writeFile(path, data)
  return path
}
