'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { ModuleCreditsLink } from '@/components/credits/ModuleCreditsLink'
import { FreeformPromptBox } from '@/components/league/FreeformPromptBox'
import { PredictionCard } from '@/components/league/PredictionCard'
import { DeepAnalysis } from '@/components/league/DeepAnalysis'
import { Leaderboard } from '@/components/league/Leaderboard'
import { RecordRoom } from '@/components/league/RecordRoom'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import type { CardData, ColorBucket, LockedCardPayload } from '@/lib/league/card-types'
import { GENERATION_POLL_MS } from '@/lib/league/generation/policy'
import { defaultCatalogCategoryId, type CatalogKind, type PublicCategoryId } from '@/lib/league/catalog'
import { SIGNUP_COUNTRY_CODES, getSignupCountryLabel } from '@/lib/league/jurisdiction/signup-countries'
import { UI_HORIZONS, type UiHorizon } from '@/lib/league/horizon'
import type { LeaderboardData } from '@/lib/league/leaderboard-aggregate'
import type { RecordRoomPage } from '@/lib/league/record-room-aggregate'
import { isLockedViewPayload, RECORD_ROOM_PURCHASE_ROUND_LIMIT } from '@/lib/league/view-purchase-policy'

export type LeagueHubTab = 'cards' | 'leaderboard' | 'recordRoom'

type PublicCatalogCategory = {
  id: PublicCategoryId
  ledgerCategory: string
  tone: ColorBucket
  kind: CatalogKind
  promptAllowed: boolean
  mixedResolutionClocks: boolean
  instruments: { instrument: string }[]
}

type InstrumentsPayload = {
  categories?: PublicCatalogCategory[]
  jurisdiction?: { declaredMissing?: boolean; mismatch?: boolean }
}

/**
 * The PUBLIC (logged-in, non-admin) league surface.
 *
 * Mobile-first: a tab strip, then one panel. On a wide viewport the board
 * uses the full `max-w-7xl` width (division grid), not a centered phone
 * column. Everything it
 * renders is an existing component — `PredictionCard`, `Leaderboard`,
 * `RecordRoom`, each already wrapped in `CardCompliance` (disclaimer +
 * approved phrasing) and already locale-aware through `useLeagueLocale`. This
 * file adds no new card chrome and no new compliance surface of its own.
 *
 * PAID VIEW (2026-09-14): opening a round costs a fixed credit price — the
 * same price whether the press creates the round or unlocks one that already
 * exists, and access is permanent once paid. The server decides locked vs
 * full (`GET /api/league/card` returns a `LockedCardPayload` until this user
 * has paid); this component renders whichever came back and POSTs
 * `/api/league/generate` on the unlock press. While the background job runs,
 * the card is POLLED every few seconds — tiles fill as model rows land, and
 * a locked screen / closed tab / network change costs nothing: reopening
 * re-reads the same server state and resumes.
 *
 * Freeform input sits under the category chips. The gateway composes a
 * catalog proposition; it never forwards the user's sentence to the models.
 */
