import type { StorageRepository } from '../storage/repository'
import { AppSettingsSchema, SettingsPatchSchema, defaultSettings, type AppSettings } from '../../shared/settings'
import { StoredSettingsSchema, emptyStoredSettings } from './stored-settings'
export class SettingsService {
  constructor(private readonly repository: StorageRepository) {}
  async read(): Promise<AppSettings> { return (await this.repository.read('settings', StoredSettingsSchema, emptyStoredSettings())).preferences ?? defaultSettings() }
  async update(patch: Partial<AppSettings>): Promise<AppSettings> {
    const validated = SettingsPatchSchema.parse(patch)
    const stored = await this.repository.update('settings', StoredSettingsSchema, emptyStoredSettings(), current => ({ ...current, preferences: AppSettingsSchema.parse({ ...(current.preferences ?? defaultSettings()), ...validated }) }))
    return stored.preferences!
  }
  async setSourceEnabled(id: string, enabled: boolean): Promise<AppSettings> {
    const stored = await this.repository.update('settings', StoredSettingsSchema, emptyStoredSettings(), current => {
      const preferences = current.preferences ?? defaultSettings()
      return { ...current, preferences: AppSettingsSchema.parse({ ...preferences, enabledSources: enabled ? [...new Set([...preferences.enabledSources, id])] : preferences.enabledSources.filter(sourceId => sourceId !== id) }) }
    })
    return stored.preferences!
  }
  async rememberImportedSource(id: string, replacedIds: string[]): Promise<void> {
    await this.repository.update('settings', StoredSettingsSchema, emptyStoredSettings(), current => {
      const preferences = current.preferences ?? defaultSettings()
      return { ...current, preferences: AppSettingsSchema.parse({ ...preferences, enabledSources: [...new Set([...preferences.enabledSources.filter(sourceId => !replacedIds.includes(sourceId)), id])], sourceOrder: [...new Set([...preferences.sourceOrder, id])] }) }
    })
  }
}
