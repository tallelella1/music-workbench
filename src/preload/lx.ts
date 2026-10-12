import { contextBridge, ipcRenderer } from 'electron'
import { z } from 'zod'
import { LXMessageSchema, LXMusicRequestSchema, LXNetworkSchema, LXNetworkResponseSchema, LXScriptInfoSchema } from '../shared/extensions'
// This preload deliberately has no musicApp bridge, filesystem, settings or generic IPC.
contextBridge.exposeInMainWorld('lxBridge', {
  async bootstrap() { return LXScriptInfoSchema.parse(await ipcRenderer.invoke('lx:bootstrap')) },
  async send(input: unknown) { await ipcRenderer.invoke('lx:message', LXMessageSchema.parse(input)) },
  async network(input: unknown) {
    const result = await ipcRenderer.invoke('lx:network', LXNetworkSchema.parse(input))
    const response = z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), response: LXNetworkResponseSchema }), z.strictObject({ ok: z.literal(false), message: z.string().max(256) })]).parse(result)
    if (!response.ok) throw new Error(response.message)
    return response.response
  },
  async cancel(requestId: string) { await ipcRenderer.invoke('lx:cancel-network', z.string().uuid().parse(requestId)) },
  onRequest(listener: (request: z.infer<typeof LXMusicRequestSchema>) => void) {
    ipcRenderer.on('lx:resolve', (_event, input: unknown) => { const parsed = LXMusicRequestSchema.safeParse(input); if (parsed.success) listener(parsed.data) })
  }
})