export function PublicLeagueHub({ initialTab = 'cards' }: { initialTab?: LeagueHubTab }) {
  const { t, dir } = useLeagueLocale()
  const [tab, setTab] = useState<LeagueHubTab>(initialTab)

  return (
    <div dir={dir} className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 bg-slate-50 px-3 pb-16 pt-3 sm:px-6">
      <header className="flex items-center justify-between gap-2">
        <Link
          href="/"
          aria-label="Home"
          className="inline-flex items-center rounded-full bg-white px-3 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-100"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Link>
        <ModuleCreditsLink className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50" />
      </header>

      <div>
        <h1 className="text-xl font-bold text-slate-900">{t.hub.title}</h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-600">{t.hub.subtitle}</p>
      </div>

      <nav className="flex gap-1 rounded-full bg-white p-1 shadow-sm" aria-label={t.hub.title}>
        {(['cards', 'leaderboard', 'recordRoom'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key}
            className={`flex-1 rounded-full px-2 py-2 text-xs font-semibold transition ${
              tab === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {t.hub.tabs[key]}
          </button>
        ))}
      </nav>

      {tab === 'cards' ? <CardsPanel /> : null}
      {tab === 'leaderboard' ? <LeaderboardPanel /> : null}
      {tab === 'recordRoom' ? <RecordRoomPanel /> : null}
    </div>
  )
}

/** What the card slot is currently showing. The server decides locked vs full. */
type CardView =
  | { kind: 'loading' }
  | { kind: 'card'; card: CardData }
  | { kind: 'locked'; locked: LockedCardPayload }
  | { kind: 'blocked' }
  | { kind: 'none' }
  | { kind: 'error' }

function CardsPanel() {
  const { t, locale } = useLeagueLocale()
  const [categories, setCategories] = useState<PublicCatalogCategory[] | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<PublicCategoryId | null>(null)
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null)
  // Horizon selector next to the instrument chips. Default '1d' — every
  // instrument opens on the 1-day card first.
  const [horizon, setHorizon] = useState<UiHorizon>('1d')
  const [view, setView] = useState<CardView>({ kind: 'loading' })
  const [declaredMissing, setDeclaredMissing] = useState(false)
  const [countryMismatch, setCountryMismatch] = useState(false)
  // Guards against a slower, now-superseded fetch overwriting the result of a
  // later one (e.g. clicking two instruments/horizons in quick succession).
  const requestIdRef = useRef(0)

  // The SERVER'S response is the only decision this panel trusts — locked vs
  // full card, jurisdiction, everything. `quiet` polls (while a generation
  // job runs) skip the loading flash but share the same supersede guard.
  const loadCard = useCallback(
    async (instrument: string, horizonArg: UiHorizon, opts?: { quiet?: boolean }) => {
      const requestId = (requestIdRef.current += 1)
      if (!opts?.quiet) setView({ kind: 'loading' })
      try {
        const res = await fetch(
          `/api/league/card?instrument=${encodeURIComponent(instrument)}&horizon=${encodeURIComponent(horizonArg)}`,
          { credentials: 'include' }
        )
        const body = (await res.json()) as
          | CardData
          | LockedCardPayload
          | { error: string; code?: string }
        if (requestId !== requestIdRef.current) return
        if (!res.ok) {
          if ('code' in body && body.code === 'jurisdiction_blocked') {
            setView({ kind: 'blocked' })
          } else if (res.status === 404 || ('code' in body && body.code === 'no_round')) {
            setView({ kind: 'none' })
          } else {
            setView({ kind: 'error' })
          }
          return
        }
        if ('locked' in body && body.locked) {
          setView({ kind: 'locked', locked: body })
          return
        }
        setView({ kind: 'card', card: body as CardData })
      } catch {
        if (requestId === requestIdRef.current && !opts?.quiet) setView({ kind: 'error' })
      }
    },
    []
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/league/instruments', { credentials: 'include' })
        const body = (await res.json()) as InstrumentsPayload
        if (cancelled) return
        const list = body.categories ?? []
        setDeclaredMissing(Boolean(body.jurisdiction?.declaredMissing))
        setCountryMismatch(Boolean(body.jurisdiction?.mismatch))
        setCategories(list)
        const firstId = defaultCatalogCategoryId(list)
        setSelectedCategory(firstId)
        const firstCat = list.find((c) => c.id === firstId)
        const firstInstrument = firstCat?.instruments[0]?.instrument ?? null
        setSelectedInstrument(firstInstrument)
        if (firstInstrument) {
          void loadCard(firstInstrument, '1d')
        } else {
          setView({ kind: 'none' })
        }
      } catch {
        if (!cancelled) {
          setCategories([])
          setView({ kind: 'error' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadCard])

  // POLL while a background generation job is queued/running. Survives locked
  // screens and closed tabs by construction: the job runs server-side, and
  // every poll (including the first one after reopening this page) re-reads
  // the whole state from the DB. Also self-heals on tab foregrounding.
  const generationStatus =
    view.kind === 'card' ? view.card.generation?.status ?? null : null
  useEffect(() => {
    if (!selectedInstrument) return
    if (generationStatus !== 'queued' && generationStatus !== 'running') return
    const id = window.setInterval(() => {
      void loadCard(selectedInstrument, horizon, { quiet: true })
    }, GENERATION_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadCard(selectedInstrument, horizon, { quiet: true })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [generationStatus, selectedInstrument, horizon, loadCard])

  function selectCategory(id: PublicCategoryId) {
    if (!categories) return
    const next = categories.find((c) => c.id === id)
    setSelectedCategory(id)
    if (!next || next.kind === 'coming_soon' || next.instruments.length === 0) {
      setSelectedInstrument(null)
      setView({ kind: 'none' })
      return
    }
    const first = next.instruments[0]!.instrument
    setSelectedInstrument(first)
    void loadCard(first, horizon)
  }

  // A plain click handler, not a `[selected]`-keyed effect: re-clicking the
  // ALREADY-selected instrument must still fire a fresh fetch.
  function selectInstrument(instrument: string) {
    setSelectedInstrument(instrument)
    void loadCard(instrument, horizon)
  }

  // Switching horizon loads THAT horizon's round for the currently selected
  // instrument — a genuinely different round (separate resolves_at), never a
  // reinterpretation of the one just shown.
  function selectHorizon(next: UiHorizon) {
    if (next === horizon) return
    setHorizon(next)
    if (!selectedInstrument) return
    void loadCard(selectedInstrument, next)
  }

  if (categories === null) return <PanelMessage text={t.hub.loading} />
  if (categories.length === 0) return <PanelMessage text={t.hub.noInstruments} />

  const active = categories.find((c) => c.id === selectedCategory) ?? null

  return (
    <div className="flex flex-col gap-3">
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => selectCategory(c.id)}
            aria-current={selectedCategory === c.id}
            className={categoryChipClass(c.tone, selectedCategory === c.id)}
          >
            {t.catalog.categories[c.id]}
          </button>
        ))}
      </div>

      {declaredMissing ? (
        <DeclaredCountryForm
          onSaved={() => {
            setDeclaredMissing(false)
            window.location.reload()
          }}
        />
      ) : null}
      {countryMismatch && !declaredMissing ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {t.gating.countryMismatchNotice}
        </p>
      ) : null}

      {selectedCategory && active?.promptAllowed ? (
        <FreeformPromptBox
          categoryId={selectedCategory}
          onPickInstrument={(instrument) => {
            setSelectedInstrument(instrument)
            void loadCard(instrument, horizon)
          }}
          onRoundOpened={(instrument, nextHorizon) => {
            setHorizon(nextHorizon)
            setSelectedInstrument(instrument)
            void loadCard(instrument, nextHorizon)
          }}
        />
      ) : null}

      {active?.kind === 'coming_soon' ? (
        <ComingSoonPanel categoryId={active.id} />
      ) : null}

      {active?.kind === 'instruments' ? (
        <div className="flex flex-wrap gap-1.5">
          {active.instruments.map((i) => {
            const selected = selectedInstrument === i.instrument
            return (
              <button
                key={i.instrument}
                type="button"
                onClick={() => selectInstrument(i.instrument)}
                aria-current={selected}
                className={`rounded-xl px-3 py-2 text-left text-xs font-semibold transition ${
                  selected ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100'
                }`}
              >
                <span className="block text-sm">{instrumentLabel(t, i.instrument)}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {active?.kind === 'instruments' && active.mixedResolutionClocks ? (
        <p className="text-[11px] leading-relaxed text-slate-500">{t.catalog.spotVsEtfNote}</p>
      ) : null}

      {active?.kind === 'instruments' ? (
        <div className="flex gap-1.5" role="group" aria-label="Horizon">
          {UI_HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => selectHorizon(h)}
              aria-current={horizon === h}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                horizon === h ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100'
              }`}
            >
              {t.catalog.horizons[h]}
            </button>
          ))}
        </div>
      ) : null}

      {active?.kind === 'instruments' && view.kind === 'loading' ? (
        <PanelMessage text={t.hub.loading} />
      ) : null}
      {active?.kind === 'instruments' && view.kind === 'blocked' ? (
        <PanelMessage text={t.gating.unavailable} />
      ) : null}
      {active?.kind === 'instruments' && view.kind === 'none' ? (
        <PanelMessage text={t.catalog.noCardYet} />
      ) : null}
      {active?.kind === 'instruments' && view.kind === 'error' ? (
        <PanelMessage text={t.hub.genericError} tone="error" />
      ) : null}

      {active?.kind === 'instruments' && view.kind === 'locked' && selectedInstrument ? (
        <LockedRoundPanel
          locked={view.locked}
          instrument={selectedInstrument}
          horizon={horizon}
          locale={locale}
          onOpened={() => void loadCard(selectedInstrument, horizon)}
        />
      ) : null}

      {active?.kind === 'instruments' && view.kind === 'card' && selectedInstrument ? (
        <>
          <GenerationBanner
            card={view.card}
            locale={locale}
            onRetried={() => void loadCard(selectedInstrument, horizon)}
          />
          <PredictionCard key={view.card.round.round_id} initialData={view.card} />
          <DeepAnalysis
            roundId={view.card.round.round_id}
            category={view.card.round.category}
            colorBucket={view.card.round.color_bucket}
          />
        </>
      ) : null}
    </div>
  )
}

