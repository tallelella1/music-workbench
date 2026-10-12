import type { z } from 'zod'
import type { LXMusicRequestSchema, LXNetworkResponseSchema, LXScriptInfoSchema } from '../shared/extensions'
interface LXBridge {
  bootstrap(): Promise<z.infer<typeof LXScriptInfoSchema>>
  send(input: unknown): Promise<void>
  network(input: unknown): Promise<z.infer<typeof LXNetworkResponseSchema>>
  cancel(requestId: string): Promise<void>
  onRequest(listener: (request: z.infer<typeof LXMusicRequestSchema>) => void): void
}
const bridge = (globalThis as unknown as { lxBridge: LXBridge }).lxBridge
let handler: ((request: Omit<z.infer<typeof LXMusicRequestSchema>, 'requestId'>) => Promise<string>) | undefined
let initialized = false; let updateSent = false
const events = Object.freeze({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' })
const failInit = () => { if (!initialized) void bridge.send({ type: 'init-error' }).catch(() => {}) }
addEventListener('error', failInit); addEventListener('unhandledrejection', failInit)
void bridge.bootstrap().then((script) => {
  const lx = {
    version: '2.0.0', env: 'desktop', EVENT_NAMES: events, currentScriptInfo: Object.freeze(script),
    async on(event: string, callback: typeof handler) { if (event !== events.request || typeof callback !== 'function') throw new Error('不支持此事件'); handler = callback },
    async send(event: string, data: unknown) {
      if (event === events.inited) { if (initialized) throw new Error('不能重复初始化'); await bridge.send({ type: 'inited', data }); initialized = true; return }
      if (event === events.updateAlert) { if (updateSent) throw new Error('不能重复发送更新提示'); updateSent = true; await bridge.send({ type: 'update-alert' }); return }
      throw new Error('不支持此事件')
    },
    request(url: string, options: unknown, callback: (error: Error | null, response: unknown, body: unknown) => void) {
      const requestId = crypto.randomUUID(); let cancelled = false
      void bridge.network({ requestId, url, options: options ?? {} }).then((response) => { if (!cancelled) callback(null, response, response.body) }, () => { if (!cancelled) callback(new Error('网络请求失败、取消或超时'), null, null) })
      return () => { if (cancelled) return; cancelled = true; void bridge.cancel(requestId).catch(() => {}) }
    }
  }
  Object.defineProperty(globalThis, 'lx', { value: Object.freeze(lx), writable: false, configurable: false })
  bridge.onRequest((request) => {
    const { requestId, ...payload } = request
    try {
      const result = handler?.(payload)
      if (!result || typeof result.then !== 'function') throw new Error('musicUrl handler 必须返回 Promise')
      void result.then((url) => bridge.send({ type: 'result', requestId, url }), () => bridge.send({ type: 'request-error', requestId })).catch(() => bridge.send({ type: 'request-error', requestId }))
    } catch { void bridge.send({ type: 'request-error', requestId }) }
  })
  // Script executes only in its dedicated unprivileged main world.
  new Function(script.rawScript)()
}).catch(failInit)
