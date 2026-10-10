'use client'

import { HazardIconRow } from '@/components/crisis/HazardIcon'
import { SeverityCard } from '@/components/crisis/SeverityCard'
import { CRISIS_BRIEF_CREDITS } from '@/lib/crisis/credits'
import { stageBannerText, type CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import { hazardIconsFor } from '@/lib/crisis/ui/hazards'
import { severityTheme } from '@/lib/crisis/ui/severity'

export type LockedCard = {
  runId: string
  regionName: string
  country: string
  locked: true
  headline_ko: string
  stage: number
  headline_fallback?: boolean
  novelty?: { only_us: number; also_seen_elsewhere: number }
  tierCounts?: { headlines: number; missed: number; baseline: number }
  teaser?: string
  hazards?: string[]
}

export type HypothesisRow = {
  title: string
  novelty: string
  noveltyBadge: string | null
  stage: number
  possibility: string
  why_humans_miss: string
  what_to_do_ko: string[]
  what_to_do_local?: string[]
  official_links: Array<{ label: string; url: string }>
  evidence: Array<{ ref: string; url?: string }>
  hazards?: string[]
  regions?: Array<{ name: string }>
}

export type UnlockedCard = {
  runId: string
  regionName: string
  country: string
  locked: false
  headline_ko: string
  summary_ko: string
  stage: number
  headline_fallback?: boolean
  headlines: HypothesisRow[]
  missed_by_others: HypothesisRow[]
  baseline_risks: Array<{
    title: string
    stage: number
    possibility: string
    what_to_do: string[]
    what_to_do_local?: string[]
    reason?: string
    regions?: Array<{ name: string }>
  }>
  novelty: { only_us: number; also_seen_elsewhere: number }
  evidence: string[]
  zoneKey?: string
  crossBorder?: Array<{ title: string; from_region: string; to_region: string; link: string }>
  intraZone?: Array<{ title: string; from_region: string; to_region: string; link: string }>
}

export type BriefingCard = LockedCard | UnlockedCard

type Props = {
  t: CrisisUiPack
  cards: BriefingCard[]
  busy: string | null
  onUnlock: (runId: string) => void
}

export function BriefingCardsSection({ t, cards, busy, onUnlock }: Props) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-black tracking-tight text-white">AI 브리핑</h2>
        <p className="text-xs text-slate-500">{t.briefingSubtitle(CRISIS_BRIEF_CREDITS)}</p>
      </div>
      <div className="space-y-4">
        {cards.map((card) =>
          card.locked ? (
            <LockedView key={card.runId} card={card} t={t} busy={busy} onUnlock={() => onUnlock(card.runId)} />
          ) : (
            <UnlockedCardView key={card.runId} card={card} t={t} />
          ),
        )}
      </div>
    </section>
  )
}

