/** Stereo xorshift32 noise with a squared decay envelope. No normalization in either renderer or export. */
export function createImpulseResponse(sampleRate: number, decaySeconds: number, seed: number): Float32Array[] {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0 || !Number.isFinite(decaySeconds) || decaySeconds < 0.1 || decaySeconds > 5 || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('无效的脉冲参数')
  let state = seed || 0x6d2b79f5
  const length = Math.round(sampleRate * decaySeconds)
  return Array.from({ length: 2 }, () => {
    const channel = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5
      channel[i] = ((state >>> 0) / 0x100000000 * 2 - 1) * (1 - i / length) ** 2 / Math.sqrt(sampleRate * decaySeconds)
    }
    return channel
  })
}