/**
 * The single paid affordance. One identical panel whether the round already
 * exists, is mid-generation by someone else, or has never been opened — the
 * price and the copy never say which (that asymmetry is server-enforced: the
 * locked payload simply doesn't carry the information). Errors never lock
 * the button: `busy` resets on every response, so a failed press is always
 * retryable, and the server side guarantees a retry can't double-charge.
 */
function LockedRoundPanel({
  locked,
  instrument,
  horizon,
  locale,
  onOpened,
}: {
  locked: LockedCardPayload
  instrument: string
  horizon: UiHorizon
  locale: string
  onOpened: () => void
}) {
  const { t } = useLeagueLocale()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function open() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/league/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instrument, horizon, locale }),
      })
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as
          | { balance?: number; required?: number; code?: string }
          | null
        if (res.status === 402) {
          setNotice(t.hub.insufficientCredits(detail?.required ?? locked.price, detail?.balance ?? 0))
        } else if (res.status === 429) {
          setNotice(t.hub.rateLimited)
        } else if (res.status === 503 && detail?.code === 'busy') {
          setNotice(t.hub.generationBusy)
        } else if (res.status === 503 && detail?.code === 'market_data_unavailable') {
          setNotice(t.hub.marketDataUnavailable)
        } else if (res.status === 403) {
          setNotice(t.gating.unavailable)
        } else {
          setNotice(t.hub.genericError)
        }
        return
      }
      onOpened()
    } catch {
      setNotice(t.hub.genericError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6">
      <p className="text-sm font-semibold leading-relaxed text-slate-900">{locked.round.proposition_text}</p>
      {locked.refundedNotice ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          {t.hub.generationFailedRefunded}
        </p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void open()}
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50 md:max-w-sm"
      >
        {busy ? t.hub.openingRound : t.hub.openRound(locked.price)}
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{t.hub.openRoundNote}</p>
      {notice ? <p className="mt-3 text-xs text-rose-700">{notice}</p> : null}
    </div>
  )
}

