'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { authenticatedFetch } from '@/lib/api/authenticated-fetch'
import { CRISIS_BRIEF_CREDITS } from '@/lib/crisis/credits'
import { languageLabel, noveltyBadge } from '@/lib/crisis/public/labels'
import { supabase } from '@/lib/db/supabase'

type LockedCard = {
  runId: string
  regionName: string
  country: string
  locked: true
  headline_ko: string
}

type UnlockedCard = {
  runId: string
  regionName: string
  country: string
  locked: false
  headline_ko: string
  summary_ko: string
  headlines: Array<{
    title: string
    novelty: string
    noveltyBadge: string | null
    what_to_do_ko: string[]
    what_to_do_local: string[]
    localLanguage: string
    official_links: Array<{ label: string; url: string }>
    evidence: Array<{ ref: string; url?: string }>
  }>
  missed_by_others: Array<{
    title: string
    novelty: string
    noveltyBadge: string | null
    what_to_do_ko: string[]
    what_to_do_local: string[]
    localLanguage: string
    official_links: Array<{ label: string; url: string }>
    evidence: Array<{ ref: string; url?: string }>
  }>
  baseline_risks: Array<{ title: string; stage: number; possibility: string; what_to_do: string[]; reason?: string }>
  novelty: { only_us: number; also_seen_elsewhere: number }
  evidence: string[]
}

type Card = LockedCard | UnlockedCard

export default function CrisisBriefingPage() {
  const [ready, setReady] = useState(false)
  const [cards, setCards] = useState<Card[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    const res = await authenticatedFetch('/api/crisis/briefing')
    const body = (await res.json().catch(() => null)) as { cards?: Card[]; error?: string }
    if (!res.ok) throw new Error(body?.error ?? '브리핑을 불러오지 못했습니다')
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
        setError(e instanceof Error ? e.message : '브리핑을 불러오지 못했습니다')
      }
    })()
  }, [])

  async function unlock(runId: string) {
    if (busy) return
    setBusy(runId)
    setError(null)
    try {
      const res = await authenticatedFetch('/api/crisis/briefing', { method: 'POST', json: { runId } })
      const body = (await res.json().catch(() => null)) as { card?: UnlockedCard; error?: string }
      if (res.status === 402) throw new Error('크레딧이 부족합니다')
      if (!res.ok) throw new Error(body?.error ?? '잠금 해제에 실패했습니다')
      if (body.card) {
        setCards((prev) => prev.map((card) => (card.runId === runId ? body.card! : card)))
      } else {
        await load()
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '잠금 해제에 실패했습니다')
    } finally {
      setBusy(null)
    }
  }

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0f1e] text-slate-400">Loading…</main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">CrisisWatch</p>
            <h1 className="text-2xl font-bold">오늘의 공개 브리핑</h1>
            <p className="mt-1 text-sm text-slate-400">잠긴 카드는 제목만 보입니다. 잠금 해제 {CRISIS_BRIEF_CREDITS}크레딧.</p>
          </div>
          <Link href="/crisis" className="rounded-xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-slate-200">
            ← 지도
          </Link>
        </div>

        {error ? (
          <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
        ) : null}

        {cards.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-10 text-center text-sm text-slate-400">
            오늘 공개된 카드가 없습니다.
          </p>
        ) : (
          <div className="space-y-4">
            {cards.map((card) =>
              card.locked ? (
                <article key={card.runId} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-4">
                  <p className="text-xs text-slate-500">
                    {card.regionName} / {card.country}
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">{card.headline_ko}</h2>
                  <button
                    type="button"
                    onClick={() => void unlock(card.runId)}
                    disabled={busy !== null}
                    className="mt-3 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                  >
                    {busy === card.runId ? '해제 중…' : `${CRISIS_BRIEF_CREDITS}크레딧으로 열기`}
                  </button>
                </article>
              ) : (
                <UnlockedView key={card.runId} card={card} />
              ),
            )}
          </div>
        )}
      </div>
    </main>
  )
}

function UnlockedView({ card }: { card: UnlockedCard }) {
  return (
    <article className="space-y-4 rounded-2xl border border-cyan-400/20 bg-white/[0.04] px-4 py-4">
      <div>
        <p className="text-xs text-slate-500">
          {card.regionName} / {card.country}
        </p>
        <h2 className="mt-1 text-lg font-semibold">{card.headline_ko}</h2>
        <p className="mt-2 text-sm text-slate-300">{card.summary_ko}</p>
        <p className="mt-2 text-xs text-slate-500">
          새로움 · 우리만 {card.novelty.only_us} · 다른 곳에도 {card.novelty.also_seen_elsewhere}
        </p>
      </div>
      <Tier title="헤드라인" rows={card.headlines} />
      <Tier title="다른 곳이 놓친 것" rows={card.missed_by_others} />
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">기저 위험</h3>
        <ul className="space-y-2">
          {card.baseline_risks.map((row) => (
            <li key={row.title} className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-sm">
              <p className="font-semibold">{row.title}</p>
              <p className="text-xs text-slate-400">
                stage {row.stage} · {row.possibility}
              </p>
              <ul className="mt-1 list-disc pl-4 text-xs text-slate-300">
                {row.what_to_do.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
      {card.evidence.length > 0 ? (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">근거 링크</h3>
          <ul className="space-y-1 text-xs">
            {card.evidence.slice(0, 12).map((url) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  )
}

function Tier({
  title,
  rows,
}: {
  title: string
  rows: UnlockedCard['headlines']
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">없음</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.title} className="rounded-xl border border-white/10 bg-[#0b1020] px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{row.title}</p>
                {row.noveltyBadge || noveltyBadge(row.novelty) ? (
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold text-amber-200">
                    {row.noveltyBadge ?? noveltyBadge(row.novelty)}
                  </span>
                ) : null}
              </div>
              <div className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                <div>
                  <p className="mb-1 font-semibold text-slate-500">할 일 · 한국어</p>
                  <ul className="list-disc pl-4">
                    {row.what_to_do_ko.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-1 font-semibold text-slate-500">할 일 · {languageLabel(row.localLanguage)}</p>
                  <ul className="list-disc pl-4">
                    {row.what_to_do_local.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {row.official_links.map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300 hover:underline">
                    {link.label}
                  </a>
                ))}
                {row.evidence
                  .filter((item) => item.url)
                  .map((item) => (
                    <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-cyan-300/80 hover:underline">
                      {item.ref}
                    </a>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
