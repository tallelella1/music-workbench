import { PlaybackCapabilitiesSchema, type PlaybackProvider, type SearchProvider } from '../../shared/providers'
import { createWySearch } from './wy/search'
import { createKgSearch } from './kg/search'
import { createTxSearch } from './tx/search'
export class ProviderRegistry {
  private readonly providers = new Map<string, SearchProvider>()
  private readonly playbackProviders = new Map<string, PlaybackProvider>()
  private preferences: { order: string[]; enabled: string[] } | null = null
  configure(order: string[], enabled: string[]): void { this.preferences = { order: [...order], enabled: [...enabled] } }
  private selected<T extends { id: string }>(providers: T[]): T[] {
    const preferences = this.preferences; if (!preferences) return providers
    const rank = (id: string) => { const index = preferences.order.indexOf(id); return index < 0 ? Number.MAX_SAFE_INTEGER : index }
    return providers.filter(provider => preferences.enabled.includes(provider.id)).sort((a, b) => rank(a.id) - rank(b.id))
  }
  registerPlayback(provider: PlaybackProvider): void {
    PlaybackCapabilitiesSchema.parse(provider.capabilities())
    if (!provider.id || this.playbackProviders.has(provider.id) || this.playbackProviders.size >= 20) throw new Error('无效或重复的播放来源')
    this.playbackProviders.set(provider.id, provider)
  }
  removePlayback(id: string): void { this.playbackProviders.delete(id) }
  playbacks(): PlaybackProvider[] { return this.selected([...this.playbackProviders.values()]) }
  registerSearch(provider: SearchProvider): void {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(provider.id) || this.providers.has(provider.id) || this.providers.size >= 20) throw new Error('无效或重复的搜索来源')
    this.providers.set(provider.id, provider)
  }
  searches(): SearchProvider[] { return this.selected([...this.providers.values()]) }
}
/** kw/mg are reserved identifiers; only implemented sources are requested. */
export function defaultSearchRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()
  for (const provider of [createWySearch(), createKgSearch(), createTxSearch()]) registry.registerSearch(provider)
  return registry
}