/**
 * Progress / failure strip above an unlocked card while its job runs. Tiles
 * below fill on every poll; this line names the number. A FAILED job renders
 * the refund state and a retry that can never double-charge: with access
 * still held the retry is free; after a refund the server returns the locked
 * panel again and a retry is a fresh purchase — either way this button is
 * enabled, never stuck.
 */
function GenerationBanner({
  card,
  locale,
  onRetried,
}: {
  card: CardData
  locale: string
  onRetried: () => void
}) {
  const { t } = useLeagueLocale()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const generation = card.generation

  if (!generation || generation.status !== 'failed') return null

  async function retry() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await fetch('/api/league/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId: card.round.round_id, locale }),
      })
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { code?: string } | null
        setNotice(
          res.status === 503 && detail?.code === 'busy'
            ? t.hub.generationBusy
            : res.status === 503 && detail?.code === 'market_data_unavailable'
              ? t.hub.marketDataUnavailable
              : t.hub.genericError
        )
        return
      }
      onRetried()
    } catch {
      setNotice(t.hub.genericError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
      <p className="text-xs leading-relaxed text-amber-900">
        {generation.refunded ? t.hub.generationFailedRefunded : t.hub.generationFailed}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void retry()}
        className="mt-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-sm disabled:opacity-50"
      >
        {busy ? t.hub.openingRound : t.hub.retryGeneration}
      </button>
      {notice ? <p className="mt-2 text-xs text-rose-700">{notice}</p> : null}
    </div>
  )
}

