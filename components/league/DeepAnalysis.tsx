'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ColorBucket } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { creditsForLeagueDeepDebate, creditsForLeagueDeepOpen } from '@/lib/credits'
import { DEEP_POLL_MS } from '@/lib/league/generation/policy'
import {
  deepBrandLabel,
  type DeepDebateSnapshot,
  type DeepOpenSnapshot,
  type DeepSnapshot,
  type DeepVoteSnapshot,
} from '@/lib/league/deep-snapshot'
import {
  DEEP_OPEN_SEAT_SHELLS,
  emptyDebateSnapshot,
  emptyOpenSnapshot,
  mergeDeepSnapshots,
  overlayDeepTranslations,
  pendingDebateSeats,
  pendingOpenSeats,
} from '@/lib/league/deep-display'
import { useDeepTranslations } from '@/lib/league/use-deep-translations'
import { CardCompliance, type ComplianceReceipt } from './CardCompliance'

const OPEN_COST = creditsForLeagueDeepOpen()
const DEBATE_COST = creditsForLeagueDeepDebate()

type DeepKind = 'open' | 'debate'

type OpenPayload = {
  kind: 'open'
  instrument: string
  proposition: string
  briefing: string | null
  analyses: { provider: string; roleLabel: string; content: string | null; ok: boolean }[]
  synthesis: string | null
}

type DebatePayload = {
  kind: 'debate'
  instrument: string
  proposition: string
  briefing: string | null
  consensusScore: number | null
  vote: { approve: number; oppose: number; conditional: number; abstain: number; summary: string } | null
  verdict: { judgment: string | null; keyIssues: string | null; minorityReport: string | null } | null
}

type DeepPayload = OpenPayload | DebatePayload

type PollBody = DeepPayload & {
  error?: string
  required?: number
  balance?: number
  ok?: boolean
  done?: boolean
  exists?: boolean
  waiting?: boolean
  sessionId?: string
  stage?: string
  refunded?: boolean
  code?: string
  snapshot?: DeepSnapshot | null
}

function pathFor(kind: DeepKind): string {
  return kind === 'open' ? '/api/league/deep-open' : '/api/league/deep-debate'
}

/**
 * Deep-analysis entry + FULL process view. POST starts the durable job
 * (~1s); GET polls every 5s and carries a sanitized `snapshot` of the
 * persisted pipeline state, so every stage renders as its hop completes:
 *   open   — plan → per-model briefs (arrival order) → final report
 *   debate — plan → debate rounds → ballot (yes:no) → chair verdict
 * Reopening the tab resumes from the row — the job is not held in this tab.
 * Neutral analyst framing only; no ministry/warroom personas.
 */
