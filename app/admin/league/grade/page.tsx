'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/db/supabase'
import { AdminNav } from '@/app/admin/AdminNav'
import type { ManualQueueItem, ManualSuggestion, ManualVerdict } from '@/lib/league/manual-grade/types'

const OWNER_EMAIL = 'hersky3107@gmail.com'

type Draft = {
  verdict: ManualVerdict | ''
  evidenceUrl: string
  note: string
}

const EMPTY_DRAFT: Draft = { verdict: '', evidenceUrl: '', note: '' }

export default function LeagueManualGradePage() {
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'allowed'>('checking')
  const [rounds, setRounds] = useState<ManualQueueItem[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [submitting, setSubmitting] = useState(false)
  const [suggestions, setSuggestions] = useState<Record<string, ManualSuggestion>>({})
  const [suggestingIds, setSuggestingIds] = useState<Record<string, boolean>>({})
  const [bulkMode, setBulkMode] = useState(false)
  const [electionBanner, setElectionBanner] = useState<{
    switchOn: boolean
    switchValue: string
    saving?: boolean
  } | null>(null)

  const selected = useMemo(() => rounds.find((r) => r.id === selectedId) ?? rounds[0] ?? null, [rounds, selectedId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/league/grade', { credentials: 'include' })
      const body = (await res.json()) as { rounds?: ManualQueueItem[]; pendingCount?: number; error?: string }
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`)
      const next = body.rounds ?? []
      setRounds(next)
      setPendingCount(body.pendingCount ?? next.length)
      setSelectedId((current) => (current && next.some((r) => r.id === current) ? current : next[0]?.id ?? null))
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
      try {
        const res = await fetch('/api/admin/league/blackout', { credentials: 'include' })
        const body = (await res.json().catch(() => null)) as {
          switch?: { on?: boolean; value?: string }
        }
        if (res.ok) {
          setElectionBanner({
            switchOn: Boolean(body?.switch?.on),
            switchValue: body?.switch?.value ?? 'off',
          })
        }
      } catch {
        setElectionBanner(null)
      }
    })()
  }, [load])

  const suggestionInflight = useRef(new Set<string>())

  const applySuggestionDraft = useCallback((roundId: string, suggestion: ManualSuggestion) => {
    setDrafts((prev) => {
      const existing = prev[roundId] ?? EMPTY_DRAFT
      const next: Draft = { ...existing }
      if (!existing.verdict && (suggestion.verdict === 'yes' || suggestion.verdict === 'no' || suggestion.verdict === 'void')) {
        next.verdict = suggestion.verdict
      }
      if (!existing.evidenceUrl && suggestion.source_url) next.evidenceUrl = suggestion.source_url
      if (next.verdict === existing.verdict && next.evidenceUrl === existing.evidenceUrl) return prev
      return { ...prev, [roundId]: next }
    })
  }, [])

  const fetchSuggestion = useCallback(
    async (roundId: string) => {
      if (suggestionInflight.current.has(roundId)) return
      suggestionInflight.current.add(roundId)
      setSuggestingIds((prev) => ({ ...prev, [roundId]: true }))
      try {
        const res = await fetch('/api/admin/league/grade/suggest', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roundId }),
        })
        const body = (await res.json()) as { suggestion?: ManualSuggestion }
        if (body.suggestion) {
          setSuggestions((prev) => ({ ...prev, [roundId]: body.suggestion! }))
          applySuggestionDraft(roundId, body.suggestion)
        }
      } catch {
        suggestionInflight.current.delete(roundId)
      } finally {
        setSuggestingIds((prev) => {
          if (!prev[roundId]) return prev
          const next = { ...prev }
          delete next[roundId]
          return next
        })
      }
    },
    [applySuggestionDraft]
  )

  useEffect(() => {
    if (!selected) return
    void fetchSuggestion(selected.id)
  }, [selected?.id, fetchSuggestion])

  useEffect(() => {
    if (!bulkMode) return
    let cancelled = false
    void (async () => {
      for (const round of rounds) {
        if (cancelled) return
        await fetchSuggestion(round.id)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bulkMode, rounds, fetchSuggestion])

  function draftFor(id: string): Draft {
    return drafts[id] ?? EMPTY_DRAFT
  }

  function patchDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...EMPTY_DRAFT, ...prev[id], ...patch } }))
  }

  async function submitOne(roundId: string, verdict: ManualVerdict) {
    const draft = draftFor(roundId)
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/league/grade', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roundId,
          verdict,
          evidenceUrl: draft.evidenceUrl,
          note: draft.note,
        }),
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'grade failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitBulk() {
    const items = rounds
      .map((r) => ({ roundId: r.id, ...draftFor(r.id) }))
      .filter((d) => d.verdict === 'yes' || d.verdict === 'no' || d.verdict === 'void')
    if (items.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/league/grade', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk',
          items: items.map((d) => ({
            roundId: d.roundId,
            verdict: d.verdict,
            evidenceUrl: d.evidenceUrl,
            note: d.note,
          })),
        }),
      })
      const body = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`)
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'bulk grade failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (authState === 'checking') {
    return <main className="min-h-screen bg-[#0a0f1e] p-6 text-sm text-slate-300">접근 확인 중…</main>
  }
  if (authState === 'denied') {
    return <main className="min-h-screen bg-[#0a0f1e] p-6 text-sm text-red-300">권한이 없습니다.</main>
  }

  const selectedDraft = selected ? draftFor(selected.id) : EMPTY_DRAFT
  const bulkReady = rounds.filter((r) => {
    const v = draftFor(r.id).verdict
    return v === 'yes' || v === 'no' || v === 'void'
  }).length

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm">
          <p className="font-semibold text-slate-100">한국 선거 수동 차단</p>
          <p className="mt-1 text-slate-400">
            자동 차단은 없습니다. ON이면 모든 이용자(한국·세계)의 KR 선거 카드/생성/딥이 닫힙니다. 미국 선거는 영향 없습니다.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={electionBanner?.saving}
              onClick={() => {
                void (async () => {
                  setElectionBanner((prev) => (prev ? { ...prev, saving: true } : prev))
                  const res = await fetch('/api/admin/league/blackout', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ value: 'all_kr' }),
                  })
                  const body = (await res.json().catch(() => null)) as { switch?: { on?: boolean; value?: string } }
                  setElectionBanner((prev) =>
                    prev
                      ? {
                          ...prev,
                          saving: false,
                          switchOn: Boolean(body.switch?.on),
                          switchValue: body.switch?.value ?? 'all_kr',
                        }
                      : {
                          switchOn: true,
                          switchValue: 'all_kr',
                        },
                  )
                })()
              }}
              className="rounded-xl bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
            >
              한국 선거 전부 차단
            </button>
            <button
              type="button"
              disabled={electionBanner?.saving}
              onClick={() => {
                void (async () => {
                  setElectionBanner((prev) => (prev ? { ...prev, saving: true } : prev))
                  const res = await fetch('/api/admin/league/blackout', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ value: 'off' }),
                  })
                  const body = (await res.json().catch(() => null)) as { switch?: { on?: boolean; value?: string } }
                  setElectionBanner((prev) =>
                    prev
                      ? { ...prev, saving: false, switchOn: Boolean(body.switch?.on), switchValue: body.switch?.value ?? 'off' }
                      : { switchOn: false, switchValue: 'off' },
                  )
                })()
              }}
              className="rounded-xl border border-white/12 bg-white/6 px-3 py-1.5 text-xs font-semibold hover:bg-white/8"
            >
              차단 해제
            </button>
            <span className="self-center text-xs text-slate-400">
              현재: {electionBanner?.switchOn ? 'ON' : 'OFF'} ({electionBanner?.switchValue ?? '…'})
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">리그 — 수동 채점</h1>
            <p className="mt-1 text-sm text-slate-400">
              스포츠·정치·엔터 등 자동 시세가 없는 라운드만 여기로 옵니다. 시세 종목은 Twelve Data가 자동 채점합니다.
            </p>
          </div>
          <AdminNav />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-white/12 bg-white/6 px-3 py-1.5 text-sm font-semibold hover:bg-white/8"
          >
            새로고침
          </button>
          <button
            type="button"
            onClick={() => setBulkMode((v) => !v)}
            className="rounded-xl border border-white/12 bg-white/6 px-3 py-1.5 text-sm font-semibold hover:bg-white/8"
          >
            {bulkMode ? '단일 판정' : '일괄 채점'}
          </button>
          {pendingCount > 0 ? (
            <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold">채점 대기 {pendingCount}건</span>
          ) : (
            <span className="text-xs text-slate-500">채점 대기 0건</span>
          )}
        </div>

        {loading ? <p className="text-sm text-slate-400">불러오는 중…</p> : null}
        {error ? <p className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}

        {bulkMode ? (
          <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 text-xs text-slate-400">
                <tr>
                  <th className="px-3 py-2">명제</th>
                  <th className="px-3 py-2">카테고리</th>
                  <th className="px-3 py-2">판정</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8">
                {rounds.map((round) => {
                  const draft = draftFor(round.id)
                  return (
                    <tr key={round.id}>
                      <td className="px-3 py-2 text-slate-100">
                        <p>{round.proposition_ko || round.proposition_text}</p>
                        {round.proposition_en && round.proposition_en !== (round.proposition_ko || round.proposition_text) ? (
                          <p className="mt-0.5 text-[11px] text-slate-500">{round.proposition_en}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-slate-400">{round.category}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex gap-2">
                            {(['yes', 'no', 'void'] as const).map((v) => (
                              <label key={v} className="flex items-center gap-1 text-xs">
                                <input
                                  type="radio"
                                  name={`bulk-${round.id}`}
                                  checked={draft.verdict === v}
                                  onChange={() => patchDraft(round.id, { verdict: v })}
                                />
                                {v === 'yes' ? 'YES / 승리' : v === 'no' ? 'NO / 패배' : '무효 / VOID'}
                              </label>
                            ))}
                          </div>
                          <p className="text-[11px] text-amber-200/80">
                            {suggestingIds[round.id] && !suggestions[round.id]
                              ? 'AI 제안 검색 중…'
                              : suggestions[round.id]
                                ? `제안 ${suggestions[round.id].verdict.toUpperCase()} · ${Math.round(suggestions[round.id].confidence * 100)}% — 확정 전까지 적용되지 않음`
                                : '제안 없음'}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="border-t border-white/10 px-3 py-3">
              <button
                type="button"
                disabled={submitting || bulkReady === 0}
                onClick={() => void submitBulk()}
                className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold hover:bg-cyan-500 disabled:opacity-50"
              >
                일괄 확정 ({bulkReady}건)
              </button>
            </div>
          </section>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_1fr]">
            <aside className="rounded-2xl border border-white/10 bg-white/[0.04]">
              {rounds.length === 0 && !loading ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">대기 중인 수동 채점 라운드가 없습니다.</p>
              ) : (
                <ul className="divide-y divide-white/8">
                  {rounds.map((round) => (
                    <li key={round.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(round.id)}
                        className={`w-full px-4 py-3 text-left text-sm ${
                          selected?.id === round.id ? 'bg-cyan-500/15' : 'hover:bg-white/5'
                        }`}
                      >
                        <p className="font-semibold leading-snug text-white">{round.proposition_ko || round.proposition_text}</p>
                        {round.proposition_en && round.proposition_en !== (round.proposition_ko || round.proposition_text) ? (
                          <p className="mt-0.5 text-[10px] font-normal text-slate-500">{round.proposition_en}</p>
                        ) : null}
                        <p className="mt-1 text-[11px] text-slate-400">
                          {round.category} · {round.resolves_at.slice(0, 16).replace('T', ' ')} UTC
                          {' · '}
                          {round.creator_user_id ? `생성자 ${round.creator_user_id.slice(0, 8)}` : '생성자 —'}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </aside>

            {selected ? (
              <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <p className="text-xs uppercase tracking-wide text-slate-500">명제</p>
                <h2 className="mt-1 text-lg font-semibold leading-snug">{selected.proposition_ko || selected.proposition_text}</h2>
                {selected.proposition_en && selected.proposition_en !== (selected.proposition_ko || selected.proposition_text) ? (
                  <p className="mt-1 text-xs text-slate-500">{selected.proposition_en}</p>
                ) : null}
                <p className="mt-3 text-sm text-slate-300">
                  <span className="text-slate-500">판정 기준:</span> {selected.resolution_rule_ko || selected.resolution_rule || '—'}
                </p>
                {selected.resolution_rule &&
                selected.resolution_rule_ko &&
                selected.resolution_rule !== selected.resolution_rule_ko ? (
                  <p className="mt-1 text-xs text-slate-500">{selected.resolution_rule}</p>
                ) : null}
                <p className="mt-2 text-xs text-slate-400">
                  {selected.category} · {selected.instrument} · {selected.horizon}
                  {' · '}
                  생성 {selected.created_at?.slice(0, 16).replace('T', ' ') ?? '—'}
                  {' · '}
                  생성자 {selected.creator_user_id ?? '—'}
                  {' · '}
                  청구 {selected.charged_credits} cr
                </p>
                <p className="mt-2 text-xs text-slate-400">
                  A측: {selected.side_a} · B측: {selected.side_b}
                </p>

                {selected.null_seats.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">미응답 좌석 (관리자)</p>
                    <ul className="mt-2 space-y-1">
                      {selected.null_seats.map((seat) => (
                        <li key={seat.model_id} className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono text-slate-200">{seat.model_id}</span>
                          <span className="text-slate-500">미응답</span>
                          {seat.fail_reason ? (
                            <span className="font-mono text-amber-300">{seat.fail_reason}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {selected.seat_counters.length > 0 ? (
                  <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">가장 강한 반론 (관리자)</p>
                    <ul className="mt-2 space-y-1">
                      {selected.seat_counters.map((seat) => (
                        <li key={seat.model_id} className="text-xs text-slate-300">
                          <span className="font-mono text-slate-200">{seat.model_id}</span>
                          <span className="mx-2 text-slate-600">·</span>
                          {seat.strongest_counter}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-200">AI 제안 (자동 적용 안 함)</p>
                  {suggestingIds[selected.id] && !suggestions[selected.id] ? (
                    <p className="mt-1 text-slate-300">검색 중…</p>
                  ) : suggestions[selected.id] ? (
                    <>
                      <p className="mt-1 text-white">
                        {suggestions[selected.id].verdict.toUpperCase()} · 신뢰도 {Math.round(suggestions[selected.id].confidence * 100)}%
                      </p>
                      <p className="mt-1 text-slate-200">{suggestions[selected.id].summary || '요약 없음'}</p>
                      {suggestions[selected.id].source_url ? (
                        <p className="mt-1 truncate text-xs text-cyan-300">{suggestions[selected.id].source_url}</p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-1 text-slate-400">제안 없음 — 관리자가 직접 판정합니다.</p>
                  )}
                </div>

                <label className="mt-4 block text-xs font-semibold text-slate-400">
                  근거 URL
                  <input
                    type="url"
                    value={selectedDraft.evidenceUrl}
                    onChange={(e) => patchDraft(selected.id, { evidenceUrl: e.target.value })}
                    placeholder="https://"
                    className="mt-1 w-full rounded-xl border border-white/12 bg-white/6 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="mt-3 block text-xs font-semibold text-slate-400">
                  관리자 메모
                  <input
                    type="text"
                    value={selectedDraft.note}
                    onChange={(e) => patchDraft(selected.id, { note: e.target.value })}
                    placeholder="2-1 정규시간 / 연기 사유"
                    className="mt-1 w-full rounded-xl border border-white/12 bg-white/6 px-3 py-2 text-sm text-white"
                  />
                </label>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void submitOne(selected.id, 'yes')}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
                  >
                    YES / 승리
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void submitOne(selected.id, 'no')}
                    className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-500 disabled:opacity-50"
                  >
                    NO / 패배
                  </button>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void submitOne(selected.id, 'void')}
                    className="rounded-xl border border-white/20 bg-white/6 px-4 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-50"
                  >
                    무효 / VOID
                  </button>
                </div>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </main>
  )
}