function DeclaredCountryForm({ onSaved }: { onSaved: () => void }) {
  const { t, locale } = useLeagueLocale()
  const [country, setCountry] = useState('KR')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/league/declared-country', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ country }),
      })
      if (!res.ok) {
        setError(t.hub.genericError)
        return
      }
      onSaved()
    } catch {
      setError(t.hub.genericError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
      <p className="text-xs font-semibold text-amber-950">{t.gating.registeredCountryLabel}</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-900">{t.gating.registeredCountryRequired}</p>
      <div className="mt-2 flex gap-2">
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          disabled={busy}
          className="min-h-[40px] flex-1 rounded-xl border border-amber-200 bg-white px-3 text-xs text-slate-900"
        >
          {SIGNUP_COUNTRY_CODES.map((code) => (
            <option key={code} value={code} className="bg-white text-slate-900">
              {getSignupCountryLabel(code, locale)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-50"
        >
          {t.gating.registeredCountrySave}
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </div>
  )
}

function ComingSoonPanel({ categoryId }: { categoryId: PublicCategoryId }) {
  const { t } = useLeagueLocale()
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
      <p className="text-sm font-semibold text-slate-800">{t.catalog.comingSoon}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{t.catalog.comingSoonHint}</p>
      {categoryId === 'macro_econ' ? (
        <p className="mt-2 text-xs leading-relaxed text-slate-600">{t.catalog.macroEconHint}</p>
      ) : null}
    </div>
  )
}

function instrumentLabel(t: { catalog: { instruments: Record<string, string> } }, instrument: string): string {
  return t.catalog.instruments[instrument] ?? instrument
}

function categoryChipClass(tone: ColorBucket, selected: boolean): string {
  const base = 'shrink-0 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold transition min-h-[44px]'
  if (tone === 'green') {
    return selected ? `${base} bg-emerald-600 text-white` : `${base} bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100`
  }
  if (tone === 'yellow') {
    return selected ? `${base} bg-amber-500 text-white` : `${base} bg-amber-50 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100`
  }
  return selected ? `${base} bg-rose-600 text-white` : `${base} bg-rose-50 text-rose-800 ring-1 ring-rose-200 hover:bg-rose-100`
}

function LeaderboardPanel() {
  const { t } = useLeagueLocale()
  const [data, setData] = useState<LeaderboardData | null>(null)
  const [locked, setLocked] = useState<{ required: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buying, setBuying] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/league/leaderboard', { credentials: 'include' })
    const body = (await res.json()) as LeaderboardData | { error: string }
    if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
    if (isLockedViewPayload(body)) {
      setLocked({ required: body.required })
      setData(null)
      return
    }
    setLocked(null)
    setData(body as LeaderboardData)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await load()
      } catch {
        if (!cancelled) setError('load_failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const unlock = useCallback(async () => {
    setBuying(true)
    setError(null)
    try {
      const res = await fetch('/api/league/leaderboard', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      const body = (await res.json()) as LeaderboardData | { error: string; required?: number; balance?: number }
      if (res.status === 402 && 'required' in body && 'balance' in body && body.required != null && body.balance != null) {
        throw new Error(t.leaderboard.insufficientCredits(body.required, body.balance))
      }
      if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
      if (isLockedViewPayload(body)) throw new Error(t.hub.genericError)
      setLocked(null)
      setData(body as LeaderboardData)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'load_failed')
    } finally {
      setBuying(false)
    }
  }, [t.hub.genericError, t.leaderboard])

  if (error && !locked && !data) return <PanelMessage text={error === 'load_failed' ? t.hub.genericError : error} tone="error" />
  if (locked) {
    return (
      <UnlockPanel
        title={t.leaderboard.unlock(locked.required)}
        note={t.leaderboard.unlockNote}
        busy={buying}
        busyLabel={t.leaderboard.unlocking}
        error={error}
        onUnlock={() => void unlock()}
      />
    )
  }
  if (!data) return <PanelMessage text={t.hub.loading} />
  return <Leaderboard data={data} />
}

function RecordRoomPanel() {
  const { t } = useLeagueLocale()
  const [data, setData] = useState<RecordRoomPage | null>(null)
  const [locked, setLocked] = useState<{ required: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [buying, setBuying] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/league/record-room?page=1&pageSize=20', { credentials: 'include' })
    const body = (await res.json()) as RecordRoomPage | { error: string }
    if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
    if (isLockedViewPayload(body)) {
      setLocked({ required: body.required })
      setData(null)
      return
    }
    setLocked(null)
    setData(body as RecordRoomPage)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await load()
      } catch {
        if (!cancelled) setError('load_failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  const purchase = useCallback(
    async (refresh: boolean) => {
      setBuying(true)
      setError(null)
      try {
        const res = await fetch('/api/league/record-room', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh }),
        })
        const body = (await res.json()) as RecordRoomPage | { error: string; required?: number; balance?: number }
        if (res.status === 402 && 'required' in body && 'balance' in body && body.required != null && body.balance != null) {
          throw new Error(t.recordRoom.insufficientCredits(body.required, body.balance))
        }
        if (!res.ok) throw new Error('error' in body ? body.error : `request failed (${res.status})`)
        if (isLockedViewPayload(body)) throw new Error(t.hub.genericError)
        setLocked(null)
        setData(body as RecordRoomPage)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'load_failed')
      } finally {
        setBuying(false)
      }
    },
    [t.hub.genericError, t.recordRoom]
  )

  if (error && !locked && !data) return <PanelMessage text={error === 'load_failed' ? t.hub.genericError : error} tone="error" />
  if (locked) {
    return (
      <UnlockPanel
        title={t.recordRoom.unlock(locked.required)}
        note={t.recordRoom.unlockNote(RECORD_ROOM_PURCHASE_ROUND_LIMIT)}
        busy={buying}
        busyLabel={t.recordRoom.unlocking}
        error={error}
        onUnlock={() => void purchase(false)}
      />
    )
  }
  if (!data) return <PanelMessage text={t.hub.loading} />
  return (
    <RecordRoom
      key={data.window?.asOf ?? data.generatedAt}
      initialData={data}
      refreshing={buying}
      onRefreshWindow={() => void purchase(true)}
    />
  )
}

function UnlockPanel({
  title,
  note,
  busy,
  busyLabel,
  error,
  onUnlock,
}: {
  title: string
  note: string
  busy: boolean
  busyLabel: string
  error: string | null
  onUnlock: () => void
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center">
      <p className="text-xs leading-relaxed text-slate-600">{note}</p>
      {error ? <p className="mt-2 text-[11px] text-rose-600">{error}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={onUnlock}
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50"
      >
        {busy ? busyLabel : title}
      </button>
    </div>
  )
}

function PanelMessage({ text, tone = 'muted' }: { text: string; tone?: 'muted' | 'error' }) {
  return (
    <p
      className={`rounded-2xl border border-dashed px-4 py-6 text-center text-xs ${
        tone === 'error' ? 'border-rose-300 text-rose-600' : 'border-slate-300 text-slate-500'
      }`}
    >
      {text}
    </p>
  )
}
