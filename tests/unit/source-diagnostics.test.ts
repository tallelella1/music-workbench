import { expect, test } from 'vitest'
import { sourceDiagnostic } from '../../src/shared/source-diagnostics'
test('source errors preserve whitelisted codes and concrete messages without provider secrets', () => {
  expect(sourceDiagnostic(new Error('音源未启用或不支持所选音质'))).toMatchObject({ code: 'SOURCE_DISABLED' })
  expect(sourceDiagnostic(new Error('音源脚本解析超时（15 秒）'))).toMatchObject({ code: 'SOURCE_TIMEOUT' })
  expect(sourceDiagnostic(new Error('媒体超出大小限制'))).toMatchObject({ code: 'MEDIA_SIZE_LIMIT' })
  expect(JSON.stringify(sourceDiagnostic(new Error('https://private.example/?secret=token Authorization: abc')))).not.toContain('token')
})
