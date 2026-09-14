'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ColorBucket } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { creditsForLeagueDeepDebate, creditsForLeagueDeepOpen } from '@/lib/credits'
import { DEEP_POLL_MS } from '@/lib/league/generation/policy'
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
}

function pathFor(kind: DeepKind): string {
  return kind === 'open' ? '/api/league/deep-open' : '/api/league/deep-debate'
}

/**
 * Deep-analysis entry + result. POST starts the job (~1s); GET polls every 5s.
 * Reopening the tab resumes from the row — the job is not held in this tab.
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
      if (!body.ok && body.done && body.refunded) {
        setError(t.hub.deepFailedRefunded)
        setRefunded(true)
        setRunning(null)
        return 'stop'
      }
      if (!body.ok && body.done) {
        setError(t.hub.deepFailed)
        setRefunded(false)
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

  return (
    <div className="mt-4 flex flex-col gap-3">
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
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
          <p className="text-[12px] font-medium text-slate-800">{progressLine}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{t.hub.deepWaitNote}</p>
        </div>
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
      {result ? (
        <CardCompliance colorBucket={colorBucket} t={t} category={category}>
          {(receipt) => <DeepAnalysisBody receipt={receipt} result={result} t={t} />}
        </CardCompliance>
      ) : null}
    </div>
  )
}

function DeepAnalysisBody({
  receipt,
  result,
  t,
}: {
  receipt: ComplianceReceipt
  result: DeepPayload
  t: LeagueUiPack
}) {
  void receipt
  const title = result.kind === 'open' ? t.hub.deepOpenTitle : t.hub.deepDebateTitle
  return (
    <div className="px-4 py-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-league-fg-muted">{title}</p>
      <p className="mt-1 text-sm font-semibold text-league-fg">{result.instrument}</p>
      <p className="mt-1 text-xs leading-relaxed text-league-fg-muted">{result.proposition}</p>
      <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-900">
        {t.hub.deepUnscoredNote}
      </p>

      {result.kind === 'open' ? (
        <>
          {result.synthesis ? (
            <pre className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-league-fg">{result.synthesis}</pre>
          ) : null}
          {result.briefing ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-[11px] font-semibold text-league-fg-muted">Briefing</summary>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-league-fg-muted">
                {result.briefing}
              </pre>
            </details>
          ) : null}
        </>
      ) : (
        <>
          {result.verdict?.judgment ? (
            <pre className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-league-fg">
              {result.verdict.judgment}
            </pre>
          ) : null}
          {result.verdict?.keyIssues ? (
            <p className="mt-2 text-[12px] leading-relaxed text-league-fg-muted">{result.verdict.keyIssues}</p>
          ) : null}
          {result.vote ? (
            <p className="mt-2 font-mono text-[11px] text-league-fg-muted">{result.vote.summary}</p>
          ) : null}
          {result.verdict?.minorityReport ? (
            <p className="mt-2 text-[12px] italic leading-relaxed text-league-fg-muted">{result.verdict.minorityReport}</p>
          ) : null}
        </>
      )}
    </div>
  )
}
