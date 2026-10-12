import { z } from 'zod'
import { MediaProbeSchema } from './schemas'
import type { MediaProbe } from './contracts'
export interface PlaybackResource { resourceId: string; url: string; assetId: string | null; probe: MediaProbe; actualQuality: string; expiresAt: number | null }
export interface PlayerSnapshot {
  trackId: string | null; status: 'idle' | 'loading' | 'playing' | 'paused' | 'error'
  sourceSeconds: number; durationSeconds: number; rate: number; preservePitch: boolean; volume: number
  repeat: 'off' | 'all' | 'one'; shuffle: boolean; actualQuality: string | null; revisionId: string | null
}
export const PlaybackResourceSchema = z.strictObject({
  resourceId: z.string().min(1), url: z.url(), assetId: z.string().nullable(), probe: MediaProbeSchema,
  actualQuality: z.string().min(1), expiresAt: z.number().int().nonnegative().nullable()
})
