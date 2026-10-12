import './audio-zod'
import { PlayerEngine } from '../../src/renderer/audio/player-engine'
import { PlayerController } from '../../src/renderer/audio/player-controller'
import { EffectChain } from '../../src/renderer/audio/effect-chain'
import { defaultEffects, type EffectConfig } from '../../src/shared/effects'
import type { Track } from '../../src/shared/contracts'
import type { PlaybackResource } from '../../src/shared/player'

// Hold delivery of real browser events so selection races are deterministic.
// Media loading, decoding and Web Audio stay real; only callback scheduling is delayed.
function deferMediaEvents(eventType: 'ended' | 'error' | 'loadedmetadata') {
  const originalAdd = HTMLMediaElement.prototype.addEventListener
  const originalRemove = HTMLMediaElement.prototype.removeEventListener
  const wrappers = new Map<EventListenerOrEventListenerObject, EventListener>()
  const deliveries: (() => void)[] = []
  let holding = true
  let observed!: (event: Event) => void
  const event = new Promise<Event>((done) => { observed = done })
  HTMLMediaElement.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    if (type !== eventType || !listener) return originalAdd.call(this, type, listener, options)
    const target = this
    const wrapped: EventListener = (value) => {
      const deliver = () => typeof listener === 'function' ? listener.call(target, value) : listener.handleEvent(value)
      if (holding) { deliveries.push(deliver); observed(value) } else deliver()
    }
    wrappers.set(listener, wrapped)
    originalAdd.call(this, type, wrapped, options)
  }
  HTMLMediaElement.prototype.removeEventListener = function (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    originalRemove.call(this, type, listener ? wrappers.get(listener) ?? listener : listener, options)
  }
  return {
    event,
    release() { holding = false; for (const deliver of deliveries.splice(0)) deliver() },
    restore() { HTMLMediaElement.prototype.addEventListener = originalAdd; HTMLMediaElement.prototype.removeEventListener = originalRemove }
  }
}

function exportSpectrum(data: Float32Array) {
  const length = 2048; const start = 8820
  return [31,62,125,250,500,1000,2000,4000,8000,16000].map(frequency => {
    let real = 0; let imaginary = 0
    for (let i = 0; i < length; i++) {
      const sample = data[start+i] * (0.5 - 0.5*Math.cos(2*Math.PI*i/(length-1)))
      const phase = 2*Math.PI*frequency*i/44100
      real += sample*Math.cos(phase); imaginary += sample*Math.sin(phase)
    }
    return Math.hypot(real,imaginary)*4/length
  })
}
async function renderEffects(configs: EffectConfig[], bypass = false, sampleRate = 44100) {
  const context = new OfflineAudioContext(2, sampleRate, sampleRate)
  const chain = new EffectChain(context)
  chain.apply(configs); chain.bypass(bypass)
  const buffer = context.createBuffer(1, Math.round(sampleRate * 0.2), sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.sin(2 * Math.PI * 1000 * i / sampleRate) * 0.1
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(chain.input); chain.output.connect(context.destination); source.start(0.1)
  const rendered = (await context.startRendering()).getChannelData(0)
  function rms(start: number, end: number) {
    let energy = 0
    for (let i = Math.round(start * sampleRate); i < Math.round(end * sampleRate); i++) energy += rendered[i] ** 2
    return Math.sqrt(energy / ((end - start) * sampleRate))
  }
  return { body: rms(0.18, 0.27), tail: rms(0.4, 0.8), errors: chain.errors, available: chain.availableFrequencies, spectrum: sampleRate === 44100 ? exportSpectrum(rendered) : [], samples: Array.from(rendered.slice(Math.round(sampleRate * 0.2), Math.round(sampleRate * 0.2) + 20)) }
}
async function measurePlayback(resource: PlaybackResource, track: Track, rate: number, preservePitch: boolean) {
  const engine = new PlayerEngine()
  try {
    await engine.load(resource, track, crypto.randomUUID())
    engine.setRate(rate, preservePitch)
    const analyser = engine.context!.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0
    engine.effects!.output.connect(analyser)
    let started = 0
    const finished = new Promise<number>((done) => engine.onEnded(() => done((performance.now() - started) / 1000)))
    started = performance.now(); await engine.play()
    await new Promise<void>((done) => { const tick = () => engine.element!.currentTime >= 0.6 ? done() : requestAnimationFrame(tick); tick() })
    const spectrum = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(spectrum)
    let bin = 1
    for (let i = 2; i < spectrum.length; i++) if (spectrum[i] > spectrum[bin]) bin = i
    const frequency = bin * engine.context!.sampleRate / analyser.fftSize
    const peakDb = spectrum[bin]
    const elapsed = await finished
    return { elapsed, frequency, peakDb, snapshot: engine.snapshot() }
  } finally { engine.dispose() }
}
async function renderExportImpulse(configs: EffectConfig[]) {
  const context = new OfflineAudioContext(2, 44100, 44100)
  const chain = new EffectChain(context); chain.apply(configs)
  const buffer = context.createBuffer(1, 44100, 44100); buffer.getChannelData(0)[13230] = .5
  const source = context.createBufferSource(); source.buffer = buffer; source.connect(chain.input); chain.output.connect(context.destination); source.start()
  const output = await context.startRendering()
  return [0, 1].map(c => Array.from(output.getChannelData(c).slice(13230, 17640)))
}
declare global {
  interface Window { audioTest: { PlayerEngine: typeof PlayerEngine; PlayerController: typeof PlayerController; deferMediaEvents: typeof deferMediaEvents; defaultEffects: typeof defaultEffects; renderEffects: typeof renderEffects; measurePlayback: typeof measurePlayback; renderExportImpulse: typeof renderExportImpulse; exportSpectrum: typeof exportSpectrum; engine?: PlayerEngine } }
}
window.audioTest = { PlayerEngine, PlayerController, deferMediaEvents, defaultEffects, renderEffects, measurePlayback, renderExportImpulse, exportSpectrum }
