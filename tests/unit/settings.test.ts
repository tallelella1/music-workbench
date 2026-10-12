import { afterEach, expect, test } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { StorageRepository } from '../../src/main/storage/repository'
import { SettingsService } from '../../src/main/settings/settings-service'
import { StoredSettingsSchema, emptyStoredSettings } from '../../src/main/settings/stored-settings'
import { AppModuleRegistry, builtInModules } from '../../src/shared/app-modules'
import { ProviderRegistry } from '../../src/main/providers/registry'
import { AssetRegistry } from '../../src/main/assets/asset-registry'
import { makeAudioFile } from '../helpers/fixtures'
const directories: string[] = []
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }) })
async function setup() { const directory = await mkdtemp(join(tmpdir(), 'settings-')); directories.push(directory); const repository = new StorageRepository(directory); return { directory, repository, settings: new SettingsService(repository) } }
test('settings survive restart and concurrent asset transactions without stale replacement', async () => {
  const { repository, settings } = await setup()
  await Promise.all([settings.update({ volume: .3 }), repository.update('settings', StoredSettingsSchema, emptyStoredSettings(), current => ({ ...current, assets: [] })), settings.update({ rate: 1.5 })])
  const restarted = new SettingsService(repository)
  expect(await restarted.read()).toMatchObject({ volume: .3, rate: 1.5, schemaVersion: 1 })
  await settings.update({ preservePitch: false }); expect((await restarted.read()).volume).toBe(.3)
})
test('concurrent actual imports retain preferences and complete asset index', async () => {
  const { directory, repository, settings } = await setup(); const assets = new AssetRegistry(repository, join(directory, 'artwork'))
  const first = await makeAudioFile({ directory, name: 'first.wav', durationSeconds: 1, toneHz: 440 }); const second = await makeAudioFile({ directory, name: 'second.wav', durationSeconds: 1, toneHz: 880 })
  const ctx = { requestId: 'settings-import', signal: new AbortController().signal }
  const [record] = await Promise.all([assets.importFile(first, 'audio', ctx), settings.update({ volume: .21 }), assets.importFile(second, 'audio', ctx), settings.update({ rate: 1.4 })])
  const stored = await repository.read('settings', StoredSettingsSchema, emptyStoredSettings()); expect(stored.assets).toHaveLength(2); expect(stored.preferences).toMatchObject({ volume: .21, rate: 1.4 }); expect((await assets.get(record.id)).id).toBe(record.id)
})
test('legacy effect parameters migrate and do not replace valid preferences', async () => {
  const { directory, settings } = await setup()
  await writeFile(join(directory, 'settings.json'), JSON.stringify({ schemaVersion: 1, assets: [], preferences: { schemaVersion: 0, volume: .4, rate: 1.2, preservePitch: false, effects: [{ effectId: 'eq-10', paramVersion: 0, enabled: true, params: { gains: Array(10).fill(2), preamp: -2 } }, { effectId: 'reverb', paramVersion: 0, enabled: true, params: { wetPercent: 25, decay: 2 } }] } }))
  const value = await settings.read(); expect(value.volume).toBe(.4); expect(value.effects[0].params).toEqual({ gainsDb: Array(10).fill(2), preampDb: -2 }); expect(value.effects[1].params).toEqual({ wet: .25, decaySeconds: 2, seed: 1 })
  await settings.update({ rate: 1.3 }); expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8')).preferences.schemaVersion).toBe(1)
})
test.each(['{broken', JSON.stringify({ schemaVersion: 2, assets: [] }), JSON.stringify({ schemaVersion: 1, assets: [], preferences: { schemaVersion: 2 } })])('corrupt or newer settings are preserved: %s', async content => {
  const { directory, settings } = await setup(); await writeFile(join(directory, 'settings.json'), content)
  await expect(settings.read()).rejects.toThrow('保留原文件'); await expect(settings.update({ volume: .1 })).rejects.toThrow(); expect(await readFile(join(directory, 'settings.json'), 'utf8')).toBe(content)
})
test('invalid patch is rejected and does not change settings', async () => { const { settings } = await setup(); await settings.update({ volume: .6 }); await expect(settings.update({ rate: 9 })).rejects.toThrow(); expect((await settings.read()).volume).toBe(.6) })
test('invalid effect layout cannot crash the fixed base effects panel after restart', async () => { const { settings } = await setup(); await expect(settings.update({ effects: [] })).rejects.toThrow(); expect((await settings.read()).effects).toHaveLength(2) })
test('concurrent source toggles preserve each user preference in the shared transaction', async () => { const { settings } = await setup(); await Promise.all([settings.setSourceEnabled('test-a', true), settings.setSourceEnabled('test-b', true)]); expect((await settings.read()).enabledSources).toEqual(['wy', 'kg', 'tx', 'test-a', 'test-b']) })
test('importing a new source preserves failed requested sources and disables only replaced versions', async () => { const { settings } = await setup(); await settings.update({ enabledSources: ['wy', 'failed-requested', 'replaced'] }); await settings.rememberImportedSource('new-source', ['replaced']); expect((await settings.read()).enabledSources).toEqual(['wy', 'failed-requested', 'new-source']) })
test('modules are gated by capabilities and routes cannot bypass the registry', () => {
  const modules = new AppModuleRegistry(); modules.register({ id: 'test-ai', route: '/test-ai', title: '测试', requiredCapabilities: ['text-planning'] })
  expect(modules.list([])).toEqual([]); expect(modules.list(['text-planning'])).toHaveLength(1); expect(modules.resolve('/test-ai', [])).toBeNull()
  expect(builtInModules().list(['local-library', 'local-audio-editor', 'local-visual-editor']).map(m => m.id)).toContain('audio-editor')
})
test('source contract major mismatch is rejected through registry alone', () => { const registry = new ProviderRegistry(); expect(() => registry.registerPlayback({ id: 'test-only', capabilities: () => ({ contractMajor: 2, platformIds: ['wy'], qualities: ['128k'], fullTrack: true, offlineEditable: false }) as never, resolve: async () => { throw new Error('fixture') } })).toThrow(); expect(registry.playbacks()).toEqual([]) })
test('test-only mock providers need only registry registration and obey persisted ordering/enablement', () => {
  const registry = new ProviderRegistry(); const mock = (id: string) => ({ id, capabilities: () => ({ contractMajor: 1 as const, platformIds: ['wy'], qualities: ['128k'], fullTrack: true, offlineEditable: false }), resolve: async () => { throw new Error('test-only') } })
  registry.registerPlayback(mock('test-a')); registry.registerPlayback(mock('test-b')); registry.configure(['test-b', 'test-a'], ['test-a', 'test-b']); expect(registry.playbacks().map(provider => provider.id)).toEqual(['test-b', 'test-a']); registry.configure([], []); expect(registry.playbacks()).toEqual([])
})