function LockedView({
  card,
  t,
  busy,
  onUnlock,
}: {
  card: LockedCard
  t: CrisisUiPack
  busy: string | null
  onUnlock: () => void
}) {
  const theme = severityTheme(card.stage)
  const icons = hazardIconsFor(card.hazards ?? [])
  return (
    <article
      className={`overflow-hidden rounded-2xl ${theme.pulseBorder ? 'crisis-pulse-border' : ''}`}
      style={{ background: theme.bg, border: `2px solid ${theme.border}` }}
    >
      <div className="px-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-lg px-2 py-0.5 text-[11px] font-black"
            style={{ background: theme.bannerBg, color: theme.color }}
          >
            {stageBannerText(card.stage, t)}
          </span>
          <HazardIconRow kinds={icons} color={theme.color} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {card.regionName} / {card.country}
        </p>
        <h3 className="mt-1 text-xl font-black leading-snug text-white">{card.headline_ko}</h3>
        {card.headline_fallback ? (
          <p className="mt-1 text-xs text-slate-400">{t.headlineFallback}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {card.novelty && card.novelty.only_us > 0 ? (
            <span className="rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[11px] font-black text-cyan-200">
              {t.onlyUs} {card.novelty.only_us}
            </span>
          ) : null}
          {card.tierCounts ? (
            <span className="text-xs font-semibold text-slate-400">
              {t.lockedInside(card.tierCounts.headlines, card.tierCounts.missed, card.tierCounts.baseline)}
            </span>
          ) : null}
        </div>
      </div>

      {/* Blurred teaser */}
      <div className="relative mt-3 border-t border-white/10 px-4 py-4">
        <div className="pointer-events-none select-none blur-[6px]" aria-hidden>
          <p className="text-sm font-bold leading-relaxed text-slate-200">{card.teaser ?? t.lockedTeaser}</p>
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <button
            type="button"
            onClick={onUnlock}
            disabled={busy !== null}
            className="rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-cyan-600/30 hover:bg-cyan-500 disabled:opacity-50"
          >
            {busy === card.runId ? t.unlocking : t.unlock(CRISIS_BRIEF_CREDITS)}
          </button>
        </div>
      </div>
    </article>
  )
}

export function UnlockedCardView({ card, t }: { card: UnlockedCard; t: CrisisUiPack }) {
  const theme = severityTheme(card.stage)
  return (
    <article className="space-y-4">
      <div
        className={`rounded-2xl px-4 py-4 ${theme.pulseBorder ? 'crisis-pulse-border' : ''}`}
        style={{ background: theme.bg, border: `2px solid ${theme.border}` }}
      >
        <div className="mb-3 rounded-xl px-3 py-2 text-sm font-black" style={{ background: theme.bannerBg, color: theme.color }}>
          {stageBannerText(card.stage, t)}
        </div>
        <p className="text-xs text-slate-500">
          {card.regionName} / {card.country}
        </p>
        <h3 className="mt-1 text-2xl font-black leading-snug text-white">{card.headline_ko}</h3>
        <p className="mt-2 text-lg font-semibold leading-snug text-slate-100">{card.summary_ko}</p>
        <p className="mt-2 text-xs text-slate-400">{t.noveltyLine(card.novelty.only_us, card.novelty.also_seen_elsewhere)}</p>
      </div>

      <Tier title={t.headlines} rows={card.headlines} t={t} />
      <Tier title={t.missedByOthers} rows={card.missed_by_others} t={t} />
      {card.zoneKey ? (
        <>
          <BorderLinks title={t.intraRegionLinks} rows={card.intraZone ?? []} empty={t.none} />
          <BorderLinks title={t.borderLinks} rows={card.crossBorder ?? []} empty={t.none} />
        </>
      ) : null}

      <section>
        <h3 className="mb-2 text-sm font-black text-slate-300">{t.baselineRisks}</h3>
        <div className="space-y-3">
          {card.baseline_risks.map((row) => (
            <div key={row.title} className="space-y-1">
              {row.regions && row.regions.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {row.regions.map((region) => (
                    <span key={region.name} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-slate-300">
                      {region.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <SeverityCard
                t={t}
                card={{
                  stage: row.stage,
                  summary: row.title,
                  whatToDo: row.what_to_do,
                  whatToDoLocal: row.what_to_do_local,
                  whyMiss: row.reason,
                }}
              />
            </div>
          ))}
        </div>
      </section>

      {card.evidence.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-slate-400">{t.showEvidence}</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {card.evidence.slice(0, 12).map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  )
}

function BorderLinks({
  title,
  rows,
  empty,
}: {
  title: string
  rows: Array<{ title: string; from_region: string; to_region: string; link: string }>
  empty: string
}) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-black text-slate-300">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={`${row.title}-${row.from_region}-${row.to_region}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm">
              <p className="font-semibold text-white">
                {row.from_region} → {row.to_region}
              </p>
              <p className="text-slate-300">{row.title}</p>
              <p className="text-xs text-slate-400">{row.link}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Tier({ title, rows, t }: { title: string; rows: HypothesisRow[]; t: CrisisUiPack }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-black text-slate-300">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t.none}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.title} className="space-y-1">
              {row.regions && row.regions.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {row.regions.map((region) => (
                    <span key={region.name} className="rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-slate-300">
                      {region.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <SeverityCard
                t={t}
                card={{
                  stage: row.stage,
                  summary: row.title,
                  whatToDo: row.what_to_do_ko,
                  whatToDoLocal: row.what_to_do_local,
                  whyMiss: row.why_humans_miss,
                  novelty: row.novelty,
                  hazards: row.hazards,
                  possibility: row.possibility,
                  evidence: [
                    ...row.official_links.map((link) => ({ label: link.label, url: link.url })),
                    ...row.evidence.filter((item) => item.url).map((item) => ({ label: item.ref, url: item.url })),
                  ],
                }}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
