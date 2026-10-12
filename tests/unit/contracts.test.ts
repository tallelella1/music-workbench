import { afterEach, describe, expect, test } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TrackSchema, AssetRecordSchema, TimeRangeSchema, AppErrorSchema, JobSnapshotSchema, AppEventSchema } from '../../src/shared/schemas'
import { TaskService } from '../../src/main/jobs/task-service'
import { createIpcRouter } from '../../src/main/ipc'
import { makeAudioFile, makeTrack } from '../helpers/fixtures'

describe('runtime contracts', () => {
  test('negative duration fails runtime validation', () => {
    expect(TrackSchema.safeParse(makeTrack({ durationSeconds: -1 })).success).toBe(false)
  })
  test('unknown duration and complete provider identity remain valid', () => {
    const track = makeTrack({ durationSeconds: null, sources: [{ providerId: 'wy', songId: '12', identity: { version: '现场', disc: 1, original: null } }] })
    expect(TrackSchema.parse(track)).toEqual(track)
  })
  test('DTOs reject injected fields and non-finite numbers', () => {
    expect(TrackSchema.safeParse({ ...makeTrack(), path: 'C:/private/music.flac' }).success).toBe(false)
    expect(TrackSchema.safeParse(makeTrack({ durationSeconds: Infinity })).success).toBe(false)
    expect(AppErrorSchema.safeParse({ code: 'FAILED', message: '失败', moduleId: 'jobs', requestId: null, command: 'dir' }).success).toBe(false)
  })
  test('ranges require a nonnegative start and increasing end', () => {
    expect(TimeRangeSchema.safeParse({ startSeconds: -1, endSeconds: 3 }).success).toBe(false)
    expect(TimeRangeSchema.safeParse({ startSeconds: 3, endSeconds: 3 }).success).toBe(false)
    expect(TimeRangeSchema.parse({ startSeconds: 0, endSeconds: 3 })).toEqual({ startSeconds: 0, endSeconds: 3 })
  })
  test('asset DTOs cannot carry a host filesystem path', () => {
    const asset = { id: 'asset-1', kind: 'audio', hash: 'abc', byteLength: 10, parentAssetId: null,
      media: { durationSeconds: null, durationReliable: false, codec: 'pcm', sampleRate: 44100, channels: 1, bitDepth: 16, bitrate: null, width: null, height: null } }
    expect(AssetRecordSchema.safeParse(asset).success).toBe(true)
    expect(AssetRecordSchema.safeParse({ ...asset, absolutePath: 'C:/private.wav' }).success).toBe(false)
  })
  test('progress and event versions are checked at runtime', () => {
    const snapshot = { id: 'job-1', status: 'running', progress: null, result: null, error: null }
    expect(JobSnapshotSchema.parse(snapshot)).toEqual(snapshot)
    for (const progress of [-0.1, 1.1, NaN, Infinity]) {
      expect(JobSnapshotSchema.safeParse({ ...snapshot, progress }).success).toBe(false)
    }
    expect(AppEventSchema.safeParse({ type: 'jobs.updated', contractVersion: 2, resourceId: 'job-1', requestId: 'job-1', payload: snapshot }).success).toBe(false)
    expect(AppEventSchema.safeParse({ type: 'shell.execute', contractVersion: 1, resourceId: 'job-1', requestId: 'job-1', payload: snapshot }).success).toBe(false)
  })
})