export function DeepAnalysis({
  roundId,
  category,
  colorBucket,
}: {
  roundId: string
  category: string
  colorBucket: ColorBucket
}) {
  const { t, locale } = useLeagueLocale()
  const [running, setRunning] = useState<DeepKind | null>(null)
  const [lastKind, setLastKind] = useState<DeepKind>('open')
  const [stage, setStage] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refunded, setRefunded] = useState(false)
  const [result, setResult] = useState<DeepPayload | null>(null)
  const [snapshot, setSnapshot] = useState<DeepSnapshot | null>(null)
  const liveSnap = snapshot ?? (result ? snapshotFromResult(result) : null)
  const { translations, inFlight: deepI18nInFlight, showOriginal, onToggleOriginal } = useDeepTranslations(
    roundId,
    locale,
    liveSnap
  )
  const displaySnap = liveSnap
    ? overlayDeepTranslations(liveSnap, translations, { locale, showOriginal })
    : null
  const hasTranslation = Boolean(translations && Object.keys(translations).length > 0)

  const applyPoll = useCallback(
    (kind: DeepKind, body: PollBody, status: number) => {
      if (status === 402) {
        setError(t.hub.insufficientCredits(body.required ?? 0, body.balance ?? 0))
        setRunning(null)
        return 'stop'
      }
      if (status === 429) {
        setError(t.hub.rateLimited)
        setRunning(null)
        return 'stop'
      }
      if (status === 503 && body.code === 'busy') {
        setError(t.hub.deepBusy)
        setRunning(null)
        return 'stop'
      }
      if (body.snapshot) setSnapshot((prev) => mergeDeepSnapshots(prev, body.snapshot ?? null))
      if (!body.ok && body.done && body.refunded) {
        setError(t.hub.deepFailedRefunded)
        setRefunded(true)
        setLastKind(kind)
        setRunning(null)
        return 'stop'
      }
      if (!body.ok && body.done) {
        setError(t.hub.deepFailed)
        setRefunded(false)
        setLastKind(kind)
        setRunning(null)
        return 'stop'
      }
      if (status >= 400 || body.ok === false) {
        setError(body.error ?? t.hub.genericError)
        setRunning(null)
        return 'stop'
      }
      if (body.done === false) {
        setRunning(kind)
        setLastKind(kind)
        setStage(typeof body.stage === 'string' ? body.stage : 'start')
        setWaiting(body.waiting === true)
        return 'poll'
      }
      if (body.done === true && body.kind) {
        setResult(body)
        setRunning(null)
        setStage(null)
        return 'stop'
      }
      return 'stop'
    },
    [t]
  )

  const pollOnce = useCallback(
    async (kind: DeepKind) => {
      const res = await fetch(`${pathFor(kind)}?roundId=${encodeURIComponent(roundId)}&locale=${encodeURIComponent(locale)}`, {
        credentials: 'include',
      })
      const body = (await res.json()) as PollBody
      if (body.exists === false) return 'absent'
      return applyPoll(kind, body, res.status)
    },
    [applyPoll, locale, roundId]
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      for (const kind of ['open', 'debate'] as const) {
        if (cancelled) return
        const outcome = await pollOnce(kind)
        if (outcome === 'poll' || outcome === 'stop') return
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pollOnce])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      void pollOnce(running)
    }, DEEP_POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void pollOnce(running)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running, pollOnce])

  async function run(kind: DeepKind) {
    setRunning(kind)
    setLastKind(kind)
    setError(null)
    setRefunded(false)
    setResult(null)
    setSnapshot(null)
    setStage('start')
    try {
      const res = await fetch(pathFor(kind), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, locale }),
      })
      const body = (await res.json()) as PollBody
      applyPoll(kind, body, res.status)
    } catch {
      setError(t.hub.genericError)
      setRunning(null)
    }
  }

  const progressLine = running
    ? waiting
      ? t.hub.deepQueued
      : stage
        ? t.hub.deepStage(stage)
        : t.hub.deepRunning
    : null

  const showProcess = running !== null || snapshot !== null || result !== null

  return (
    <div className="mt-4 flex flex-col gap-3">
      <h2
        className="text-xl font-black tracking-tight text-league-fg md:text-2xl"
        data-testid="deep-report-title"
      >
        {t.hub.deepReportTitle}
      </h2>
      <p className="text-[11px] leading-relaxed text-slate-500">{t.hub.deepUnscoredNote}</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <button
            type="button"
            disabled={running !== null}
            onClick={() => void run('open')}
            className="w-full rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
          >
            {running === 'open' ? t.hub.deepRunning : t.hub.deepOpen(OPEN_COST)}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{t.hub.deepOpenHint}</p>
        </div>
        <div className="flex-1">
          <button
            type="button"
            disabled={running !== null}
            onClick={() => void run('debate')}
            className="w-full rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
          >
            {running === 'debate' ? t.hub.deepRunning : t.hub.deepDebate(DEBATE_COST)}
          </button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{t.hub.deepDebateHint}</p>
        </div>
      </div>
      {running ? (
        <DeepWorkingBanner
          headline={progressLine ?? t.hub.deepRunning}
          note={waiting ? t.hub.deepQueued : t.hub.deepWorkingNote}
        />
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          <p>{error}</p>
          {running === null && (refunded || error === t.hub.deepFailed) ? (
            <button
              type="button"
              onClick={() => void run(lastKind)}
              className="mt-2 font-semibold underline"
            >
              {t.hub.retryGeneration}
            </button>
          ) : null}
        </div>
      ) : null}
      {showProcess ? (
        <CardCompliance colorBucket={colorBucket} t={t} category={category}>
          {(receipt) => (
            <DeepProcessBody
              receipt={receipt}
              snapshot={displaySnap}
              result={result}
              stage={stage}
              running={running !== null}
              kind={running ?? lastKind}
              t={t}
              hasTranslation={hasTranslation}
              showOriginal={showOriginal}
              onToggleOriginal={onToggleOriginal}
              translating={deepI18nInFlight}
            />
          )}
        </CardCompliance>
      ) : null}
    </div>
  )
}

