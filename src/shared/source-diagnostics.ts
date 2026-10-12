const messages = new Map<string, string>([
  ['音源未启用或不支持所选音质', 'SOURCE_DISABLED'], ['音源脚本请求失败', 'SOURCE_PROTOCOL_ERROR'], ['音源脚本初始化失败', 'SOURCE_PROTOCOL_ERROR'],
  ['音源脚本解析超时（15 秒）', 'SOURCE_TIMEOUT'], ['音源脚本初始化超时（5 秒）', 'SOURCE_TIMEOUT'],
  ['媒体超出大小限制', 'MEDIA_SIZE_LIMIT'], ['完整解码超时', 'MEDIA_DECODE_TIMEOUT'], ['完整解码失败', 'MEDIA_DECODE_FAILED']
])
export function sourceDiagnostic(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : ''
  const code = messages.get(message)
  return code ? { code, message } : { code: 'SOURCE_RESOLVE_FAILED', message: '音源解析失败，请检查兼容状态后重试' }
}
