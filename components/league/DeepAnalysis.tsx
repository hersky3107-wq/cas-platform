'use client'

import { useState } from 'react'
import type { ColorBucket } from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { creditsForLeagueDeepDebate, creditsForLeagueDeepOpen } from '@/lib/credits'
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

/**
 * Deep-analysis entry + result. Shown ONLY when a round card already exists
 * (the parent gates on `card`). Buttons carry their credit price. The result
 * is wrapped in the same `CardCompliance` as the prediction card — one
 * disclaimer layer, not a weaker copy.
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
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DeepPayload | null>(null)

  async function run(kind: DeepKind) {
    setRunning(kind)
    setError(null)
    try {
      const path = kind === 'open' ? '/api/league/deep-open' : '/api/league/deep-debate'
      let sessionId: string | undefined
      for (let i = 0; i < 8; i += 1) {
        const res = await fetch(path, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roundId, locale, ...(sessionId ? { sessionId } : {}) }),
        })
        const body = (await res.json()) as DeepPayload & {
          error?: string
          required?: number
          balance?: number
          ok?: boolean
          done?: boolean
          sessionId?: string
        }
        if (res.status === 402) {
          setError(t.hub.insufficientCredits(body.required ?? 0, body.balance ?? 0))
          return
        }
        if (res.status === 429) {
          setError(t.hub.rateLimited)
          return
        }
        if (!res.ok || body.ok === false) {
          setError(body.error ?? t.hub.genericError)
          return
        }
        if (body.done === false && body.sessionId) {
          sessionId = body.sessionId
          continue
        }
        setResult(body)
        return
      }
      setError(t.hub.genericError)
    } catch {
      setError(t.hub.genericError)
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      <p className="text-[11px] leading-relaxed text-slate-500">{t.hub.deepUnscoredNote}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={running !== null}
          onClick={() => void run('open')}
          className="flex-1 rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
        >
          {running === 'open' ? t.hub.deepRunning : t.hub.deepOpen(OPEN_COST)}
        </button>
        <button
          type="button"
          disabled={running !== null}
          onClick={() => void run('debate')}
          className="flex-1 rounded-xl bg-slate-800 px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-50"
        >
          {running === 'debate' ? t.hub.deepRunning : t.hub.deepDebate(DEBATE_COST)}
        </button>
      </div>
      {error ? (
        <p className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</p>
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
