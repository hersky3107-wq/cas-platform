'use client'

import type { CrisisUiPack } from '@/lib/crisis/i18n/dictionary'

export function HowItWorks({ t }: { t: CrisisUiPack }) {
  const lines = [t.howItWorksLine1, t.howItWorksLine2, t.howItWorksLine3]
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-5">
      <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">{t.howItWorksTitle}</h2>
      <ul className="mt-3 space-y-2">
        {lines.map((line, i) => (
          <li key={line} className="flex items-start gap-3 text-sm leading-relaxed text-slate-300">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/8 text-[11px] font-black text-slate-300">
              {i + 1}
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
