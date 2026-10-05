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
import {
  defaultCatalogCategoryId,
  isFreeformSearchCategory,
  usesHorizonChipRow,
  type CatalogKind,
  type PublicCategoryId,
} from '@/lib/league/catalog'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import { rankedPropositionDisplay } from '@/lib/league/card-header-copy'
import { sportsVsLabel } from '@/lib/league/sports-display'
import { propertyInstrumentDisplay } from '@/lib/league/real-estate-display'
import { stockChipLabel } from '@/lib/league/gateway/adapters/stock-catalog'
import { SIGNUP_COUNTRY_CODES, getSignupCountryLabel } from '@/lib/league/jurisdiction/signup-countries'
import { UI_HORIZONS, type UiHorizon } from '@/lib/league/horizon'
import type { LeaderboardData } from '@/lib/league/leaderboard-aggregate'
import type { RecordRoomPage } from '@/lib/league/record-room-aggregate'
import { isLockedViewPayload, RECORD_ROOM_PURCHASE_ROUND_LIMIT } from '@/lib/league/view-purchase-policy'
import { KR_DISCLOSURE, resolveKrLaneBanner, resolveKrLaneFooter } from '@/lib/league/korea-disclosure'
import { KrUsageNoticeList } from '@/components/league/KrLaneDisclosureBlocks'
import { isDeepDisabledForViewer } from '@/lib/league/korea-lane-features'
import { KrUniverseChipBrowser, krStockRefusalMessage } from '@/components/league/KrUniverseChipBrowser'
import { generateErrorMessage, tryAgainSoonMessage } from '@/lib/league/generate-error-copy'
import { formatSessionDate } from '@/lib/league/card-header-copy'
import { publicFacingLabel } from '@/lib/league/public-label'
import type { FreeformRecentItem } from '@/lib/league/freeform-recent'
import { AirankRankingPicker } from '@/components/league/AirankRankingPicker'

export type LeagueHubTab = 'cards' | 'leaderboard' | 'recordRoom'

type PublicCatalogCategory = {
  id: PublicCategoryId
  ledgerCategory: string
  tone: ColorBucket
  kind: CatalogKind
  promptAllowed: boolean
  mixedResolutionClocks: boolean
  instruments: { instrument: string }[]
  recentRounds?: FreeformRecentItem[]
}

