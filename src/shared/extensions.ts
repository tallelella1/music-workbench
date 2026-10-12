import { z } from 'zod'
export const ExtensionManifestSchema = z.strictObject({
  id: z.string().uuid(), name: z.string().min(1).max(100), version: z.string().max(100), contractMajor: z.literal(1),
  platformIds: z.array(z.enum(['wy', 'kg', 'tx', 'kw', 'mg'])).max(5), qualities: z.array(z.enum(['128k', '320k', 'flac', 'flac24bit'])).max(4),
  enabled: z.boolean(), compatibilityError: z.string().max(1000).nullable()
})
export type ExtensionManifest = z.infer<typeof ExtensionManifestSchema>
export const LXScriptInfoSchema = z.strictObject({ name: z.string(), version: z.string(), description: z.string(), author: z.string(), homepage: z.string(), rawScript: z.string().max(1024 * 1024) })
export const LXSourceSchema = z.object({ type: z.literal('music'), actions: z.array(z.string()).max(20), qualitys: z.array(z.string()).max(20), name: z.string().optional() })
export const LXInitSchema = z.object({ sources: z.record(z.string(), LXSourceSchema), openDevTools: z.boolean().optional() })
export const LXNetworkSchema = z.strictObject({ requestId: z.string().uuid(), url: z.url().max(2048).refine((url) => /^https?:\/\//.test(url) && !new URL(url).username && !new URL(url).password), options: z.strictObject({ method: z.enum(['get', 'post', 'put', 'patch', 'delete', 'head', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).optional(), headers: z.record(z.string().max(256), z.string().max(8192)).optional(), body: z.string().max(4 * 1024 * 1024).optional(), form: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(), timeout: z.number().finite().optional() }) })
export const LXMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('inited'), data: LXInitSchema }),
  z.strictObject({ type: z.literal('init-error') }),
  z.strictObject({ type: z.literal('result'), requestId: z.string().uuid(), url: z.url().max(2048).refine((url) => /^https?:\/\//.test(url)) }),
  z.strictObject({ type: z.literal('request-error'), requestId: z.string().uuid() }),
  z.strictObject({ type: z.literal('update-alert') })
])
export const LXMusicRequestSchema = z.strictObject({ requestId: z.string().uuid(), source: z.enum(['wy', 'kg', 'tx', 'kw', 'mg']), action: z.literal('musicUrl'), info: z.strictObject({ type: z.enum(['128k', '320k', 'flac', 'flac24bit']), musicInfo: z.record(z.string(), z.unknown()) }) })
export const LXNetworkResponseSchema = z.strictObject({ statusCode: z.number().int(), statusMessage: z.string(), headers: z.record(z.string(), z.string()), bytes: z.number().int().nonnegative(), raw: z.instanceof(Uint8Array), body: z.unknown() })
