/**
 * @name Local HTTP fixture
 * @version 1.0.0
 * @description Controlled integration fixture, not a real user source
 */
if (typeof require !== 'undefined' || typeof process !== 'undefined' || typeof musicApp !== 'undefined') throw new Error('isolation failed')
if (lx.version !== '2.0.0' || lx.env !== 'desktop' || lx.currentScriptInfo.name !== 'Local HTTP fixture' || lx.currentScriptInfo.version !== '1.0.0' || !lx.currentScriptInfo.rawScript.startsWith('/**')) throw new Error('script metadata mismatch')
lx.on(lx.EVENT_NAMES.request, async () => { throw new Error('old handler must be replaced') })
lx.on(lx.EVENT_NAMES.request, async ({ source, action, info }) => {
  if (source !== 'wy' || action !== 'musicUrl' || info.type !== '128k' || info.musicInfo.songmid !== 123) throw new Error('protocol mismatch')
  if (info.musicInfo.name !== 'HTTP 完整短曲' || info.musicInfo.singer !== 'Fixture Artist') throw new Error('metadata mismatch')
  if (info.musicInfo.types.length !== 0 || Object.keys(info.musicInfo._types).length !== 0) throw new Error('invented qualities')
  const body = await new Promise((resolve, reject) => {
    const cancel = lx.request('__BASE__/metadata', { headers: { 'X-Fixture': 'network-only' } }, (error, response, body) => {
      if (error) return reject(error)
      if (response.statusCode !== 200 || response.body.duration !== body.duration || !response.raw.length) return reject(new Error('callback mismatch'))
      resolve(body)
    })
    if (typeof cancel !== 'function') reject(new Error('request is not cancelable'))
  })
  if (body.duration !== 20) throw new Error('bad response')
  return '__BASE__/20.wav'
})
lx.send(lx.EVENT_NAMES.inited, { sources: { wy: { type: 'music', actions: ['musicUrl'], qualitys: ['128k'] } } })
