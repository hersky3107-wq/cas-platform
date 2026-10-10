'use client'

import type { CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import { legendGroups } from '@/lib/crisis/i18n/hazards'

export function HazardMapLegend({ t }: { t: CrisisUiPack }) {
  const groups = legendGroups()
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <h2 className="mb-3 text-xs font-black uppercase tracking-wide text-slate-400">{t.hazardLegendTitle}</h2>
      <div className="space-y-3">
        {groups.map(({ group, kinds }) => (
          <div key={group}>
            <p className="mb-1.5 text-[11px] font-semibold text-slate-500">{t.hazardGroupLabel(group)}</p>
            <div className="flex flex-wrap gap-1.5">
              {kinds.map((kind) => (
                <span
                  key={kind}
                  title={t.triggerExplanation(kind)}
                  className="cursor-help rounded-full border border-white/12 bg-black/30 px-2 py-0.5 text-[10px] text-slate-300"
                >
                  {t.hazardKindLabel(kind)}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
