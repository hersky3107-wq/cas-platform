export const WORKER_WAIT_MS = 2 * 60_000

export const ENGINE_PIPELINE = [
  { id: 'analyst', roles: ['dept_analyst'], expected: 5 },
  { id: 'search', roles: ['search'], expected: 2 },
  { id: 'hunter', roles: ['hunter'], expected: 6 },
  { id: 'red_team', roles: ['red_team'], expected: 1 },
  { id: 'judge', roles: ['judge'], expected: 1 },
] as const

export type ProgressMark = 'done' | 'running' | 'waiting'
export type ProgressGroup = {
  id: (typeof ENGINE_PIPELINE)[number]['id']
  done: number
  expected: number
  mark: ProgressMark
}

export function summarizeEngineProgress(opts: {
  requestStatus: 'queued' | 'running' | 'done' | 'failed'
  createdAt: string
  now?: Date
  steps?: Array<{ role: string }>
}): {
  waitingForWorker: boolean
  elapsedSec: number
  groups: ProgressGroup[]
} {
  const now = opts.now ?? new Date()
  const started = Date.parse(opts.createdAt)
  const elapsedMs = Number.isFinite(started) ? Math.max(0, now.getTime() - started) : 0
  const waitingForWorker = opts.requestStatus === 'queued' && elapsedMs >= WORKER_WAIT_MS
  const counts = new Map<string, number>()
  for (const step of opts.steps ?? []) {
    counts.set(step.role, (counts.get(step.role) ?? 0) + 1)
  }

  let firstIncomplete = -1
  const groups: ProgressGroup[] = ENGINE_PIPELINE.map((row, index) => {
    const done = row.roles.reduce((sum, role) => sum + (counts.get(role) ?? 0), 0)
    if (done < row.expected && firstIncomplete < 0) firstIncomplete = index
    return { id: row.id, done: Math.min(done, row.expected), expected: row.expected, mark: 'waiting' as ProgressMark }
  })

  if (opts.requestStatus === 'done') {
    for (const group of groups) group.mark = 'done'
  } else if (opts.requestStatus === 'running' || (opts.steps ?? []).length > 0) {
    for (let i = 0; i < groups.length; i++) {
      if (groups[i].done >= groups[i].expected) groups[i].mark = 'done'
      else if (i === (firstIncomplete < 0 ? 0 : firstIncomplete) && opts.requestStatus === 'running') {
        groups[i].mark = 'running'
      } else {
        groups[i].mark = 'waiting'
      }
    }
    if (opts.requestStatus === 'running' && (opts.steps ?? []).length === 0) {
      groups[0].mark = 'running'
    }
  }

  return { waitingForWorker, elapsedSec: Math.floor(elapsedMs / 1000), groups }
}
