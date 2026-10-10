'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { CrisisLanguageToggle } from '@/components/crisis/LanguageToggle'
import { CrisisPulseStyles } from '@/components/crisis/CrisisPulseStyles'
import { BriefingCardsSection, type BriefingCard, type UnlockedCard } from '@/components/crisis/briefing/BriefingCardsSection'
import { DangerNowSection, type DangerRegion } from '@/components/crisis/briefing/DangerNowSection'
import { EmptyBriefingState } from '@/components/crisis/briefing/EmptyBriefingState'
import { HowItWorks } from '@/components/crisis/briefing/HowItWorks'
import { WorldRiskStrip } from '@/components/crisis/briefing/WorldRiskStrip'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { useCrisisLocale } from '@/lib/crisis/i18n/use-crisis-locale'
import { supabase } from '@/lib/db/supabase'

export default function CrisisBriefingPage() {
  const { locale, t, dir, setLocale } = useCrisisLocale()
  const [ready, setReady] = useState(false)
  const [cards, setCards] = useState<BriefingCard[]>([])
  const [mapDay, setMapDay] = useState<string | null>(null)
  const [regions, setRegions] = useState<DangerRegion[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    const [briefRes, mapRes] = await Promise.all([
      authenticatedFetch(`/api/crisis/briefing?lang=${encodeURIComponent(locale)}`),
      authenticatedFetch('/api/crisis/map'),
    ])
    const briefBody = (await briefRes.json().catch(() => null)) as { cards?: BriefingCard[]; error?: string }
    if (!briefRes.ok) throw new Error(briefBody?.error ?? t.briefingLoadError)
    setCards(briefBody.cards ?? [])

    const mapBody = (await mapRes.json().catch(() => null)) as {
      day?: string
      regions?: DangerRegion[]
      error?: string
    }
    if (mapRes.ok) {
      setMapDay(mapBody.day ?? null)
      setRegions(mapBody.regions ?? [])
    }
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

  const stageCounts = useMemo(() => {
    let s5 = 0
    let s4 = 0
    let s3 = 0
    for (const row of regions) {
      if (row.stage >= 5) s5 += 1
      else if (row.stage >= 4) s4 += 1
      else if (row.stage >= 3) s3 += 1
    }
    return { s5, s4, s3 }
  }, [regions])

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
      <main className="flex min-h-screen items-center justify-center bg-[#03050c] text-slate-400" dir={dir}>
        {t.loading}
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#03050c] text-white" dir={dir}>
      <CrisisPulseStyles />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.10),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(251,113,133,0.07),transparent_40%)]" />
      <div className="relative mx-auto max-w-3xl space-y-8 px-4 py-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-300/80">{t.brand}</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">{t.briefingTitle}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CrisisLanguageToggle locale={locale} onChange={setLocale} label={t.languageToggle} />
            <Link
              href="/crisis"
              className="rounded-xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
            >
              ← {t.backToMap}
            </Link>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        <WorldRiskStrip t={t} day={mapDay} stage5={stageCounts.s5} stage4={stageCounts.s4} stage3={stageCounts.s3} />

        <DangerNowSection t={t} locale={locale} regions={regions} />

        {cards.length === 0 ? (
          <EmptyBriefingState t={t} />
        ) : (
          <BriefingCardsSection t={t} cards={cards} busy={busy} onUnlock={(runId) => void unlock(runId)} />
        )}

        <HowItWorks t={t} />
      </div>
    </main>
  )
}