describe('task lifecycle', () => {
  test('cancel aborts work and ignores a late result and progress', async () => {
    const service = new TaskService()
    let resolve!: (value: string) => void
    let report!: (value: number) => void
    let signal!: AbortSignal
    const job = service.start(({ signal: workSignal }, workReport) => {
      signal = workSignal
      report = workReport
      return new Promise<string>((finish) => { resolve = finish })
    })
    await Promise.resolve()
    service.cancel(job)
    expect(signal.aborted).toBe(true)
    report(0.7)
    resolve('late result')
    await new Promise((finish) => setImmediate(finish))
    expect(service.get(job)).toMatchObject({ status: 'cancelled', result: null, progress: null, error: null })
  })
  test('successful jobs produce snapshots and schema-valid events', async () => {
    const events: unknown[] = []
    const service = new TaskService((event) => events.push(event))
    const job = service.start(async (ctx, report) => {
      expect(ctx.requestId).toBeTruthy()
      report(0.4)
      return { count: 2 }
    })
    await new Promise((finish) => setImmediate(finish))
    expect(service.get(job)).toMatchObject({ id: job, status: 'completed', progress: 1, result: { count: 2 }, error: null })
    expect(events.length).toBeGreaterThan(1)
    for (const event of events) expect(AppEventSchema.safeParse(event).success).toBe(true)
    service.cancel(job)
    expect(service.get(job).status).toBe('completed')
  })
  test('a thrown error becomes a structured failed snapshot', async () => {
    const service = new TaskService()
    const job = service.start(async () => { throw new Error('work failed') })
    await new Promise((finish) => setImmediate(finish))
    expect(service.get(job)).toMatchObject({ status: 'failed', error: { code: 'TASK_FAILED', message: 'work failed', moduleId: 'jobs', requestId: job } })
    expect(() => service.get('missing')).toThrow('找不到任务')
  })
  test('invalid progress fails work without leaking invalid snapshots', async () => {
    const service = new TaskService()
    const job = service.start(async (_ctx, report) => { report(Infinity); return 'invalid' })
    await new Promise((finish) => setImmediate(finish))
    expect(service.get(job).status).toBe('failed')
    expect(JobSnapshotSchema.safeParse(service.get(job)).success).toBe(true)
  })
  test('a completed task owns its result independently of the worker object', async () => {
    const service = new TaskService()
    const result = { count: 2 }
    const job = service.start(async () => result)
    await new Promise((finish) => setImmediate(finish))
    result.count = 99
    const snapshot = service.get<{ count: number }>(job)
    expect(snapshot.result).toEqual({ count: 2 })
    snapshot.result!.count = 88
    expect(service.get(job).result).toEqual({ count: 2 })
  })
})

describe('IPC boundary', () => {
  const webContents = {}
  const frame = {}
  const trusted = { webContents, frame, url: 'file:///app/index.html' }
  const service = new TaskService()
  const route = createIpcRouter(service, () => trusted)

  test('unknown methods and unknown operation fields are rejected', async () => {
    await expect(route(trusted, { method: 'shell.execute', requestId: 'r1', params: {} })).rejects.toThrow('无效的请求')
    await expect(route(trusted, { method: 'jobs.get', requestId: 'r1', params: { jobId: 'job' }, path: 'C:/private' })).rejects.toThrow('无效的请求')
  })
  test('external senders, subframes and changed URLs cannot call the host', async () => {
    const request = { method: 'jobs.get', requestId: 'r1', params: { jobId: 'job' } }
    await expect(route({ ...trusted, webContents: {} }, request)).rejects.toThrow('请求来源')
    await expect(route({ ...trusted, frame: {} }, request)).rejects.toThrow('请求来源')
    await expect(route({ ...trusted, url: 'https://example.org' }, request)).rejects.toThrow('请求来源')
  })
  test('trusted named job methods return validated data', async () => {
    const jobId = service.start(() => new Promise(() => {}))
    await expect(route(trusted, { method: 'jobs.cancel', requestId: 'r1', params: { jobId } })).resolves.toBeNull()
    await expect(route(trusted, { method: 'jobs.get', requestId: 'r2', params: { jobId } })).resolves.toMatchObject({ id: jobId, status: 'cancelled' })
  })
})

describe('audio fixtures', () => {
  let directory: string | undefined
  afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })
  test('writes real PCM audio with Chinese and emoji filenames', async () => {
    directory = await mkdtemp(join(tmpdir(), 'music-fixture-'))
    const file = await makeAudioFile({ directory, name: '音乐 空格🎵.wav', durationSeconds: 0.1, toneHz: 440 })
    const bytes = await readFile(file)
    expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
    expect(bytes.readUInt32LE(40)).toBe(8820)
    expect(bytes.readInt16LE(46)).not.toBe(0)
  })
})
