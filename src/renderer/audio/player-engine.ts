import type { Track } from '../../shared/contracts'
import { TrackSchema } from '../../shared/schemas'
import { PlaybackResourceSchema, type PlaybackResource, type PlayerSnapshot } from '../../shared/player'
import { EffectChain } from './effect-chain'

export class PlayerEngine {
  private state: PlayerSnapshot = { trackId: null, status: 'idle', sourceSeconds: 0, durationSeconds: 0, rate: 1, preservePitch: true, volume: 0.75, repeat: 'off', shuffle: false, actualQuality: null, revisionId: null }
  private readonly listeners = new Set<(snapshot: PlayerSnapshot) => void>()
  private readonly endedListeners = new Set<() => void>()
  private ids: string[] = []
  private order: number[] = []
  private cursor = -1
  private media: HTMLAudioElement | null = null
  private audioContext: AudioContext | null = null
  private volumeNode: GainNode | null = null
  private source: MediaElementAudioSourceNode | null = null
  private generation = 0
  private pendingLoad: AbortController | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  effects: EffectChain | null = null
  get element(): HTMLAudioElement | null { return this.media }
  get context(): AudioContext | null { return this.audioContext }
  private emit(): void { const value = this.snapshot(); for (const listener of this.listeners) listener(value) }
  snapshot(): PlayerSnapshot {
    if (this.media && this.state.status !== 'loading') this.state.sourceSeconds = Number.isFinite(this.media.currentTime) ? this.media.currentTime : 0
    return { ...this.state }
  }
  subscribe(listener: (snapshot: PlayerSnapshot) => void): () => void { this.listeners.add(listener); listener(this.snapshot()); return () => this.listeners.delete(listener) }
  onEnded(listener: () => void): () => void { this.endedListeners.add(listener); return () => this.endedListeners.delete(listener) }
  private initialize(): void {
    if (this.audioContext) return
    this.audioContext = new AudioContext()
    this.effects = new EffectChain(this.audioContext)
    this.volumeNode = this.audioContext.createGain(); this.volumeNode.gain.value = this.state.volume
    this.effects.output.connect(this.volumeNode).connect(this.audioContext.destination)
    this.timer = setInterval(() => { if (this.state.status === 'playing') this.emit() }, 100)
  }
  private retireMedia(): void {
    // A new choice owns a new element: queued events cannot identify their old
    // resource when one HTMLMediaElement is reused across loads.
    this.generation++; this.pendingLoad?.abort(); this.pendingLoad = null
    const media = this.media; this.media = null
    this.source?.disconnect(); this.source = null
    if (media) { media.pause(); media.removeAttribute('src'); media.load() }
  }
  private createMedia(): HTMLAudioElement {
    const media = new Audio(); media.crossOrigin = 'anonymous'; media.preload = 'auto'
    const generation = this.generation
    const current = () => this.media === media && this.generation === generation
    this.media = media
    this.source = this.audioContext!.createMediaElementSource(media); this.source.connect(this.effects!.input)
    media.addEventListener('play', () => { if (current() && this.state.status !== 'loading') { this.state.status = 'playing'; this.emit() } })
    media.addEventListener('pause', () => { if (current() && this.state.status === 'playing') { this.state.status = 'paused'; this.emit() } })
    media.addEventListener('timeupdate', () => { if (current()) this.emit() })
    media.addEventListener('seeked', () => { if (current()) this.emit() })
    media.addEventListener('ended', () => { if (current()) { this.state.status = 'paused'; this.emit(); for (const listener of this.endedListeners) listener() } })
    media.addEventListener('error', () => { if (current()) { this.state.status = 'error'; this.emit() } })
    this.setRate(this.state.rate, this.state.preservePitch)
    return media
  }
  prepareLoad(trackId: string, requestId: string): void {
    this.retireMedia()
    this.state = { ...this.state, trackId, revisionId: requestId, status: 'loading', sourceSeconds: 0, durationSeconds: 0, actualQuality: null }
    this.emit()
  }
  clear(): void {
    this.retireMedia()
    this.state = { ...this.state, trackId: null, revisionId: null, status: 'idle', sourceSeconds: 0, durationSeconds: 0, actualQuality: null }
    this.emit()
  }
  fail(requestId: string): void { if (this.state.revisionId === requestId) { this.state.status = 'error'; this.emit() } }
  async load(resource: PlaybackResource, track: Track, requestId: string): Promise<void> {
    const checked = PlaybackResourceSchema.parse(resource); TrackSchema.parse(track)
    if (checked.expiresAt !== null && checked.expiresAt <= Date.now()) throw new Error('播放资源已过期，请重新选择歌曲')
    this.prepareLoad(track.id, requestId); this.initialize()
    const generation = this.generation; const media = this.createMedia(); const abort = new AbortController(); this.pendingLoad = abort
    this.state.actualQuality = checked.actualQuality
    try {
      await new Promise<void>((done, reject) => {
        const cleanup = () => { media.removeEventListener('loadedmetadata', ready); media.removeEventListener('error', failed); abort.signal.removeEventListener('abort', cancelled) }
        const ready = () => { if (generation === this.generation) { cleanup(); done() } }
        const failed = () => { if (generation === this.generation) { cleanup(); reject(new Error('音频无法播放，请检查原文件或重新导入')) } }
        const cancelled = () => { cleanup(); reject(new DOMException('旧播放已取消', 'AbortError')) }
        media.addEventListener('loadedmetadata', ready); media.addEventListener('error', failed); abort.signal.addEventListener('abort', cancelled, { once: true })
        media.src = checked.url; media.load()
      })
      if (generation !== this.generation) return
      this.state.durationSeconds = Number.isFinite(media.duration) ? media.duration : checked.probe.durationSeconds ?? 0
      this.state.status = 'paused'; this.setRate(this.state.rate, this.state.preservePitch); this.emit()
    } catch (error) { if (generation === this.generation) this.fail(requestId); throw error }
    finally { if (this.pendingLoad === abort) this.pendingLoad = null }
  }
  async play(): Promise<void> {
    if (!this.media || this.state.status === 'loading' || this.state.status === 'error') return
    const generation = this.generation
    await this.audioContext!.resume()
    if (generation !== this.generation) return
    await this.media.play()
  }
  pause(): void { this.media?.pause() }
  seek(sourceSeconds: number): void {
    if (!Number.isFinite(sourceSeconds) || sourceSeconds < 0 || sourceSeconds > this.state.durationSeconds) throw new RangeError('定位超出歌曲时长')
    if (this.media) this.media.currentTime = sourceSeconds
    this.state.sourceSeconds = sourceSeconds; this.emit()
  }
  setRate(rate: number, preservePitch: boolean): void {
    if (!Number.isFinite(rate) || rate < 0.5 || rate > 2 || typeof preservePitch !== 'boolean') throw new RangeError('速度应在 0.5–2 倍之间')
    this.state.rate = rate; this.state.preservePitch = preservePitch
    if (this.media) { this.media.playbackRate = rate; this.media.preservesPitch = preservePitch }
    this.emit()
  }
  setVolume(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError('无效的音量')
    this.state.volume = value
    if (this.volumeNode) this.volumeNode.gain.setTargetAtTime(value, this.audioContext!.currentTime, 0.015)
    this.emit()
  }
  setQueue(trackIds: string[], currentIndex: number): void {
    if (!Array.isArray(trackIds) || trackIds.some((id) => typeof id !== 'string' || !id) || !Number.isInteger(currentIndex) || (trackIds.length ? currentIndex < 0 || currentIndex >= trackIds.length : currentIndex !== -1)) throw new RangeError('无效的播放队列')
    this.ids = [...trackIds]; this.order = trackIds.map((_, index) => index); this.cursor = currentIndex
    if (this.state.shuffle) this.shuffleOrder(currentIndex)
    this.emit()
  }
  reconcileQueue(libraryIds: string[]): string[] {
    const available = new Set(libraryIds)
    const retained = this.ids.map((id, index) => ({ id, index })).filter(({ id }) => available.has(id))
    const indices = new Map(retained.map(({ index }, next) => [index, next]))
    const current = this.order[this.cursor]
    const previousCount = this.order.slice(0, Math.max(0, this.cursor)).filter((index) => indices.has(index)).length
    this.order = this.order.filter((index) => indices.has(index)).map((index) => indices.get(index)!)
    this.cursor = indices.has(current) ? this.order.indexOf(indices.get(current)!) : previousCount - 1
    this.ids = retained.map(({ id }) => id)
    return [...this.ids]
  }
  private shuffleOrder(current: number): void {
    const remaining = this.ids.map((_, index) => index).filter((index) => index !== current)
    for (let i = remaining.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [remaining[i], remaining[j]] = [remaining[j], remaining[i]] }
    this.order = current >= 0 ? [current, ...remaining] : remaining; this.cursor = current >= 0 ? 0 : -1
  }
  private advance(direction: number): string | null {
    if (!this.ids.length) return null
    if (this.state.repeat === 'one') return this.ids[this.order[this.cursor]] ?? null
    let next = this.cursor + direction
    if (next < 0 || next >= this.order.length) {
      if (this.state.repeat !== 'all') return null
      next = (next + this.order.length) % this.order.length
    }
    this.cursor = next; return this.ids[this.order[next]]
  }
  nextTrackId(): string | null { return this.advance(1) }
  previousTrackId(): string | null { return this.advance(-1) }
  setRepeat(mode: 'off' | 'all' | 'one'): void { if (!['off', 'all', 'one'].includes(mode)) throw new RangeError('无效的循环模式'); this.state.repeat = mode; this.emit() }
  setShuffle(enabled: boolean): void {
    const current = this.order[this.cursor] ?? -1
    this.state.shuffle = enabled
    if (enabled) this.shuffleOrder(current)
    else { this.order = this.ids.map((_, index) => index); this.cursor = current }
    this.emit()
  }
  dispose(): void {
    this.retireMedia()
    if (this.timer) clearInterval(this.timer)
    this.source?.disconnect(); this.effects?.dispose(); this.volumeNode?.disconnect(); void this.audioContext?.close()
    this.listeners.clear(); this.endedListeners.clear()
  }
}
