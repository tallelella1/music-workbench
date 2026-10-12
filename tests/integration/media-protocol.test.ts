import { expect, test } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AssetRegistry } from '../../src/main/assets/asset-registry'
import { StorageRepository } from '../../src/main/storage/repository'
import { makeAudioFile } from '../helpers/fixtures'

test('opaque media handles support suffix Range, expiry and reject changed originals', async () => {
  const module = await import('../../src/main/assets/media-protocol').catch(() => null)
  expect(module, 'MediaResourceRegistry must exist').not.toBeNull()
  const directory = await mkdtemp(join(tmpdir(), 'media-handles-'))
  try {
    const assets = new AssetRegistry(new StorageRepository(directory), join(directory, 'artwork'))
    const path = await makeAudioFile({ directory, name: '末尾🎵.wav', durationSeconds: 0.2, toneHz: 440 })
    const asset = await assets.importFile(path, 'audio', { requestId: 'import', signal: new AbortController().signal })
    let now = 1000
    const media = new module!.MediaResourceRegistry(assets, () => now, 100)
    const resource = await media.issueLocal(asset.id)
    expect(resource.url).toMatch(/^media:\/\/local\/[a-f0-9-]+$/)
    const response = await media.handle(new Request(resource.url, { headers: { Range: 'bytes=-500' } }), 'null')
    expect(response.status).toBe(206); expect((await response.arrayBuffer()).byteLength).toBe(500)
    now = 1100
    expect((await media.handle(new Request(resource.url), 'null')).status).toBe(410)
    await writeFile(path, 'changed')
    await expect(media.issueLocal(asset.id)).rejects.toThrow(/重新导入/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
