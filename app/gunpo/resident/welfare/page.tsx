'use client'

/**
 * 복지·행정 — Gunpo resident welfare / administration chip. Cloned from
 * app/jeju/resident/welfare/page.tsx. THREE tabs:
 *   1. 지원금 찾기  → POST /api/gunpo/resident/welfare/match
 *   2. 민원 안내    → GET  /api/gunpo/resident/welfare/guide?topic=
 *   3. 마감 임박 공고 → GET  /api/gunpo/resident/welfare
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/gunpo/FriendlyErrors'

interface ContextMeta {
  source: string
  retrievedAt: string
  asOf: string | null
}
interface SubsidyItem {
  name: string
  org: string | null
  target: string | null
  deadline: string | null
  how: string | null
  url: string | null
  source: '보조금24' | '검색'
  asOf: string | null
  note: string | null
  deadlineDate: string | null
}
interface MatchResult {
  ok: boolean
  matches: SubsidyItem[]
  contextMeta: ContextMeta | null
  disclaimer: string
  errors: string[]
}
interface WelfarePayload {
  ok: true
  deadlineSoon: SubsidyItem[]
  windowDays: number
  today: string
  contextMeta: ContextMeta | null
  disclaimer: string
  freshnessNote: string
  updatedAt: string
  errors: string[]
  fromCache: boolean
}
interface GuideStep {
  step: number
  text: string
}
interface GuideResult {
  ok: boolean
  topic: string
  intro: string
  steps: GuideStep[]
  documents: string[]
  where: string | null
  contextMeta: ContextMeta | null
  disclaimer: string
  errors: string[]
  fromCache: boolean
}

type Tab = 'deadline' | 'match' | 'guide'

const SITUATION_CHIPS = ['임산부', '장애인', '노인', '한부모', '청년', '이주민', '저소득', '농어업인']
const HOUSEHOLD_CHIPS = ['1인 가구', '2인 가구', '다자녀 가구', '노인 가구', '영유아 가구']
const GUIDE_TOPICS = [
  '전입신고',
  '종량제봉투 구입',
  '자동차 등록',
  '건축 신고',
  '출생신고',
  '사망신고',
  '주민등록등본 발급',
  '대형폐기물 신고',
  '전월세 신고',
  '여권 발급',
]

function daysUntil(dateStr: string | null, today: string): number | null {
  if (!dateStr) return null
  const t = new Date(today).getTime()
  const d = new Date(dateStr).getTime()
  return Math.ceil((d - t) / 86400000)
}

function fmtProvenance(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회` : `🔍 검색 · ${date} 조회`
}

function SubsidyCard({ item, today }: { item: SubsidyItem; today: string }) {
  const days = daysUntil(item.deadlineDate, today)
  return (
    <article className="flex flex-col gap-1.5 rounded-xl border-2 border-[#E2E8F0] bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-2 py-0.5 text-xs font-bold ${
            item.source === '보조금24' ? 'bg-[#DBEAFE] text-[#1E40AF]' : 'bg-[#E0E7FF] text-[#1E3A8A]'
          }`}
        >
          {item.source}
        </span>
        {days != null && days >= 0 && (
          <span className="rounded bg-[#FFEDD5] px-2 py-0.5 text-xs font-bold text-[#C2410C]">D-{days}</span>
        )}
        <h3 className="text-base font-bold text-[#0F172A]">{item.name}</h3>
      </div>
      {item.org && <p className="text-sm text-[#475569]">🏢 {item.org}</p>}
      {item.target && <p className="text-sm text-[#475569]">👥 {item.target}</p>}
      {item.deadline && <p className="text-sm text-[#475569]">⏰ {item.deadline}</p>}
      {item.how && <p className="text-sm text-[#475569]">📝 {item.how}</p>}
      {item.note && <p className="rounded-md bg-[#FEF3C7] px-2 py-1 text-xs text-[#8A3F04]">{item.note}</p>}
      {item.url && (
        <a href={item.url} target="_blank" rel="noreferrer" className="text-xs font-bold text-[#1E3A8A] underline">
          자세히 보기
        </a>
      )}
    </article>
  )
}

export default function GunpoWelfarePage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('deadline')

  const [age, setAge] = useState('')
  const [job, setJob] = useState('')
  const [situation, setSituation] = useState('')
  const [household, setHousehold] = useState('')
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [matchError, setMatchError] = useState<string | null>(null)

  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [guideLoading, setGuideLoading] = useState(false)
  const [guide, setGuide] = useState<GuideResult | null>(null)
  const [guideError, setGuideError] = useState<string | null>(null)

  const [welfare, setWelfare] = useState<WelfarePayload | null>(null)
  const [welfareLoading, setWelfareLoading] = useState(true)
  const [welfareError, setWelfareError] = useState<string | null>(null)

  const today = welfare?.today ?? new Date().toISOString().slice(0, 10)

  useEffect(() => {
    void (async () => {
      setWelfareLoading(true)
      setWelfareError(null)
      try {
        const res = await fetch('/api/gunpo/resident/welfare', { cache: 'no-store' })
        const json = (await res.json()) as WelfarePayload | { ok: false; error: string }
        if (!json.ok) setWelfareError((json as { ok: false; error: string }).error)
        else setWelfare(json as WelfarePayload)
      } catch {
        setWelfareError('복지 정보를 불러오지 못했어요.')
      } finally {
        setWelfareLoading(false)
      }
    })()
  }, [])

  const onMatch = useCallback(async () => {
    if (matchLoading) return
    setMatchLoading(true)
    setMatchError(null)
    setMatchResult(null)
    try {
      const body = {
        ...(age.trim() && Number.isFinite(Number(age)) ? { age: Number(age) } : {}),
        ...(job.trim() ? { job: job.trim() } : {}),
        ...(situation.trim() ? { situation: situation.trim() } : {}),
        ...(household.trim() ? { household: household.trim() } : {}),
      }
      const res = await fetch('/api/gunpo/resident/welfare/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as MatchResult
      setMatchResult(json)
    } catch {
      setMatchError('지원금 검색에 실패했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setMatchLoading(false)
    }
  }, [age, job, situation, household, matchLoading])

  const onGuideSelect = useCallback(async (topic: string) => {
    setSelectedTopic(topic)
    setGuideLoading(true)
    setGuideError(null)
    setGuide(null)
    try {
      const res = await fetch(`/api/gunpo/resident/welfare/guide?topic=${encodeURIComponent(topic)}`, { cache: 'no-store' })
      const json = (await res.json()) as GuideResult
      setGuide(json)
    } catch {
      setGuideError('안내를 불러오지 못했어요.')
    } finally {
      setGuideLoading(false)
    }
  }, [])

  const TABS: { key: Tab; label: string }[] = [
    { key: 'deadline', label: '마감 임박' },
    { key: 'match', label: '지원금 찾기' },
    { key: 'guide', label: '민원 안내' },
  ]

  return (
    <div className="min-h-dvh bg-[#F3F6FB] text-[#0F172A]">
      <div className="sticky top-0 z-10 flex items-center gap-4 bg-[#1E3A8A] px-4 py-4 shadow-md">
        <button
          type="button"
          onClick={() => router.push('/gunpo/resident/general')}
          className="min-h-[48px] rounded-xl border-2 border-white/30 bg-white/15 px-4 text-lg font-bold text-white transition hover:bg-white/25"
        >
          ← 뒤로
        </button>
        <h1 className="text-2xl font-black text-white">🏥 복지·행정</h1>
      </div>

      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-6">
        <div className="flex gap-2" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`min-h-[44px] flex-1 rounded-xl border-2 px-3 text-sm font-bold transition ${
                tab === t.key ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-[#CBD5E1] bg-white text-[#334155]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'deadline' && (
          <>
            {welfareLoading && <p className="py-8 text-center text-lg font-bold text-[#334155]">불러오는 중…</p>}
            {!welfareLoading && welfareError && <p className="text-red-700">⚠ {welfareError}</p>}
            {!welfareLoading && welfare && (
              <>
                <p className="rounded-xl bg-[#E0E7FF] px-4 py-2 text-sm font-semibold text-[#1E3A8A]">{welfare.freshnessNote}</p>
                {welfare.deadlineSoon.length === 0 ? (
                  <p className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-6 text-[#64748B]">
                    앞으로 {welfare.windowDays}일 이내 마감되는 공고가 없어요.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {welfare.deadlineSoon.map((it, i) => (
                      <SubsidyCard key={i} item={it} today={today} />
                    ))}
                  </div>
                )}
                {welfare.contextMeta && <p className="text-sm text-[#64748B]">{fmtProvenance(welfare.contextMeta)}</p>}
                <p className="text-sm font-semibold text-[#8A3F04]">{welfare.disclaimer}</p>
                <FriendlyErrors errors={welfare.errors} />
              </>
            )}
          </>
        )}

        {tab === 'match' && (
          <>
            <div className="flex flex-col gap-3 rounded-2xl border-2 border-[#CBD5E1] bg-white p-4">
              <input
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="나이 (선택)"
                className="min-h-[44px] rounded-lg border-2 border-[#CBD5E1] px-3 text-base"
              />
              <input
                type="text"
                value={job}
                onChange={(e) => setJob(e.target.value)}
                placeholder="직업/상황 (선택)"
                className="min-h-[44px] rounded-lg border-2 border-[#CBD5E1] px-3 text-base"
              />
              <div className="flex flex-wrap gap-2">
                {SITUATION_CHIPS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSituation(s)}
                    className={`min-h-[36px] rounded-full border-2 px-3 text-sm font-semibold ${
                      situation === s ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-[#CBD5E1] bg-white text-[#334155]'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {HOUSEHOLD_CHIPS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => setHousehold(h)}
                    className={`min-h-[36px] rounded-full border-2 px-3 text-sm font-semibold ${
                      household === h ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-[#CBD5E1] bg-white text-[#334155]'
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void onMatch()}
                disabled={matchLoading}
                className="min-h-[48px] rounded-xl bg-[#1E3A8A] text-lg font-bold text-white disabled:opacity-60"
              >
                {matchLoading ? '검색 중…' : '지원금 찾기'}
              </button>
            </div>

            {matchError && <p className="text-red-700">⚠ {matchError}</p>}
            {matchResult && (
              <>
                {matchResult.matches.length === 0 ? (
                  <p className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-6 text-[#64748B]">해당하는 지원금을 찾지 못했어요.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {matchResult.matches.map((it, i) => (
                      <SubsidyCard key={i} item={it} today={today} />
                    ))}
                  </div>
                )}
                {matchResult.contextMeta && <p className="text-sm text-[#64748B]">{fmtProvenance(matchResult.contextMeta)}</p>}
                <p className="text-sm font-semibold text-[#8A3F04]">{matchResult.disclaimer}</p>
                <FriendlyErrors errors={matchResult.errors} />
              </>
            )}
          </>
        )}

        {tab === 'guide' && (
          <>
            <div className="flex flex-wrap gap-2">
              {GUIDE_TOPICS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => void onGuideSelect(t)}
                  className={`min-h-[40px] rounded-full border-2 px-3 text-sm font-semibold ${
                    selectedTopic === t ? 'border-[#1E3A8A] bg-[#1E3A8A] text-white' : 'border-[#CBD5E1] bg-white text-[#334155]'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {guideLoading && <p className="py-6 text-center text-lg font-bold text-[#334155]">불러오는 중…</p>}
            {!guideLoading && guideError && <p className="text-red-700">⚠ {guideError}</p>}
            {!guideLoading && guide && guide.ok && (
              <div className="rounded-2xl border-2 border-[#CBD5E1] bg-white p-5">
                <h2 className="mb-2 text-lg font-black text-[#1E3A8A]">{guide.topic}</h2>
                {guide.intro && <p className="mb-3 text-base text-[#334155]">{guide.intro}</p>}
                <ol className="flex flex-col gap-2">
                  {guide.steps.map((s) => (
                    <li key={s.step} className="text-base text-[#334155]">
                      <span className="font-bold text-[#1E3A8A]">{s.step}.</span> {s.text}
                    </li>
                  ))}
                </ol>
                {guide.documents.length > 0 && (
                  <p className="mt-3 text-sm text-[#475569]">📎 준비물: {guide.documents.join(', ')}</p>
                )}
                {guide.where && <p className="mt-1 text-sm text-[#475569]">📍 {guide.where}</p>}
                {guide.contextMeta && <p className="mt-2 text-sm text-[#64748B]">{fmtProvenance(guide.contextMeta)}</p>}
                <p className="mt-2 text-sm font-semibold text-[#8A3F04]">{guide.disclaimer}</p>
                <FriendlyErrors errors={guide.errors} />
              </div>
            )}
            {!guideLoading && guide && !guide.ok && (
              <p className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 text-red-700">안내를 만들지 못했어요. 다시 시도해 주세요.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
