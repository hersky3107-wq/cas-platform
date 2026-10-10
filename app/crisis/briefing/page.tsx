'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { CrisisLanguageToggle } from '@/components/crisis/LanguageToggle'
import { CrisisPulseStyles } from '@/components/crisis/CrisisPulseStyles'
import { SeverityCard } from '@/components/crisis/SeverityCard'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { CRISIS_BRIEF_CREDITS } from '@/lib/crisis/credits'
import { stageBannerText, type CrisisUiPack } from '@/lib/crisis/i18n/dictionary'
import { useCrisisLocale } from '@/lib/crisis/i18n/use-crisis-locale'
import { severityTheme } from '@/lib/crisis/ui/severity'
import { supabase } from '@/lib/db/supabase'

type LockedCard = {
  runId: string
  regionName: string
  country: string
  locked: true
  headline_ko: string
  stage: number
  headline_fallback?: boolean
}

type HypothesisRow = {
  title: string
  novelty: string
  noveltyBadge: string | null
  stage: number
  possibility: string
  why_humans_miss: string
  what_to_do_ko: string[]
  official_links: Array<{ label: string; url: string }>
  evidence: Array<{ ref: string; url?: string }>
  hazards?: string[]
}

type UnlockedCard = {
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
  baseline_risks: Array<{ title: string; stage: number; possibility: string; what_to_do: string[]; reason?: string }>
  novelty: { only_us: number; also_seen_elsewhere: number }
  evidence: string[]
}

type Card = LockedCard | UnlockedCard

export default function CrisisBriefingPage() {
  const { locale, t, dir, setLocale } = useCrisisLocale()
  const [ready, setReady] = useState(false)
  const [cards, setCards] = useState<Card[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    const res = await authenticatedFetch(`/api/crisis/briefing?lang=${encodeURIComponent(locale)}`)
    const body = (await res.json().catch(() => null)) as { cards?: Card[]; error?: string }
    if (!res.ok) throw new Error(body?.error ?? t.briefingLoadError)
    setCards(body.cards ?? [])
  }

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        window.location.href = `/auth?redirectTo=${encodeURIComponent('/crisis/briefing')}`
        return
      }
      setReady(true)
      try {
        await load()
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t.briefingLoadError)
      }
    })()
    // First auth+load; locale changes refetch below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!ready) return
    void load().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : t.briefingLoadError)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale])

  async function unlock(runId: string) {
    if (busy) return
    setBusy(runId)
    setError(null)
    try {
      const res = await authenticatedFetch('/api/crisis/briefing', { method: 'POST', json: { runId } })
      const body = (await res.json().catch(() => null)) as { card?: UnlockedCard; error?: string }
      if (res.status === 402) throw new Error(t.notEnoughCredits)
      if (!res.ok) throw new Error(body?.error ?? t.unlockFailed)
      if (body.card) {
        setCards((prev) => prev.map((card) => (card.runId === runId ? body.card! : card)))
      } else {
        await load()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t.unlockFailed)
    } finally {
      setBusy(null)
    }
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0f1e] text-slate-400" dir={dir}>
        {t.loading}
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-white" dir={dir}>
      <CrisisPulseStyles />
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">{t.brand}</p>
            <h1 className="text-3xl font-black">{t.briefingTitle}</h1>
            <p className="mt-1 text-sm text-slate-400">{t.briefingSubtitle(CRISIS_BRIEF_CREDITS)}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CrisisLanguageToggle locale={locale} onChange={setLocale} label={t.languageToggle} />
            <Link href="/crisis" className="rounded-xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-slate-200">
              ← {t.backToMap}
            </Link>
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        {cards.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-10 text-center text-sm text-slate-400">
            {t.noCards}
          </p>
        ) : (
          <div className="space-y-4">
            {cards.map((card) =>
              card.locked ? (
                <LockedView key={card.runId} card={card} t={t} busy={busy} onUnlock={() => void unlock(card.runId)} />
              ) : (
                <UnlockedView key={card.runId} card={card} t={t} />
              ),
            )}
          </div>
        )}
      </div>
    </main>
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
  return (
    <article
      className={`rounded-2xl px-4 py-4 ${theme.pulseBorder ? 'crisis-pulse-border' : ''}`}
      style={{ background: theme.bg, border: `2px solid ${theme.border}` }}
    >
      <div className="mb-3 rounded-xl px-3 py-2 text-sm font-black" style={{ background: theme.bannerBg, color: theme.color }}>
        {stageBannerText(card.stage, t)}
      </div>
      <p className="text-xs text-slate-500">
        {card.regionName} / {card.country}
      </p>
      <h2 className="mt-1 text-xl font-black leading-snug">{card.headline_ko}</h2>
      {card.headline_fallback ? (
        <p className="mt-1 text-xs text-slate-400">{t.headlineFallback}</p>
      ) : null}
      <button
        type="button"
        onClick={onUnlock}
        disabled={busy !== null}
        className="mt-3 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
      >
        {busy === card.runId ? t.unlocking : t.unlock(CRISIS_BRIEF_CREDITS)}
      </button>
    </article>
  )
}

function UnlockedView({ card, t }: { card: UnlockedCard; t: CrisisUiPack }) {
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
        <h2 className="mt-1 text-2xl font-black leading-snug">{card.headline_ko}</h2>
        <p className="mt-2 text-lg font-semibold leading-snug text-white">{card.summary_ko}</p>
        <p className="mt-2 text-xs text-slate-400">{t.noveltyLine(card.novelty.only_us, card.novelty.also_seen_elsewhere)}</p>
      </div>

      <Tier title={t.headlines} rows={card.headlines} t={t} />
      <Tier title={t.missedByOthers} rows={card.missed_by_others} t={t} />

      <section>
        <h3 className="mb-2 text-sm font-black text-slate-300">{t.baselineRisks}</h3>
        <div className="space-y-3">
          {card.baseline_risks.map((row) => (
            <SeverityCard
              key={row.title}
              t={t}
              card={{
                stage: row.stage,
                summary: row.title,
                whatToDo: row.what_to_do,
                whyMiss: row.reason,
              }}
            />
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

function Tier({ title, rows, t }: { title: string; rows: HypothesisRow[]; t: CrisisUiPack }) {
  return (
    <section>
      <h3 className="mb-2 text-sm font-black text-slate-300">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t.none}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <SeverityCard
              key={row.title}
              t={t}
              card={{
                stage: row.stage,
                summary: row.title,
                whatToDo: row.what_to_do_ko,
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
          ))}
        </div>
      )}
    </section>
  )
}