// ── Full-process body ─────────────────────────────────────────────────────────

function DeepProcessBody({
  receipt,
  snapshot,
  result,
  stage,
  running,
  kind,
  t,
  hasTranslation,
  showOriginal,
  onToggleOriginal,
  translating,
}: {
  receipt: ComplianceReceipt
  snapshot: DeepSnapshot | null
  result: DeepPayload | null
  stage: string | null
  running: boolean
  kind: DeepKind
  t: LeagueUiPack
  hasTranslation: boolean
  showOriginal: boolean
  onToggleOriginal: () => void
  translating: boolean
}) {
  void receipt
  const snap =
    snapshot ?? (result ? snapshotFromResult(result) : kind === 'open' ? emptyOpenSnapshot() : emptyDebateSnapshot())
  if (!running && !snapshot && !result) return null
  const done = !running && result !== null
  const title = snap.kind === 'open' ? t.hub.deepOpenTitle : t.hub.deepDebateTitle

  return (
    <div className="px-4 py-4" data-testid="deep-process">
      <p className="text-[10px] font-bold uppercase tracking-wide text-league-fg-muted">{title}</p>
      {snap.instrument ? <p className="mt-1 text-sm font-semibold text-league-fg">{snap.instrument}</p> : null}
      {snap.proposition ? (
        <p className="mt-1 text-xs leading-relaxed text-league-fg-muted">{snap.proposition}</p>
      ) : null}
      <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900">
        {t.hub.deepUnscoredNote}
      </p>
      {hasTranslation ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleOriginal}
            className="text-[11px] font-semibold text-league-accent-strong underline-offset-2 hover:underline"
          >
            {showOriginal ? t.modelTile.hideOriginal : t.modelTile.showOriginal}
          </button>
        </div>
      ) : translating ? (
        <p className="mt-2 text-[11px] font-semibold text-league-accent-strong" aria-live="polite">
          {t.modelTile.translating}
        </p>
      ) : null}
      <StageStrip kind={snap.kind} stage={done ? 'done' : stage} running={running} t={t} />
      {snap.kind === 'open' ? (
        <OpenProcess snap={snap} running={running} t={t} />
      ) : (
        <DebateProcess snap={snap} running={running} t={t} />
      )}
    </div>
  )
}

/** Old cached poll bodies carry only the terminal result — project it. */
function snapshotFromResult(result: DeepPayload): DeepSnapshot {
  if (result.kind === 'open') {
    return {
      kind: 'open',
      instrument: result.instrument ?? null,
      proposition: result.proposition ?? null,
      plan: null,
      briefing: result.briefing ?? null,
      analyses: (result.analyses ?? []).map((a) => ({
        roleId: a.provider,
        roleLabel: a.roleLabel,
        provider: a.provider,
        brand: deepBrandLabel(a.provider),
        content: a.content,
        ok: a.ok,
      })),
      synthesis: result.synthesis ?? null,
    }
  }
  return {
    kind: 'debate',
    instrument: result.instrument ?? null,
    proposition: result.proposition ?? null,
    plan: null,
    briefing: result.briefing ?? null,
    rounds: [],
    vote: result.vote
      ? {
          approve: result.vote.approve,
          conditional: result.vote.conditional,
          oppose: result.vote.oppose,
          abstain: result.vote.abstain,
          summary: result.vote.summary,
          votes: [],
        }
      : null,
    verdict: result.verdict
      ? { ...result.verdict, consensusScore: result.consensusScore ?? null }
      : null,
  }
}

