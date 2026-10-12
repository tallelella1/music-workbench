import type { RequestContext } from '../../shared/contracts'
import type { SearchQuery, SearchOptions, SearchPage, SearchResult, SearchSnapshot, ProviderStatus } from '../../shared/providers'
import { SearchQuerySchema } from '../../shared/providers'
import { SearchPageSchema, SearchResultSchema, SearchSnapshotSchema } from '../../shared/schemas'
import { ProviderFailure, waitForSearchCleanup } from '../providers/search-common'
import type { ProviderRegistry } from '../providers/registry'
export class SearchService {
  private readonly cache = new Map<string, { page: SearchPage; expires: number }>()
  private readonly health = new Map<string, { failures: number; pausedUntil: number }>()
  private authRevision: string | null = null
  constructor(private readonly registry: ProviderRegistry, private readonly emit: (state: SearchSnapshot) => void = () => {}) {}
  providerIds(): string[] { return this.registry.searches().map((provider) => provider.id) }
  async search(input: SearchQuery, ctx: RequestContext, options: SearchOptions = {}): Promise<SearchResult> {
    const query = SearchQuerySchema.parse(input)
    ctx.signal.throwIfAborted()
    if (query.authRevision !== this.authRevision) { this.cache.clear(); this.authRevision = query.authRevision }
    const providers = this.registry.searches().filter((provider) => !options.providerIds || options.providerIds.includes(provider.id))
    if (options.providerIds?.some((id) => !this.providerIds().includes(id))) throw new Error('搜索来源未注册')
    const snapshot: SearchSnapshot = { requestId: ctx.requestId, tracks: [], providers: providers.map((provider) => ({ providerId: provider.id, status: 'loading', error: null, tracks: [], page: query.page, total: null, nextPage: null })) }
    const publish = () => { ctx.signal.throwIfAborted(); snapshot.tracks = snapshot.providers.flatMap((source) => source.tracks); this.emit(SearchSnapshotSchema.parse(structuredClone(snapshot))) }
    publish()
    const outcomes = await Promise.allSettled(providers.map(async (provider, index) => {
      const state = snapshot.providers[index]
      const key = JSON.stringify([provider.id, query.text, query.page, query.pageSize, query.authRevision])
      const health = this.health.get(provider.id) ?? { failures: 0, pausedUntil: 0 }
      if (!options.manualRetry && health.pausedUntil > Date.now()) {
        state.status = 'error'; state.error = { code: 'SOURCE_PAUSED', message: '连续请求失败，自动请求暂缓 60 秒；可手动重试', moduleId: provider.id, requestId: ctx.requestId }; publish(); return
      }
      const abort = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      let rejectStopped!: (reason: unknown) => void
      const stopped = new Promise<never>((_resolve, reject) => { rejectStopped = reject })
      const cancel = () => { abort.abort(); rejectStopped(new DOMException('搜索已取消', 'AbortError')) }
      ctx.signal.addEventListener('abort', cancel, { once: true })
      try {
        const cached = !options.manualRetry ? this.cache.get(key) : undefined
        let page: SearchPage
        if (cached && cached.expires > Date.now()) page = structuredClone(cached.page)
        else {
          timer = setTimeout(() => { abort.abort(); rejectStopped(new ProviderFailure('timeout', '来源在 8 秒内未响应')) }, 8000)
          page = SearchPageSchema.parse(await Promise.race([Promise.resolve().then(() => { abort.signal.throwIfAborted(); return provider.search(query, { requestId: ctx.requestId, signal: abort.signal }) }), stopped]))
          ctx.signal.throwIfAborted()
          // Account changes invalidate completed and in-flight older cache entries.
          if (query.authRevision === this.authRevision) {
            this.cache.set(key, { page: structuredClone(page), expires: Date.now() + 300000 })
            if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!)
          }
        }
        ctx.signal.throwIfAborted()
        state.tracks = page.tracks; state.total = page.total; state.nextPage = page.nextPage
        state.status = page.tracks.length ? 'ok' : 'empty'
        this.health.set(provider.id, { failures: 0, pausedUntil: 0 })
      } catch (error) {
        ctx.signal.throwIfAborted()
        const status: ProviderStatus = error instanceof ProviderFailure ? error.status : 'error'
        state.status = status
        state.error = { code: `SEARCH_${status.toUpperCase().replace('-', '_')}`, message: error instanceof ProviderFailure ? error.message : '来源搜索失败，请重试', moduleId: provider.id, requestId: ctx.requestId }
        const currentHealth = this.health.get(provider.id) ?? { failures: 0, pausedUntil: 0 }
        currentHealth.failures++; currentHealth.pausedUntil = currentHealth.failures >= 3 ? Date.now() + 60000 : 0
        this.health.set(provider.id, currentHealth)
      } finally {
        if (timer) clearTimeout(timer)
        ctx.signal.removeEventListener('abort', cancel)
        await waitForSearchCleanup(abort.signal)
      }
      publish()
    }))
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason
    ctx.signal.throwIfAborted()
    return SearchResultSchema.parse({ requestId: ctx.requestId, tracks: snapshot.tracks, providers: snapshot.providers.map(({ providerId, status, error }) => ({ providerId, status, error })) })
  }
}
