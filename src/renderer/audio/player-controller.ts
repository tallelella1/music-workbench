import type { MusicAppApi, Track } from '../../shared/contracts'
import type { PlayerEngine } from './player-engine'
import type { PlaybackResource } from '../../shared/player'
export class PlayerController {
  private currentRequest: string | null = null
  private selection: { track: Track; options: { quality: string; strict: boolean }; resource: PlaybackResource | null } | null = null
  constructor(private readonly engine: PlayerEngine, private readonly playback: MusicAppApi['playback']) {}
  stop(): void {
    const requestId = this.currentRequest; this.currentRequest = null
    this.selection = null
    this.engine.clear()
    if (requestId) void this.playback.cancel(requestId).catch(() => {})
  }
  async playResource(track: Track, resource: PlaybackResource, options = { quality: '128k', strict: false }): Promise<void> {
    const previous = this.currentRequest; const requestId = crypto.randomUUID(); this.currentRequest = requestId
    this.selection = { track, options, resource }
    if (previous) void this.playback.cancel(previous).catch(() => {})
    try { await this.engine.load(resource, track, requestId); if (this.currentRequest === requestId) await this.engine.play() }
    catch (error) { if (this.currentRequest !== requestId) return; this.engine.fail?.(requestId); throw error }
  }
  async playTrack(track: Track, options: { quality: string; strict: boolean }): Promise<void> {
    const previous = this.currentRequest; const requestId = crypto.randomUUID(); this.currentRequest = requestId
    this.engine.prepareLoad?.(track.id, requestId)
    this.selection = { track, options, resource: null }
    if (previous) void this.playback.cancel(previous).catch(() => {})
    try {
      const resource = await this.playback.resolve(track, options, requestId)
      if (this.currentRequest !== requestId) return
      this.selection = { track, options, resource }
      await this.engine.load(resource, track, requestId)
      if (this.currentRequest === requestId) await this.engine.play()
    } catch (error) {
      if (this.currentRequest !== requestId) return
      this.engine.fail?.(requestId); throw error
    }
  }
  async resume(): Promise<void> {
    const selected = this.selection
    if (!selected?.resource || selected.resource.expiresAt === null || selected.resource.expiresAt > Date.now()) { await this.engine.play(); return }
    const position = this.engine.snapshot().sourceSeconds
    const previous = this.currentRequest; const requestId = crypto.randomUUID(); this.currentRequest = requestId
    this.engine.prepareLoad?.(selected.track.id, requestId)
    if (previous) void this.playback.cancel(previous).catch(() => {})
    try {
      const resource = await this.playback.resolve(selected.track, selected.options, requestId)
      if (this.currentRequest !== requestId) return
      this.selection = { ...selected, resource }
      await this.engine.load(resource, selected.track, requestId)
      if (this.currentRequest !== requestId) return
      this.engine.seek(Math.min(position, resource.probe?.durationSeconds ?? position))
      await this.engine.play()
    } catch (error) { if (this.currentRequest !== requestId) return; this.engine.fail?.(requestId); throw error }
  }
}
