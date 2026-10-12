import { randomUUID } from 'node:crypto'
import type { AppEvent, JobSnapshot, RequestContext } from '../../shared/contracts'
import { JobSnapshotSchema } from '../../shared/schemas'

export interface TaskContext extends RequestContext { beginCommit(): void }
interface TaskRecord { snapshot: JobSnapshot<unknown>; controller: AbortController; committed: boolean; completion: Promise<void> }

export class TaskService {
  private readonly tasks = new Map<string, TaskRecord>()
  private closing = false

  constructor(private readonly onEvent?: (event: AppEvent) => void) {}

  start<T>(work: (ctx: TaskContext, report: (progress: number) => void) => Promise<T>): string {
    if (this.closing) throw new Error('应用正在退出，无法启动任务')
    const id = randomUUID()
    const task: TaskRecord = {
      controller: new AbortController(),
      committed: false, completion: Promise.resolve(),
      snapshot: { id, status: 'queued', progress: null, result: null, error: null }
    }
    this.tasks.set(id, task)
    this.emit(task)
    task.completion = Promise.resolve().then(async () => {
      if (task.snapshot.status === 'cancelled') return
      task.snapshot.status = 'running'
      this.emit(task)
      try {
        const result = await work({ requestId: id, signal: task.controller.signal, beginCommit: () => {
          task.controller.signal.throwIfAborted()
          task.committed = true
        } }, (progress) => {
          if (task.snapshot.status !== 'running') return
          if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
            throw new RangeError('任务进度必须在 0 和 1 之间')
          }
          task.snapshot.progress = progress
          this.emit(task)
        })
        if (task.controller.signal.aborted) return
        task.snapshot = { id, status: 'completed', progress: 1, result: structuredClone(result), error: null }
      } catch (error) {
        if (task.controller.signal.aborted) return
        task.snapshot = {
          id, status: 'failed', progress: task.snapshot.progress, result: null,
          error: { code: 'TASK_FAILED', message: error instanceof Error ? error.message || '任务执行失败' : '任务执行失败', moduleId: 'jobs', requestId: id }
        }
      }
      this.emit(task)
    })
    return id
  }

  get<T>(jobId: string): JobSnapshot<T> {
    return structuredClone(this.find(jobId).snapshot) as JobSnapshot<T>
  }

  cancel(jobId: string): void {
    const task = this.find(jobId)
    if (task.snapshot.status !== 'queued' && task.snapshot.status !== 'running') return
    if (task.committed) throw new Error('成品正在保存，已无法取消')
    task.snapshot = { ...task.snapshot, status: 'cancelled', progress: null, result: null, error: null }
    task.controller.abort()
    this.emit(task)
  }

  wait(jobId: string): Promise<void> { return this.find(jobId).completion }

  async shutdown(): Promise<void> {
    this.closing = true
    for (const [id, task] of this.tasks) if (!task.committed) this.cancel(id)
    await Promise.allSettled([...this.tasks.values()].map(task => task.completion))
  }

  private find(jobId: string): TaskRecord {
    const task = this.tasks.get(jobId)
    if (!task) throw new Error('找不到任务')
    return task
  }

  private emit(task: TaskRecord): void {
    const snapshot = JobSnapshotSchema.parse(task.snapshot)
    this.onEvent?.({ type: 'jobs.updated', contractVersion: 1, resourceId: snapshot.id, requestId: snapshot.id, payload: structuredClone(snapshot) })
  }
}