// ── Stage strip ───────────────────────────────────────────────────────────────

const OPEN_STAGE_ORDER = ['plan', 'report', 'analyses', 'synthesis'] as const
const DEBATE_STAGE_ORDER = ['plan', 'report', 'deliberate', 'vote', 'verdict'] as const

function stepLabel(key: string, t: LeagueUiPack): string {
  const labels = t.hub.deepStepLabels
  switch (key) {
    case 'plan':
      return labels.plan
    case 'report':
      return labels.briefing
    case 'analyses':
      return labels.analyses
    case 'synthesis':
      return labels.synthesis
    case 'deliberate':
      return labels.debate
    case 'vote':
      return labels.vote
    case 'verdict':
      return labels.verdict
    default:
      return key
  }
}

function stageIndex(stage: string | null, order: readonly string[]): number {
  if (stage === 'done') return order.length
  if (!stage) return -1
  if (stage === 'start' || stage === 'seed_retry') return 0
  return order.indexOf(stage)
}

function StageStrip({
  kind,
  stage,
  running,
  t,
}: {
  kind: DeepKind
  stage: string | null
  running: boolean
  t: LeagueUiPack
}) {
  const order: readonly string[] = kind === 'open' ? OPEN_STAGE_ORDER : DEBATE_STAGE_ORDER
  const activeIdx = stageIndex(stage, order)
  return (
    <ol className="mt-3 flex flex-wrap gap-1.5" data-testid="deep-stage-strip">
      {order.map((key, i) => {
        const isDone = activeIdx > i
        const active = running && activeIdx === i
        return (
          <li
            key={key}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              isDone
                ? 'bg-emerald-100 text-emerald-800'
                : active
                  ? 'bg-slate-800 text-white shadow-sm ring-2 ring-emerald-400/70'
                  : 'bg-slate-100 text-slate-500'
            }`}
            data-active={active ? 'true' : undefined}
          >
            {isDone ? <span aria-hidden>✓</span> : null}
            {active ? <HourglassMotif size="sm" /> : null}
            {stepLabel(key, t)}
          </li>
        )
      })}
    </ol>
  )
}

// ── Shared section chrome ─────────────────────────────────────────────────────

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-league-fg-muted">{heading}</h4>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

function PendingLine({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[12px] text-league-fg-muted">
      <HourglassMotif size="sm" />
      {text}
    </p>
  )
}

function PendingSeat({
  brand,
  roleLabel,
  waiting,
}: {
  brand?: string
  roleLabel?: string
  waiting: string
}) {
  return (
    <div
      className="league-gen-skeleton rounded-lg border border-dashed border-league-border/60 px-3 py-2.5"
      data-testid="deep-analysis-pending"
    >
      {brand ? (
        <p className="text-[12px] font-semibold text-league-fg-muted">
          {brand}
          {roleLabel ? <span className="font-normal"> · {roleLabel}</span> : null}
        </p>
      ) : (
        <p className="h-3 w-28 rounded bg-slate-300/40" aria-hidden />
      )}
      <PendingLine text={waiting} />
    </div>
  )
}

function BriefingDetails({ briefing, t }: { briefing: string; t: LeagueUiPack }) {
  return (
    <Section heading={t.hub.deepStepLabels.briefing}>
      <details className="rounded-lg border border-league-border/50 bg-league-bg-elevated/50">
        <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold text-league-fg-muted">
          {t.hub.deepStepLabels.briefing}
        </summary>
        <pre className="whitespace-pre-wrap border-t border-league-border/40 px-3 py-2 font-sans text-[12px] leading-relaxed text-league-fg-muted">
          {briefing}
        </pre>
      </details>
    </Section>
  )
}

// ── Open process: plan → per-model briefs → final report ─────────────────────

function OpenProcess({ snap, running, t }: { snap: DeepOpenSnapshot; running: boolean; t: LeagueUiPack }) {
  const pendingSeats = pendingOpenSeats(snap)
  const shellCount =
    running && pendingSeats.length === 0 && snap.analyses.length === 0 ? DEEP_OPEN_SEAT_SHELLS : 0
  return (
    <>
      {snap.plan && snap.plan.length > 0 ? (
        <Section heading={t.hub.deepStepLabels.plan}>
          <ul className="space-y-1.5">
            {snap.plan.map((seat) => (
              <li key={seat.roleId} className="text-[12px] leading-snug text-league-fg">
                <span className="font-semibold">{seat.brand}</span>
                <span className="text-league-fg-muted"> · {seat.roleLabel}</span>
                {seat.subQuestion ? (
                  <span className="block text-[11px] text-league-fg-muted">{seat.subQuestion}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : running ? (
        <Section heading={t.hub.deepStepLabels.plan}>
          <PendingLine text={t.hub.deepStage('plan')} />
        </Section>
      ) : null}

      {snap.briefing ? <BriefingDetails briefing={snap.briefing} t={t} /> : null}

      {snap.analyses.length > 0 || pendingSeats.length > 0 || shellCount > 0 ? (
        <Section heading={t.hub.deepStepLabels.analyses}>
          <div className="space-y-3">
            {snap.analyses.map((a) => (
              <article
                key={a.roleId}
                className={`${running ? 'league-gen-pop' : ''} rounded-lg border border-league-border/50 bg-league-bg-elevated/40 px-3 py-2.5`}
                data-testid="deep-analysis-seat"
              >
                <p className="text-[12px] font-semibold text-league-fg">
                  {a.brand}
                  <span className="font-normal text-league-fg-muted"> · {a.roleLabel}</span>
                </p>
                {a.ok && a.content ? (
                  <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-league-fg">
                    {a.content}
                  </pre>
                ) : (
                  <PendingLine text={t.hub.deepSeatPending} />
                )}
              </article>
            ))}
            {running
              ? pendingSeats.map((seat) => (
                  <PendingSeat
                    key={seat.roleId}
                    brand={seat.brand}
                    roleLabel={seat.roleLabel}
                    waiting={t.hub.deepSeatPending}
                  />
                ))
              : null}
            {running
              ? Array.from({ length: shellCount }, (_, i) => (
                  <PendingSeat key={`shell-${i}`} waiting={t.hub.deepSeatPending} />
                ))
              : null}
          </div>
        </Section>
      ) : null}

      <Section heading={t.hub.deepStepLabels.synthesis}>
        {snap.synthesis ? (
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-league-fg" data-testid="deep-synthesis">
            {snap.synthesis}
          </pre>
        ) : running ? (
          <PendingLine text={t.hub.deepStage('synthesis')} />
        ) : null}
      </Section>
    </>
  )
}

// ── Debate process: plan → rounds → ballot → chair verdict ────────────────────

function DebateProcess({ snap, running, t }: { snap: DeepDebateSnapshot; running: boolean; t: LeagueUiPack }) {
  const pendingSeats = pendingDebateSeats(snap)
  return (
    <>
      {snap.plan && snap.plan.length > 0 ? (
        <Section heading={t.hub.deepStepLabels.plan}>
          <ul className="space-y-1.5">
            {snap.plan.map((seat) => (
              <li key={seat.roleId} className="text-[12px] leading-snug text-league-fg">
                <span className="font-semibold">{seat.brand}</span>
                <span className="text-league-fg-muted"> · {seat.roleLabel}</span>
                {seat.mandate ? (
                  <span className="block text-[11px] text-league-fg-muted">{seat.mandate}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : running ? (
        <Section heading={t.hub.deepStepLabels.plan}>
          <PendingLine text={t.hub.deepStage('plan')} />
        </Section>
      ) : null}

      {snap.briefing ? <BriefingDetails briefing={snap.briefing} t={t} /> : null}

      {snap.rounds.length > 0 || running ? (
        <Section heading={t.hub.deepStepLabels.debate}>
          <div className="space-y-4">
            {snap.rounds.map((round) => (
              <div key={round.roundNumber} data-testid="deep-round">
                <p className="text-[12px] font-bold text-league-fg">
                  {t.hub.deepRoundLabel(round.roundNumber)}
                  {round.consensusScore >= 0 ? (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                      {t.hub.deepConsensusLabel(round.consensusScore)}
                    </span>
                  ) : null}
                </p>
                {round.summary ? (
                  <p className="mt-1 text-[11px] leading-relaxed text-league-fg-muted">{round.summary}</p>
                ) : null}
                <div className="mt-2 space-y-2.5">
                  {round.turns
                    .filter((turn) => turn.ok && turn.position)
                    .map((turn, i) => (
                      <div key={`${turn.provider}-${i}`} className="border-s-2 border-league-border/60 ps-3">
                        <p className="text-[12px] font-semibold text-league-fg">
                          {turn.brand}
                          <span className="font-normal text-league-fg-muted"> · {turn.roleLabel}</span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap text-[12px] leading-relaxed text-league-fg">
                          {turn.position}
                        </p>
                        {turn.concedes ? (
                          <p className="mt-0.5 text-[11px] text-league-fg-muted">
                            <span className="font-semibold">{t.hub.deepConcedesLabel}:</span> {turn.concedes}
                          </p>
                        ) : null}
                        {turn.holds ? (
                          <p className="mt-0.5 text-[11px] text-league-fg-muted">
                            <span className="font-semibold">{t.hub.deepHoldsLabel}:</span> {turn.holds}
                          </p>
                        ) : null}
                      </div>
                    ))}
                </div>
              </div>
            ))}
            {running && pendingSeats.length > 0
              ? pendingSeats.map((seat) => (
                  <PendingSeat
                    key={seat.roleId}
                    brand={seat.brand}
                    roleLabel={seat.roleLabel}
                    waiting={t.hub.deepSeatPending}
                  />
                ))
              : null}
            {running && !snap.vote && !snap.verdict && pendingSeats.length === 0 && snap.rounds.length === 0 ? (
              <PendingLine text={t.hub.deepStage('deliberate')} />
            ) : null}
          </div>
        </Section>
      ) : null}

      {snap.vote ? (
        <Section heading={t.hub.deepStepLabels.vote}>
          <VoteBlock vote={snap.vote} t={t} />
        </Section>
      ) : running && snap.rounds.length > 0 ? (
        <Section heading={t.hub.deepStepLabels.vote}>
          <PendingLine text={t.hub.deepStage('vote')} />
        </Section>
      ) : null}

      <Section heading={t.hub.deepStepLabels.verdict}>
        {snap.verdict?.judgment ? (
          <div data-testid="deep-verdict">
            {snap.verdict.consensusScore !== null && snap.verdict.consensusScore >= 0 ? (
              <p className="mb-1.5 text-[11px] font-semibold text-league-fg-muted">
                {t.hub.deepConsensusLabel(snap.verdict.consensusScore)}
              </p>
            ) : null}
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-league-fg">
              {snap.verdict.judgment}
            </pre>
            {snap.verdict.keyIssues ? (
              <p className="mt-2 text-[12px] leading-relaxed text-league-fg-muted">{snap.verdict.keyIssues}</p>
            ) : null}
            {snap.verdict.minorityReport ? (
              <div className="mt-3 rounded-lg border border-league-border/50 bg-league-bg-elevated/40 px-3 py-2">
                <p className="text-[10px] font-bold uppercase tracking-wide text-league-fg-muted">
                  {t.hub.deepMinorityHeading}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[12px] italic leading-relaxed text-league-fg-muted">
                  {snap.verdict.minorityReport}
                </p>
              </div>
            ) : null}
          </div>
        ) : running ? (
          <PendingLine text={t.hub.deepStage('verdict')} />
        ) : null}
      </Section>
    </>
  )
}

function DeepWorkingBanner({ headline, note }: { headline: string; note: string }) {
  return (
    <div
      className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-3"
      role="status"
      aria-live="polite"
      aria-busy="true"
      data-testid="deep-working"
    >
      <div className="flex items-start gap-2.5">
        <HourglassMotif />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-emerald-950">{headline}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-emerald-800/90">{note}</p>
        </div>
      </div>
    </div>
  )
}

function HourglassMotif({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const wrap = size === 'sm' ? 'h-4 w-4' : 'h-8 w-8'
  const orbit = size === 'sm' ? 'h-4 w-4' : 'h-8 w-8'
  const icon = size === 'sm' ? 'h-2.5 w-2.5' : 'h-4 w-4'
  return (
    <span className={`relative inline-flex ${wrap} shrink-0 items-center justify-center`} aria-hidden>
      <svg viewBox="0 0 32 32" className={`league-gen-orbit ${orbit} text-emerald-500`}>
        <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
        <circle cx="16" cy="3" r="2.2" fill="currentColor" />
      </svg>
      <svg viewBox="0 0 24 24" className={`absolute ${icon} text-emerald-800`}>
        <path
          fill="currentColor"
          d="M6 3h12v3.2c0 2.1-1.2 4-3.1 5L15 12l-.1.8c1.9 1 3.1 2.9 3.1 5V21H6v-3.2c0-2.1 1.2-4 3.1-5L9 12l.1-.8C7.2 10.2 6 8.3 6 6.2V3zm2 2v1.2c0 1.5.9 2.9 2.3 3.5L12 10.4l1.7-.7C15.1 9.1 16 7.7 16 6.2V5H8zm0 14h8v-1.2c0-1.5-.9-2.9-2.3-3.5L12 13.6l-1.7.7C8.9 14.9 8 16.3 8 17.8V19z"
        />
        <rect className="league-gen-sand" x="10" y="6.2" width="4" height="3" rx="0.6" fill="currentColor" opacity="0.85" />
      </svg>
    </span>
  )
}

function VoteBlock({ vote, t }: { vote: DeepVoteSnapshot; t: LeagueUiPack }) {
  const yes = vote.approve + vote.conditional
  const choiceLabel = (choice: string | null): string => {
    if (choice === 'approve') return t.hub.deepVoteChoice.approve
    if (choice === 'conditional') return t.hub.deepVoteChoice.conditional
    if (choice === 'oppose') return t.hub.deepVoteChoice.oppose
    return t.hub.deepVoteChoice.abstain
  }
  const choiceTone = (choice: string | null): string => {
    if (choice === 'approve') return 'text-emerald-700'
    if (choice === 'conditional') return 'text-sky-700'
    if (choice === 'oppose') return 'text-rose-700'
    return 'text-amber-700'
  }
  return (
    <div data-testid="deep-vote">
      <p className="text-2xl font-black tabular-nums tracking-tight text-league-fg" dir="ltr">
        {yes} : {vote.oppose}
      </p>
      <p className="mt-1 text-[11px] text-league-fg-muted">
        {t.hub.deepVoteChoice.approve} {vote.approve} · {t.hub.deepVoteChoice.conditional} {vote.conditional} ·{' '}
        {t.hub.deepVoteChoice.oppose} {vote.oppose} · {t.hub.deepVoteChoice.abstain} {vote.abstain}
      </p>
      {vote.votes.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {vote.votes
            .filter((v) => v.ok || v.reason)
            .map((v, i) => (
              <div key={`${v.provider}-${i}`} className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px]">
                <span className="w-20 shrink-0 font-semibold text-league-fg">{v.brand}</span>
                <span className={`shrink-0 font-bold ${choiceTone(v.choice)}`}>{choiceLabel(v.choice)}</span>
                {v.reason ? <span className="min-w-0 flex-1 text-league-fg-muted">{v.reason}</span> : null}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  )
}