type InstrumentsPayload = {
  categories?: PublicCatalogCategory[]
  jurisdiction?: { declaredMissing?: boolean; mismatch?: boolean }
  stockLane?: 'global' | 'korea'
  viewerIsAdmin?: boolean
  krAdvisoryRegNo?: string
  krBizNo?: string
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
  | { kind: 'electionClosed' }
  | { kind: 'none' }
  | { kind: 'error'; text?: string }
  | { kind: 'krNotice'; text: string }

function koreaLaneShowsInstrumentPanel(
  koreaStocks: boolean,
  isAdmin: boolean,
  instrument: string | null,
): boolean {
  if (!instrument) return false
  if (!koreaStocks) return true
  if (instrument.startsWith('STOCK:')) return true
  return isAdmin && instrument.startsWith('KRSTOCK:')
}

function CardsPanel() {
  const { t, locale } = useLeagueLocale()
  const [categories, setCategories] = useState<PublicCatalogCategory[] | null>(null)
  const [selectedCategory, setSelectedCategory] = useState<PublicCategoryId | null>(null)
  const [selectedInstrument, setSelectedInstrument] = useState<string | null>(null)
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null)
  // Horizon selector next to the instrument chips. Default '1d' — every
  // instrument opens on the 1-day card first.
  const [horizon, setHorizon] = useState<UiHorizon>('1d')
  const [view, setView] = useState<CardView>({ kind: 'loading' })
  const [declaredMissing, setDeclaredMissing] = useState(false)
  const [countryMismatch, setCountryMismatch] = useState(false)
  const [admissionLane, setAdmissionLane] = useState<'global' | 'korea'>('global')
  const [viewerIsAdmin, setViewerIsAdmin] = useState(false)
  const [adminLane, setAdminLane] = useState<'global' | 'korea' | null>(null)
  const [krAdvisoryRegNo, setKrAdvisoryRegNo] = useState<string | undefined>()
  const [krBizNo, setKrBizNo] = useState<string | undefined>()
  const [promptSeed, setPromptSeed] = useState('')
  // Guards against a slower, now-superseded fetch overwriting the result of a
  // later one (e.g. clicking two instruments/horizons in quick succession).
  const requestIdRef = useRef(0)
  // Quiet generation polls must not overlap. Starting the next one bumps
  // requestId and drops the in-flight body, so a scout row that landed
  // mid-tick never reaches the card until polling stops at job end.
  const quietInFlightRef = useRef(false)

  // The SERVER'S response is the only decision this panel trusts — locked vs
  // full card, jurisdiction, everything. `quiet` polls (while a generation
  // job runs) skip the loading flash but share the same supersede guard.
  const loadCard = useCallback(
    async (
      instrument: string,
      horizonArg: UiHorizon,
      opts?: { quiet?: boolean; roundId?: string },
    ): Promise<{ missing: boolean } | undefined> => {
      const quiet = opts?.quiet === true
      if (quiet && quietInFlightRef.current) return
      const requestId = (requestIdRef.current += 1)
      if (quiet) quietInFlightRef.current = true
      if (!quiet) setView({ kind: 'loading' })
      try {
        const url = opts?.roundId
          ? `/api/league/card?round_id=${encodeURIComponent(opts.roundId)}`
          : `/api/league/card?instrument=${encodeURIComponent(instrument)}&horizon=${encodeURIComponent(horizonArg)}`
        const res = await fetch(url, { credentials: 'include', cache: 'no-store' })
        const body = (await res.json()) as
          | CardData
          | LockedCardPayload
          | { error: string; code?: string }
        if (requestId !== requestIdRef.current) return
        if (!res.ok) {
          const errBody = body as { error?: string; code?: string }
          const refusal = krStockRefusalMessage(errBody.code ?? errBody.error)
          if (refusal) {
            setView({ kind: 'krNotice', text: refusal })
            return { missing: false }
          }
          if ('code' in body && body.code === 'kr_election_manual_close') {
            setView({ kind: 'electionClosed' })
          } else if ('code' in body && body.code === 'jurisdiction_blocked') {
            setView({ kind: 'blocked' })
          } else if (res.status === 404 || ('code' in body && body.code === 'no_round')) {
            setView({ kind: 'none' })
            return { missing: true }
          } else {
            setView({
              kind: 'error',
              text: generateErrorMessage(errBody.code, locale, res.status),
            })
          }
          return { missing: false }
        }
        if ('locked' in body && body.locked) {
          setView({ kind: 'locked', locked: body })
          return { missing: false }
        }
        setView({ kind: 'card', card: body as CardData })
        return { missing: false }
      } catch {
        if (requestId === requestIdRef.current && !opts?.quiet) {
          setView({ kind: 'error', text: tryAgainSoonMessage(locale) })
        }
        return { missing: false }
      } finally {
        if (quiet) quietInFlightRef.current = false
      }
    },
    [locale]
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
        setAdmissionLane(body.stockLane === 'korea' ? 'korea' : 'global')
        setViewerIsAdmin(Boolean(body.viewerIsAdmin))
        if (body.krAdvisoryRegNo) setKrAdvisoryRegNo(body.krAdvisoryRegNo)
        if (body.krBizNo) setKrBizNo(body.krBizNo)
        setCategories(list)
        const firstId = defaultCatalogCategoryId(list)
        setSelectedCategory(firstId)
        const firstCat = list.find((c) => c.id === firstId)
        if (firstCat && isFreeformSearchCategory(firstCat.id)) {
          setSelectedInstrument(null)
          setSelectedRoundId(null)
          setView({ kind: 'none' })
        } else {
          const firstInstrument = firstCat?.instruments[0]?.instrument ?? null
          setSelectedInstrument(firstInstrument)
          setSelectedRoundId(null)
          if (firstInstrument) {
            void loadCard(firstInstrument, '1d')
          } else {
            setView({ kind: 'none' })
          }
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
    if (!selectedInstrument && !selectedRoundId) return
    if (generationStatus !== 'queued' && generationStatus !== 'running') return
    const poll = () =>
      void loadCard(selectedInstrument ?? '', horizon, {
        quiet: true,
        ...(selectedRoundId ? { roundId: selectedRoundId } : {}),
      })
    const id = window.setInterval(poll, GENERATION_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [generationStatus, selectedInstrument, selectedRoundId, horizon, loadCard])

  function selectCategory(id: PublicCategoryId) {
    if (!categories) return
    const next = categories.find((c) => c.id === id)
    setSelectedCategory(id)
    if (!next || isFreeformSearchCategory(id) || next.instruments.length === 0) {
      setSelectedInstrument(null)
      setSelectedRoundId(null)
      setView({ kind: 'none' })
      return
    }
    const first = next.instruments[0]!.instrument
    setSelectedInstrument(first)
    setSelectedRoundId(null)
    void loadCard(first, horizon)
  }

  // A plain click handler, not a `[selected]`-keyed effect: re-clicking the
  // ALREADY-selected instrument must still fire a fresh fetch.
  function selectInstrument(instrument: string) {
    setSelectedInstrument(instrument)
    setSelectedRoundId(null)
    void loadCard(instrument, horizon)
  }

  function selectRecentRound(row: FreeformRecentItem) {
    setSelectedRoundId(row.round_id)
    setSelectedInstrument(row.instrument)
    void loadCard(row.instrument, horizon, { roundId: row.round_id })
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
  const stockLane = viewerIsAdmin && adminLane ? adminLane : admissionLane
  const koreaStocks = active?.id === 'stocks' && stockLane === 'korea'
  const showPrompt = Boolean(
    selectedCategory &&
      active &&
      (active.id === 'stocks'
        ? stockLane === 'global' && (active.promptAllowed || viewerIsAdmin)
        : active.promptAllowed),
  )
  const showInstrumentChips = Boolean(
    active &&
      !koreaStocks &&
      !isFreeformSearchCategory(active.id) &&
      (active.id === 'stocks'
        ? active.instruments.length > 0
        : active.kind === 'instruments' || active.instruments.length > 0),
  )
  const showHorizon = Boolean(
    active &&
      !koreaStocks &&
      !isFreeformSearchCategory(active.id) &&
      (active.kind === 'instruments' || active.instruments.length > 0) &&
      usesHorizonChipRow(active.id),
  )
  const showFreeformIntro = Boolean(
    active && isFreeformSearchCategory(active.id) && view.kind !== 'card' && view.kind !== 'locked',
  )

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

      {viewerIsAdmin && active?.id === 'stocks' ? (
        <div className="flex gap-1.5" data-admin-stock-lane={stockLane}>
          {(['global', 'korea'] as const).map((lane) => (
            <button
              key={lane}
              type="button"
              onClick={() => {
                setAdminLane(lane)
                if (lane === 'korea') {
                  setSelectedInstrument(null)
                  setSelectedRoundId(null)
                  setView({ kind: 'none' })
                }
              }}
              aria-current={stockLane === lane}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                stockLane === lane ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100'
              }`}
            >
              {lane === 'global' ? t.catalog.stockLaneAdminGlobal : t.catalog.stockLaneAdminKorea}
            </button>
          ))}
        </div>
      ) : null}

      {selectedCategory === 'tech' ? (
        <AirankRankingPicker
          locale={locale}
          onOpen={(instrument, nextHorizon) => {
            setHorizon(nextHorizon)
            setSelectedInstrument(instrument)
            setSelectedRoundId(null)
            void (async () => {
              const result = await loadCard(instrument, nextHorizon)
              if (!result?.missing) return
              const res = await fetch('/api/league/generate', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instrument, horizon: nextHorizon, locale }),
              })
              if (res.ok) {
                void loadCard(instrument, nextHorizon)
                return
              }
              const detail = (await res.json().catch(() => null)) as { code?: string } | null
              setView({
                kind: 'error',
                text: generateErrorMessage(detail?.code, locale, res.status),
              })
            })()
          }}
        />
      ) : null}

      {selectedCategory && showPrompt ? (
        <FreeformPromptBox
          categoryId={selectedCategory}
          seedPrompt={promptSeed}
          onPickInstrument={(instrument) => {
            setSelectedInstrument(instrument)
            setSelectedRoundId(null)
            void loadCard(instrument, horizon)
          }}
          onRoundOpened={(instrument, nextHorizon) => {
            setHorizon(nextHorizon)
            setSelectedInstrument(instrument)
            setSelectedRoundId(null)
            setCategories((prev) => {
              if (!prev) return prev
              return prev.map((cat) => {
                if (cat.id !== selectedCategory) return cat
                if (isFreeformSearchCategory(cat.id)) return cat
                const exists = cat.instruments.some((i) => i.instrument === instrument)
                const nextInsts = exists ? cat.instruments : [{ instrument }, ...cat.instruments]
                return {
                  ...cat,
                  kind: 'instruments' as const,
                  instruments: nextInsts,
                }
              })
            })
            void loadCard(instrument, nextHorizon)
          }}
        />
      ) : null}

      {koreaStocks ? (
        <KoreaStockLane
          regNo={krAdvisoryRegNo}
          bizNo={krBizNo}
          isAdmin={viewerIsAdmin}
          onSelectUsInstrument={(instrument, nextHorizon) => {
            setHorizon(nextHorizon)
            setSelectedInstrument(instrument)
            void loadCard(instrument, nextHorizon)
          }}
        />
      ) : null}

      {showFreeformIntro && active ? (
        <>
          <ComingSoonPanel categoryId={active.id} onExample={(text) => setPromptSeed(text)} />
          {(active.recentRounds ?? []).length > 0 ? (
            <div className="rounded-2xl bg-white px-3 py-3">
              <p className="mb-2 text-xs font-semibold text-slate-600">{t.catalog.recentQuestions}</p>
              <div className="flex flex-col gap-1.5">
                {(active.recentRounds ?? []).map((row) => {
                  const label = publicFacingLabel(
                    rankedPropositionDisplay(row.instrument, row.proposition_text, locale),
                    row.proposition_text,
                  )
                  if (!label) return null
                  const deadline = formatSessionDate(row.resolves_at.slice(0, 10), locale)
                  return (
                    <button
                      key={row.round_id}
                      type="button"
                      onClick={() => selectRecentRound(row)}
                      className="rounded-xl bg-slate-50 px-3 py-2 text-left hover:bg-slate-100"
                    >
                      <span className="block text-sm font-semibold text-slate-800">{label}</span>
                      {deadline ? (
                        <span className="mt-0.5 block text-[11px] text-slate-500">{deadline}</span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {showInstrumentChips && active ? (
        <div className="flex flex-wrap gap-1.5">
          {active.instruments.map((i) => {
            const selected = selectedInstrument === i.instrument
            const label = instrumentLabel(t, i.instrument, locale)
            if (!label) return null
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
                <span className="block text-sm">{label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      {active?.kind === 'instruments' && active.mixedResolutionClocks ? (
        <p className="text-[11px] leading-relaxed text-slate-500">{t.catalog.spotVsEtfNote}</p>
      ) : null}

      {showHorizon && active ? (
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

      {view.kind === 'loading' ? (
        <PanelMessage text={t.hub.loading} />
      ) : null}
      {view.kind === 'blocked' ? (
        <PanelMessage text={t.gating.unavailable} />
      ) : null}
      {view.kind === 'electionClosed' ? (
        <PanelMessage text={t.disclaimer.electionManualClose} />
      ) : null}
      {active?.kind === 'instruments' && view.kind === 'none' && !koreaStocks && !(active.id === 'stocks' && !selectedInstrument) ? (
        <PanelMessage text={t.catalog.noCardYet} />
      ) : null}
      {view.kind === 'error' ? (
        <PanelMessage text={view.text ?? tryAgainSoonMessage(locale)} tone="error" />
      ) : null}
      {view.kind === 'krNotice' ? (
        <p
          data-testid="kr-chip-pending"
          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
        >
          {view.text}
        </p>
      ) : null}

      {(view.kind === 'locked' || view.kind === 'card') &&
      (selectedRoundId ||
        (selectedInstrument &&
          koreaLaneShowsInstrumentPanel(koreaStocks, viewerIsAdmin, selectedInstrument))) ? (
        <div data-testid="league-round-card">
          {view.kind === 'locked' && (selectedInstrument ?? view.locked.round.instrument) ? (
            <LockedRoundPanel
              locked={view.locked}
              instrument={selectedInstrument ?? view.locked.round.instrument}
              horizon={horizon}
              locale={locale}
              onOpened={() =>
                void loadCard(selectedInstrument ?? view.locked.round.instrument, horizon)
              }
            />
          ) : view.kind === 'card' ? (
            <>
              <GenerationBanner
                card={view.card}
                locale={locale}
                onRetried={() => void loadCard(selectedInstrument ?? view.card.round.instrument, horizon)}
              />
              <PredictionCard key={view.card.round.round_id} initialData={view.card} />
              {isDeepDisabledForViewer(
                {
                  jurisdiction: {
                    declaredCountry: admissionLane === 'korea' ? 'KR' : null,
                    ipCountry: admissionLane === 'korea' ? 'KR' : null,
                  },
                },
                view.card.round.category,
                view.card.round.instrument,
              ) ? null : (
                <DeepAnalysis
                  roundId={view.card.round.round_id}
                  category={view.card.round.category}
                  colorBucket={view.card.round.color_bucket}
                />
              )}
            </>
          ) : null}
        </div>
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
  locale: LeagueLocale
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
          | { balance?: number; required?: number; code?: string; error?: string }
          | null
        if (res.status === 402) {
          setNotice(t.hub.insufficientCredits(detail?.required ?? locked.price, detail?.balance ?? 0))
        } else if (res.status === 429) {
          setNotice(t.hub.rateLimited)
        } else if (res.status === 503 && detail?.code === 'busy') {
          setNotice(t.hub.generationBusy)
        } else if (res.status === 503 && detail?.code === 'market_data_unavailable') {
          setNotice(t.hub.marketDataUnavailable)
        } else {
          const refusal = krStockRefusalMessage(detail?.code ?? detail?.error)
          if (refusal) {
            setNotice(refusal)
          } else if (res.status === 403) {
            setNotice(generateErrorMessage(detail?.code ?? 'not_public', locale, res.status))
          } else {
            setNotice(generateErrorMessage(detail?.code, locale, res.status))
          }
        }
        return
      }
      onOpened()
    } catch {
      setNotice(tryAgainSoonMessage(locale))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-6">
      <p className="text-sm font-semibold leading-relaxed text-slate-900">
        {rankedPropositionDisplay(instrument, locked.round.proposition_text, locale)}
      </p>
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
              : generateErrorMessage(detail?.code, locale, res.status)
        )
        return
      }
      onRetried()
    } catch {
      setNotice(tryAgainSoonMessage(locale))
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

export function KoreaStockLane({
  regNo,
  bizNo,
  isAdmin = false,
  onSelectUsInstrument,
}: {
  regNo?: string
  bizNo?: string
  isAdmin?: boolean
  onSelectUsInstrument?: (instrument: string, horizon: UiHorizon) => void
} = {}) {
  const { main: bannerMain, regLine: bannerRegText } = resolveKrLaneBanner(regNo)
  const footerText = resolveKrLaneFooter(regNo, bizNo)

  return (
    <div data-stock-lane="korea" className="flex flex-col gap-3">
      {/* Non-dismissible top disclosure banner (normal body text size, above chips) */}
      <div
        data-testid="kr-lane-banner"
        className="rounded-2xl border border-amber-300 bg-amber-50/90 p-4 text-sm leading-relaxed text-slate-800 shadow-sm"
      >
        <p className="font-semibold text-slate-900">{bannerMain}</p>
        <p className="mt-2 text-sm text-slate-700">{bannerRegText}</p>
      </div>

      {/* Generate guidance */}
      <div
        data-testid="kr-lane-generate"
        className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600"
      >
        {KR_DISCLOSURE.generate}
        <KrUsageNoticeList />
      </div>

      <KrUniverseChipBrowser
        isAdmin={isAdmin}
        onSelectUsInstrument={(instrument, horizon) => onSelectUsInstrument?.(instrument, horizon)}
      />

      {/* Mandatory footer disclosure */}
      <div
        data-testid="kr-lane-footer"
        className="mt-2 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-500"
      >
        {footerText}
      </div>
    </div>
  )
}

function ComingSoonPanel({
  categoryId,
  onExample,
}: {
  categoryId: PublicCategoryId
  onExample?: (text: string) => void
}) {
  const { t } = useLeagueLocale()
  const panel =
    categoryId === 'sports' ||
    categoryId === 'politics_election' ||
    categoryId === 'entertainment' ||
    categoryId === 'real_estate' ||
    categoryId === 'tech'
      ? t.catalog.freeformPanel[categoryId]
      : null
  if (!panel) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
        <p className="text-sm font-semibold text-slate-800">{t.catalog.comingSoon}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{t.catalog.comingSoonHint}</p>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center">
      <p className="text-sm font-semibold text-slate-800">{panel.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-600">{panel.body}</p>
      <div className="mt-3 flex flex-col items-center gap-1.5">
        {panel.examples.map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => onExample?.(sample)}
            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-200"
          >
            {sample}
          </button>
        ))}
      </div>
      {categoryId === 'sports' ? (
        <p className="mt-3 text-left text-[11px] leading-relaxed text-slate-500">{t.disclaimer.sports}</p>
      ) : null}
      {categoryId === 'real_estate' ? (
        <p className="mt-3 text-left text-[11px] leading-relaxed text-slate-500">
          {t.disclaimer.realEstate} {t.disclaimer.realEstateScope}
        </p>
      ) : null}
    </div>
  )
}

function instrumentLabel(
  t: { catalog: { instruments: Record<string, string> } },
  instrument: string,
  locale: LeagueLocale,
): string {
  const sports = sportsVsLabel(instrument, locale)
  if (sports) return publicFacingLabel(sports)
  const stock = stockChipLabel(instrument)
  if (stock) return publicFacingLabel(stock)
  const property = propertyInstrumentDisplay(instrument, locale)
  if (property) return publicFacingLabel(property)
  return publicFacingLabel(t.catalog.instruments[instrument], '')
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
