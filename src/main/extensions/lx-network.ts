import { LXNetworkSchema, LXNetworkResponseSchema } from '../../shared/extensions'
export async function lxNetwork(input: unknown, signal: AbortSignal) {
  const { url, options } = LXNetworkSchema.parse(input)
  const timeout = Math.min(60000, options.timeout && options.timeout > 0 ? options.timeout : 60000)
  const deadline = AbortSignal.timeout(timeout)
  const headers = { ...options.headers }
  let body = options.body
  if (!body && options.form) { body = new URLSearchParams(Object.entries(options.form).map(([key, value]) => [key, String(value)])).toString(); headers['content-type'] ??= 'application/x-www-form-urlencoded' }
  const response = await fetch(url, { method: options.method ?? 'get', headers, body, signal: AbortSignal.any([signal, deadline]), redirect: 'error' })
  const parts: Uint8Array[] = []; let bytes = 0
  if (response.body) {
    const reader = response.body.getReader()
    try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; if (bytes > 4 * 1024 * 1024) throw new Error('音源网络响应超出大小限制'); parts.push(next.value) } }
    finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  }
  const raw = new Uint8Array(Buffer.concat(parts, bytes)); const text = new TextDecoder().decode(raw)
  let parsed: unknown = text; try { parsed = JSON.parse(text) } catch { /* Official protocol parses JSON regardless of content-type. */ }
  return LXNetworkResponseSchema.parse({ statusCode: response.status, statusMessage: response.statusText, headers: Object.fromEntries(response.headers), bytes, raw, body: parsed })
}
