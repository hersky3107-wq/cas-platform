'use client'

import { noveltyLabel, stageBannerText, type CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import { hazardIconsFor, type HazardIconKind } from '@/lib/crisis/ui/hazards'
import { severityTheme } from '@/lib/crisis/ui/severity'
import { HazardIconRow } from './HazardIcon'

export type EvidenceLink = { label: string; url?: string; kind?: 'buried_warning' }

export type SeverityCardModel = {
  stage: number
  summary: string
  whatToDo: string[]
  whatToDoLocal?: string[]
  whyMiss?: string
  evidence?: EvidenceLink[]
  novelty?: string
  headlineFallback?: boolean
  hazards?: string[]
  possibility?: string
  windowLabel?: string
}

export function SeverityCard({
  card,
  t,
  extraIcons = [],
}: {
  card: SeverityCardModel
  t: CrisisUiPack
  extraIcons?: HazardIconKind[]
}) {
  const theme = severityTheme(card.stage)
  const icons = [...extraIcons, ...hazardIconsFor(card.hazards ?? [])]
  const badge = noveltyLabel(card.novelty, t)
  return (
    <article
      className={`rounded-2xl px-4 py-4 ${theme.compact ? 'space-y-2' : 'space-y-3'} ${theme.pulseBorder ? 'crisis-pulse-border' : ''}`}
      style={{
        background: theme.bg,
        border: `2px solid ${theme.border}`,
        boxShadow: theme.pulseBorder ? `0 0 0 1px ${theme.color}55` : undefined,
      }}
    >
      <div
        className="rounded-xl px-3 py-2 text-sm font-black tracking-tight"
        style={{ background: theme.bannerBg, color: theme.color }}
      >
        {stageBannerText(card.stage, t)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <HazardIconRow kinds={icons} color={theme.color} />
        {badge ? (
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-bold text-white">{badge}</span>
        ) : null}
        {card.headlineFallback ? (
          <span className="rounded-full border border-white/20 px-2 py-0.5 text-[11px] text-slate-300">
            {t.headlineFallback}
          </span>
        ) : null}
      </div>
      <p className={`leading-snug text-white ${theme.compact ? 'text-lg font-semibold' : 'text-xl font-black sm:text-2xl'}`}>
        {card.summary}
      </p>
      {card.windowLabel ? <p className="text-sm font-semibold text-slate-300">{card.windowLabel}</p> : null}
      {card.whatToDo.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t.whatToDo}</p>
          <ul className="space-y-1">
            {card.whatToDo.slice(0, theme.compact ? 2 : 4).map((line) => (
              <li key={line} className="text-base font-bold leading-snug text-white">
                {line}
              </li>
            ))}
          </ul>
          {card.whatToDoLocal &&
          card.whatToDoLocal.length > 0 &&
          card.whatToDoLocal.join('\n') !== card.whatToDo.join('\n') ? (
            <ul className="mt-2 space-y-1">
              {card.whatToDoLocal.slice(0, theme.compact ? 2 : 4).map((line) => (
                <li key={`local-${line}`} className="text-sm font-medium leading-snug text-slate-400">
                  {line}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {card.whyMiss && !theme.compact ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{t.whyMiss}</p>
          <p className="text-sm leading-relaxed text-slate-200">{card.whyMiss}</p>
        </div>
      ) : null}
      {card.evidence && card.evidence.some((item) => item.kind === 'buried_warning' || item.label.startsWith('묻힌 경고')) ? (
        <ul className="space-y-1">
          {card.evidence
            .filter((item) => item.kind === 'buried_warning' || item.label.startsWith('묻힌 경고'))
            .map((item) => (
              <li key={`${item.url ?? item.label}`} className="text-xs font-semibold text-amber-200">
                {item.url ? (
                  <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {item.label}
                  </a>
                ) : (
                  item.label
                )}
              </li>
            ))}
        </ul>
      ) : null}
      {card.evidence && card.evidence.some((item) => item.kind !== 'buried_warning' && !item.label.startsWith('묻힌 경고')) ? (
        <details className="group">
          <summary className="cursor-pointer text-xs font-semibold text-slate-400 hover:text-slate-200">
            {t.showEvidence}
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {card.evidence
              .filter((item) => item.kind !== 'buried_warning' && !item.label.startsWith('묻힌 경고'))
              .map((item) =>
                item.url ? (
                  <li key={item.url}>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
                      {item.label}
                    </a>
                  </li>
                ) : (
                  <li key={item.label} className="text-slate-400">
                    {item.label}
                  </li>
                ),
              )}
          </ul>
        </details>
      ) : null}
    </article>
  )
}
