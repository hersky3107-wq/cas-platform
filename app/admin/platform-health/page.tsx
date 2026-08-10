'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/db/supabase'

const OWNER_EMAIL = 'hersky3107@gmail.com'

type PlatformLeague = 'premier' | 'challenger' | 'world' | 'scout' | 'sovereign'

type HealthResult = {
  id: string
  provider: string
  brand: string
  model: string
  league: PlatformLeague
  ok: boolean
  latencyMs: number
  error?: string
  /** Core-router rows only: no BYOK key saved in /settings for this provider. */
  keyMissing?: boolean
  /** Core-router rows only: which of the two rows per brand this is. */
  tier?: 'current' | 'top-tier'
}

const TIER_LABEL: Record<'current' | 'top-tier', string> = {
  current: '현재 프로덕션',
  'top-tier': '탑티어 (주식 모듈 후보)',
}

type BalanceRow =
  | {
      provider: string
      label: string
      kind: 'balance'
      remainingUsd: number | null
      details?: Record<string, number | string | null>
      error?: string
    }
  | {
      provider: string
      label: string
      kind: 'link'
      billingUrl: string
      note: string
    }

const LEAGUE_ORDER: PlatformLeague[] = ['premier', 'challenger', 'world', 'scout', 'sovereign']

const LEAGUE_META: Record<PlatformLeague, { title: string; subtitle: string }> = {
  premier: { title: 'PREMIER (1부)', subtitle: '주력 플랫폼 모델' },
  challenger: { title: 'CHALLENGER (2부)', subtitle: '강력한 2군 라인업' },
  world: { title: 'WORLD (3부)', subtitle: '폭넓은 해외 커버리지' },
  scout: { title: 'SCOUT', subtitle: '검색 / 리서치 에이전트' },
  sovereign: { title: 'SOVEREIGN', subtitle: '국내 특화 스택' },
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

export default function PlatformHealthPage() {
  const [authState, setAuthState] = useState<'checking' | 'denied' | 'allowed'>('checking')
  const [healthLoading, setHealthLoading] = useState(false)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [results, setResults] = useState<HealthResult[]>([])
  const [balances, setBalances] = useState<BalanceRow[]>([])
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.auth.getUser()
      const email = data.user?.email ?? ''
      if (error || !email || email.toLowerCase() !== OWNER_EMAIL.toLowerCase()) {
        setAuthState('denied')
      } else {
        setAuthState('allowed')
      }
    })()
  }, [])

  const runHealth = useCallback(async () => {
    setHealthLoading(true)
    setHealthError(null)
    try {
      const res = await fetch('/api/admin/platform-providers/health', {
        method: 'GET',
        credentials: 'include',
      })
      const json = (await res.json().catch(() => null)) as {
        results?: HealthResult[]
        error?: string
      }
      if (!res.ok) throw new Error(json?.error ?? `상태 확인 요청 실패 (${res.status})`)
      setResults(Array.isArray(json?.results) ? json.results : [])
      setLastCheckedAt(new Date().toISOString())
    } catch (e: unknown) {
      setHealthError(e instanceof Error ? e.message : '알 수 없는 상태 확인 오류')
    } finally {
      setHealthLoading(false)
    }
  }, [])

  const runBalance = useCallback(async () => {
    setBalanceLoading(true)
    setBalanceError(null)
    try {
      const res = await fetch('/api/admin/platform-providers/balance', {
        method: 'GET',
        credentials: 'include',
      })
      const json = (await res.json().catch(() => null)) as {
        balances?: BalanceRow[]
        error?: string
      }
      if (!res.ok) throw new Error(json?.error ?? `잔액 조회 요청 실패 (${res.status})`)
      setBalances(Array.isArray(json?.balances) ? json.balances : [])
    } catch (e: unknown) {
      setBalanceError(e instanceof Error ? e.message : '알 수 없는 잔액 조회 오류')
    } finally {
      setBalanceLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authState !== 'allowed') return
    void runHealth()
    void runBalance()
  }, [authState, runHealth, runBalance])

  const passing = useMemo(() => results.filter((r) => r.ok).length, [results])
  const total = results.length

  const byLeague = useMemo(() => {
    const map = new Map<PlatformLeague, HealthResult[]>()
    for (const league of LEAGUE_ORDER) map.set(league, [])
    for (const r of results) {
      const list = map.get(r.league) ?? []
      list.push(r)
      map.set(r.league, list)
    }
    return map
  }, [results])

  if (authState === 'checking') {
    return (
      <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
        <div className="mx-auto max-w-5xl rounded-2xl border border-white/10 bg-white/[0.04] p-6 text-center text-sm text-slate-300">
          불러오는 중…
        </div>
      </main>
    )
  }

  if (authState === 'denied') {
    return (
      <div style={{ background: '#0a0f1e', color: 'white', padding: '20px', minHeight: '100vh' }}>
        접근 권한이 없습니다
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-10 text-white">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              <Link href="/admin" className="text-cyan-300 hover:underline">
                관리자
              </Link>{' '}
              / 플랫폼 상태
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">플랫폼 제공자 상태</h1>
            <p className="mt-1 text-sm text-slate-400">
              OpenRouter / Meta Muse / You.com / CLOVA 실시간 점검 + 코어 라우터(GPT·Claude·Gemini·Grok·DeepSeek·Mistral)를
              관리자 본인의 /settings 저장 키로 직접 점검합니다. 코어 라우터는 브랜드마다 현재 프로덕션 모델과
              주식 비교 모듈 후보 탑티어 모델을 각각 점검합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runHealth()}
            disabled={healthLoading}
            className="rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            {healthLoading ? '확인 중…' : '상태 재확인'}
          </button>
        </div>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">요약</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-white">
                {healthLoading && total === 0 ? '…' : `${passing} / ${total}`}
                <span className="ml-2 text-base font-medium text-slate-400">정상</span>
              </p>
            </div>
            {lastCheckedAt ? (
              <p className="text-xs text-slate-500">
                마지막 확인: {new Date(lastCheckedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          {healthError ? (
            <p className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {healthError}
            </p>
          ) : null}
        </section>

        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">잔액</h2>
            <button
              type="button"
              onClick={() => void runBalance()}
              disabled={balanceLoading}
              className="rounded-xl border border-white/12 bg-white/6 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/8 disabled:opacity-50"
            >
              {balanceLoading ? '갱신 중…' : '잔액 갱신'}
            </button>
          </div>
          {balanceError ? (
            <p className="mb-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
              {balanceError}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {balanceLoading && balances.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4 text-sm text-slate-400 sm:col-span-2">
                잔액 불러오는 중…
              </div>
            ) : (
              balances.map((b) => {
                if (b.kind === 'link') {
                  return (
                    <div
                      key={b.provider}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4"
                    >
                      <p className="text-xs uppercase tracking-wide text-slate-500">{b.label}</p>
                      <p className="mt-2 text-sm text-slate-300">{b.note}</p>
                      <a
                        href={b.billingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex text-sm font-semibold text-cyan-300 hover:underline"
                      >
                        결제 페이지 열기 ↗
                      </a>
                    </div>
                  )
                }

                return (
                  <div
                    key={b.provider}
                    className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4"
                  >
                    <p className="text-xs uppercase tracking-wide text-slate-500">{b.label}</p>
                    {b.error ? (
                      <p className="mt-2 text-sm text-rose-200">{b.error}</p>
                    ) : (
                      <p className="mt-2 text-2xl font-bold tabular-nums text-white">
                        {formatUsd(b.remainingUsd)}
                        <span className="ml-2 text-sm font-medium text-slate-400">남음</span>
                      </p>
                    )}
                    {typeof b.details?.billingUrl === 'string' ? (
                      <a
                        href={b.details.billingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex text-sm font-semibold text-cyan-300 hover:underline"
                      >
                        결제 페이지 열기 ↗
                      </a>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </section>

        {LEAGUE_ORDER.map((league) => {
          const meta = LEAGUE_META[league]
          const rows = byLeague.get(league) ?? []
          return (
            <section key={league}>
              <div className="mb-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  {meta.title}
                </h2>
                <p className="text-xs text-slate-500">{meta.subtitle}</p>
              </div>

              <div className="space-y-2">
                {healthLoading && rows.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-400">
                    확인 중…
                  </div>
                ) : null}

                {rows.map((r) => {
                  if (r.keyMissing) {
                    return (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-3"
                      >
                        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-slate-600" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-300">
                            {r.brand}
                            {r.tier ? (
                              <span className="ml-2 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-medium normal-case text-slate-400">
                                {TIER_LABEL[r.tier]}
                              </span>
                            ) : null}
                            <span className="ml-2 font-normal text-slate-500">{r.model}</span>
                          </p>
                        </div>
                        <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          키 미설정
                        </p>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3"
                    >
                      <span
                        className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                          r.ok ? 'bg-emerald-400' : 'bg-rose-400'
                        }`}
                        title={r.ok ? '정상' : '실패'}
                        aria-label={r.ok ? '정상' : '실패'}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-white">
                          {r.brand}
                          {r.tier ? (
                            <span
                              className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-medium normal-case ${
                                r.tier === 'top-tier'
                                  ? 'border-cyan-400/30 text-cyan-300'
                                  : 'border-white/10 text-slate-400'
                              }`}
                            >
                              {TIER_LABEL[r.tier]}
                            </span>
                          ) : null}
                          <span className="ml-2 font-normal text-slate-400">{r.model}</span>
                        </p>
                        {!r.ok && r.error ? (
                          <p className="mt-0.5 truncate text-xs text-rose-200/90" title={r.error}>
                            {r.error}
                          </p>
                        ) : null}
                      </div>
                      <p className="shrink-0 tabular-nums text-sm text-slate-300">
                        {r.latencyMs.toLocaleString()} ms
                      </p>
                      <p
                        className={`shrink-0 text-xs font-semibold uppercase tracking-wide ${
                          r.ok ? 'text-emerald-300' : 'text-rose-300'
                        }`}
                      >
                        {r.ok ? '정상' : '실패'}
                      </p>
                    </div>
                  )
                })}

                {!healthLoading && rows.length === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-500">
                    이 리그에는 모델이 없습니다.
                  </div>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>
    </main>
  )
}
