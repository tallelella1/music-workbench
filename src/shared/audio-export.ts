import { z } from 'zod'
import { EffectConfigSchema } from './effects'
/** For output time t, source time = startSeconds + t * rate (last frame rounded to source sample rate). */
export const SourceTimeMapSchema = z.strictObject({ sourceAssetId: z.string().min(1), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive(), rate: z.number().finite().min(0.5).max(2), outputDurationSeconds: z.number().finite().positive() }).refine(map => map.endSeconds > map.startSeconds)
export type SourceTimeMap = z.infer<typeof SourceTimeMapSchema>
export const AudioEditSchema = z.strictObject({ assetId: z.string().min(1).max(256), assetHash: z.string().regex(/^[a-f0-9]{64}$/), range: z.strictObject({ startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive() }).refine(r => r.endSeconds > r.startSeconds), rate: z.number().finite().min(0.5).max(2), preservePitch: z.boolean(), fadeInSeconds: z.number().finite().nonnegative(), fadeOutSeconds: z.number().finite().nonnegative(), effects: z.array(EffectConfigSchema).max(20) })
export type AudioEdit = z.infer<typeof AudioEditSchema>
export const AudioExportOptionsSchema = z.discriminatedUnion('format', [
  z.strictObject({ format: z.literal('mp3'), bitrateKbps: z.union([z.literal(128), z.literal(320)]), bitDepth: z.null() }),
  z.strictObject({ format: z.literal('flac'), bitrateKbps: z.null(), bitDepth: z.union([z.literal(16), z.literal(24)]) }),
  z.strictObject({ format: z.literal('wav'), bitrateKbps: z.null(), bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]) })
])
export type AudioExportOptions = z.infer<typeof AudioExportOptionsSchema>
export const ExportCapabilitiesSchema = z.strictObject({ mp3Bitrates: z.array(z.union([z.literal(128), z.literal(320)])), flacBitDepths: z.array(z.union([z.literal(16), z.literal(24)])), wavBitDepths: z.array(z.union([z.literal(16), z.literal(24), z.literal(32)])) })
export type ExportCapabilities = z.infer<typeof ExportCapabilitiesSchema>
export const AudioExportResultSchema = z.strictObject({ format: z.enum(['mp3', 'flac', 'wav']), media: z.strictObject({ durationSeconds: z.number().finite().positive(), sampleRate: z.number().int().positive(), channels: z.number().int().positive(), codec: z.string().min(1), bitDepth: z.number().int().positive().nullable(), bitrate: z.number().finite().nonnegative().nullable() }), sourceTimeMap: SourceTimeMapSchema, cleanupWarning: z.literal('成品已保存，但临时资源清理失败').optional() })
