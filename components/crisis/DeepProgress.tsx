'use client'

import type { CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import type { ProgressGroup, ProgressMark } from '@/lib/crisis/public/progress'

const STEP_LABEL: Record<ProgressGroup['id'], keyof CrisisUiPack> = {
  analyst: 'stepAnalyst',
  search: 'stepSearch',
  hunter: 'stepHunter',
  red_team: 'stepRedTeam',
  judge: 'stepJudge',
}

function markGlyph(mark: ProgressMark): string {
  if (mark === 'done') return '●'
  if (mark === 'running') return '◉'
  return '○'
}

function markClass(mark: ProgressMark): string {
  if (mark === 'done') return 'text-cyan-300'
  if (mark === 'running') return 'text-amber-300'
  return 'text-slate-500'
}

export function DeepProgress({
  t,
  requestStatus,
  elapsedSec,
  waitingForWorker,
  groups,
}: {
  t: CrisisUiPack
  requestStatus: string
  elapsedSec: number
  waitingForWorker: boolean
  groups: ProgressGroup[]
}) {
  const minutes = Math.floor(elapsedSec / 60)
  const seconds = elapsedSec % 60
  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-black text-white">
          {waitingForWorker ? t.workerWaiting : requestStatus === 'running' ? t.progressRunning : t.progressQueued}
        </p>
        <p className="text-xs text-slate-400">{t.elapsed(minutes, seconds)}</p>
      </div>
      <ol className="space-y-2">
        {groups.map((group) => (
          <li key={group.id} className={`flex items-center justify-between gap-3 text-sm ${markClass(group.mark)}`}>
            <span className="inline-flex items-center gap-2 font-semibold">
              <span aria-hidden>{markGlyph(group.mark)}</span>
              {String(t[STEP_LABEL[group.id]])}
              <span className="text-[11px] font-bold text-slate-500">
                {group.done}/{group.expected}
              </span>
            </span>
            <span className="text-[11px] uppercase tracking-wide">
              {group.mark === 'done' ? t.stepDone : group.mark === 'running' ? t.stepRunning : t.stepWaiting}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
