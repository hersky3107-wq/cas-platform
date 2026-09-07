'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/db/supabase'
import type { OperatorQueueItem } from '@/lib/prediction/operator-queue-types'

const OWNER_EMAIL = 'hersky3107@gmail.com'

type GradeResult = {
  derived_side: string
  children_graded: number
}

export default function LeagueOperatorGradePage() {
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'allowed'>('checking')
  const [rounds, setRounds] = useState<OperatorQueueItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, { sourceUrl: string; observedFact: string }>>({})
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, GradeResult>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/league/grade', { credentials: 'include' })
      const body = (await res.json()) as { rounds?: OperatorQueueItem[]; error?: string }
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`)
      setRounds(body.rounds ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'failed to load queue')
      setRounds([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const { data, error: authError } = await supabase.auth.getUser()
      const email = data.user?.email ?? ''
      if (authError || !email || email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
        setAuthState('denied')
        return
      }
      setAuthState('allowed')
      await load()
    })()
  }, [load])

  async function submit(roundId: string) {
    const draft = drafts[roundId] ?? { sourceUrl: '', observedFact: '' }
    const sourceUrl = draft.sourceUrl.trim()
    const observedFact = draft.observedFact.trim()
    if (!sourceUrl.startsWith('https://') || !observedFact) return

    setSubmitting(roundId)
    setError(null)
    try {
      const res = await fetch('/api/admin/league/grade', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roundId, sourceUrl, observedFact }),
      })
      const body = (await res.json()) as GradeResult & { error?: string }
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`)
      setResults((prev) => ({
        ...prev,
        [roundId]: { derived_side: body.derived_side, children_graded: body.children_graded },
      }))
      setRounds((prev) => prev.filter((r) => r.id !== roundId))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'grade failed')
    } finally {
      setSubmitting(null)
    }
  }

  if (authState === 'checking') return <p className="p-6 text-sm text-gray-500">Checking access…</p>
  if (authState === 'denied') return <p className="p-6 text-sm text-red-600">Forbidden.</p>

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">League — operator grade queue</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold"
        >
          Refresh
        </button>
      </div>
      <p className="text-xs text-gray-600">
        Supply a published https URL and the observed fact. The program maps that fact onto the
        round&apos;s side pair. You do not pick a winner.
      </p>

      {loading ? <p className="text-sm text-gray-500">Loading…</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {Object.entries(results).map(([id, result]) => (
        <div key={id} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          Derived side <span className="font-semibold">{result.derived_side}</span>
          {' · '}
          {result.children_graded} children graded
        </div>
      ))}

      {!loading && rounds.length === 0 ? (
        <p className="text-sm text-gray-500">No due operator-manual rounds waiting.</p>
      ) : null}

      {rounds.map((round) => {
        const draft = drafts[round.id] ?? { sourceUrl: '', observedFact: '' }
        const canSubmit = draft.sourceUrl.trim().startsWith('https://') && draft.observedFact.trim().length > 0
        return (
          <article key={round.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold leading-snug">{round.proposition_text}</p>
            <p className="mt-1 text-xs text-gray-600">
              Subject: {round.subject_label ?? '—'}
              {' · '}
              {round.side_a} / {round.side_b}
              {' · '}
              resolves {round.resolves_at.slice(0, 10)}
              {' · '}
              {round.days_waiting} day{round.days_waiting === 1 ? '' : 's'} waiting
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Models so far: {round.tally.a} {round.side_a} · {round.tally.b} {round.side_b}
              {round.tally.abstain ? ` · ${round.tally.abstain} no call` : ''}
              {' · '}
              {round.tally.total} total
            </p>

            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                void submit(round.id)
              }}
            >
              <label className="text-xs font-semibold text-gray-700">
                Source URL (https)
                <input
                  type="url"
                  required
                  value={draft.sourceUrl}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [round.id]: { ...draft, sourceUrl: e.target.value },
                    }))
                  }
                  placeholder="https://"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal"
                />
              </label>
              <label className="text-xs font-semibold text-gray-700">
                Observed fact
                <input
                  type="text"
                  required
                  maxLength={500}
                  value={draft.observedFact}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [round.id]: { ...draft, observedFact: e.target.value },
                    }))
                  }
                  placeholder="The published result, not yes/no or a winner pick"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal"
                />
              </label>
              <button
                type="submit"
                disabled={!canSubmit || submitting === round.id}
                className="self-start rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {submitting === round.id ? 'Deriving…' : 'Submit evidence'}
              </button>
            </form>
          </article>
        )
      })}
    </div>
  )
}
