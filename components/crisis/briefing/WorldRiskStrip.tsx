'use client'

import type { CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import { severityColor } from '@/lib/crisis/ui/severity'

type Props = {
  t: CrisisUiPack
  day: string | null
  stage5: number
  stage4: number
  stage3: number
}

export function WorldRiskStrip({ t, day, stage5, stage4, stage3 }: Props) {
  const cells = [
    { stage: 5, count: stage5, label: t.worldRiskStage5 },
    { stage: 4, count: stage4, label: t.worldRiskStage4 },
    { stage: 3, count: stage3, label: t.worldRiskStage3 },
  ]
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-white/[0.02] shadow-[0_0_60px_rgba(0,0,0,0.4)]">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-black tracking-tight text-white">{t.worldRiskTitle}</h2>
          {day ? <p className="text-xs text-slate-500">{t.worldRiskUpdated(day)}</p> : null}
        </div>
        <p className="mt-1 text-sm font-semibold text-slate-300">{t.worldRiskSummary(stage5, stage4, stage3)}</p>
      </div>
      <div className="grid grid-cols-3 divide-x divide-white/10">
        {cells.map((cell) => {
          const color = severityColor(cell.stage)
          return (
            <div key={cell.stage} className="px-4 py-5 text-center sm:px-6">
              <p
                className="text-4xl font-black tabular-nums sm:text-5xl"
                style={{ color, textShadow: `0 0 30px ${color}66` }}
              >
                {cell.count}
              </p>
              <p className="mt-1 text-xs font-bold uppercase tracking-widest" style={{ color }}>
                {cell.label}
              </p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
