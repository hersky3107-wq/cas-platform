'use client'

import type { CrisisUiPack } from '@/lib/crisis/i18n/dictionary'

export function EmptyBriefingState({ t }: { t: CrisisUiPack }) {
  const tiers = [
    { n: 1, text: t.emptyTier1, color: '#fb7185' },
    { n: 2, text: t.emptyTier2, color: '#22d3ee' },
    { n: 3, text: t.emptyTier3, color: '#fbbf24' },
  ]
  return (
    <section className="rounded-3xl border border-dashed border-white/15 bg-white/[0.03] px-5 py-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500/15">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-cyan-300" />
      </div>
      <h2 className="text-xl font-black text-white">{t.emptyTitle}</h2>
      <div className="mx-auto mt-5 max-w-md space-y-2 text-start">
        {tiers.map((tier) => (
          <div key={tier.n} className="flex items-start gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
            <span
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-black"
              style={{ background: `${tier.color}22`, color: tier.color }}
            >
              {tier.n}
            </span>
            <p className="text-sm text-slate-300">{tier.text}</p>
          </div>
        ))}
      </div>

      {/* Sample card */}
      <div className="relative mx-auto mt-6 max-w-md">
        <span className="absolute -top-2.5 start-4 z-10 rounded-md bg-slate-700 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-slate-200">
          {t.emptySampleLabel}
        </span>
        <article className="rounded-2xl border border-amber-300/40 bg-amber-400/[0.06] px-4 py-4 text-start">
          <div className="rounded-xl bg-amber-400/15 px-3 py-1.5 text-xs font-black text-amber-300">
            {t.stageBanner[4]}
          </div>
          <h3 className="mt-2 text-lg font-black leading-snug text-white">{t.sampleHeadline}</h3>
          <p className="mt-1 text-sm text-slate-300">{t.sampleSummary}</p>
        </article>
      </div>
    </section>
  )
}
