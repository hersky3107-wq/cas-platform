'use client'

import { useState, useCallback, useRef, useEffect, FormEvent } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  PlayCircle,
  Paperclip,
  X,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
} from 'lucide-react'
import {
  buildExampleFestivalPlan,
  buildExampleFestivalPlan2,
  validateFestivalPlan,
  FESTIVAL_VENUE_TYPE_LABELS,
  FESTIVAL_HEADLINER_LABELS,
  FESTIVAL_RAIN_BACKUP_LABELS,
  FESTIVAL_SAFETY_PLAN_LABELS,
  FESTIVAL_ENTRY_MODE_LABELS,
  FESTIVAL_INVESTIGATOR_BLURBS,
  FESTIVAL_INVESTIGATOR_MODEL_LABEL,
  type FestivalPlan,
  type FestivalPlanBlock1,
  type FestivalPlanBlock2,
  type FestivalPlanBlock3,
  type FestivalPlanBlock4,
  type FestivalPlanBlock5,
  type FestivalPlanBlock6,
  type FestivalSupplement,
  type FestivalVenueType,
} from '@/lib/festival/plan-schema'

// ─────────────────────────────────────────────────────────────────────────────
// FESTIVAL success-forecast — input form (festival-only, no MOTIE/Jeju import).
//
// PUBLIC STANDALONE DEMO (competition): no login, no credits, no lobby/back nav.
// Accessible only by direct URL (www.aimani.ai/festival) — not linked from lobby.
//
// Audience: BOTH local-government planners AND private festival operators /
// agencies (B2G + B2B). Copy stays role-neutral ("주최측", "기획 담당자") — never
// assumes a public official. Because operators have an incentive to oversell,
// the supplement area carries a provenance warning (organizer-provided,
// unverified) and the supplements are framed as such downstream.
//
// Submit → POST /api/festival/deliberate { action:'start', plan, supplements }.
// The deliberate route then drives the chunked stages (scoring → benchmark →
// open → turn ↔ facilitate → rescoring → converge → verdict). This page only handles the
// start + a live progress strip; a follow-up page can render the per-stage
// results. "예시 1/2" fill buildExampleFestivalPlan()/buildExampleFestivalPlan2()
// for testing — two DIFFERENT regions (제주 / 경주) to make clear this is a
// nationwide tool, not Jeju-only.
// ─────────────────────────────────────────────────────────────────────────────

const EMPTY_PLAN: FestivalPlan = {
  block1: {
    name: '',
    region: '',
    dateStart: '',
    dateEnd: '',
    venueType: 'outdoor',
    festivalType: '',
    edition: 'new',
  },
  block2: {
    totalBudget: '',
    visitorTarget: '',
    budgetSplit: { program: '', safety: '', promo: '', operation: '' },
  },
  block3: {
    corePrograms: ['', '', ''],
    hasHeadliner: 'unknown',
    hasRainBackup: 'unknown',
  },
  // blocks 4–6 omitted → rendered as [확인 필요 — 미입력] downstream, which
  // WIDENS uncertainty rather than defaulting to a good score.
}

type StartResponse = {
  ok: boolean
  stage?: string
  sessionId?: string
  nextAction?: string
  error?: string
  question?: string
  plan?: FestivalPlan
  investigators?: { id: string; roleLabelKo: string; kind: 'score' | 'search'; provider: string }[]
  debateSeats?: { id: string; labelKo: string; investigatorIds: string[] }[]
  supplements?: FestivalSupplement[]
}

// ── Stage result shapes (mirror app/api/festival/deliberate/route.ts) ─────────

type InvestigatorScore = {
  id: string
  roleLabelKo: string
  provider: string
  score: number
  reasoning: string
  ok: boolean
  error?: string
}

type Benchmark = { ok: boolean; facts: string | null; error?: string }

type DebateTurn = {
  roundNumber: number
  seatLabel: string
  seatId: string
  actionTag?: string
  claim?: string
  content: string
  isRedTeam?: boolean
}

type FacilitatorSummary = {
  roundNumber: number
  consensusPoints: { point: string; agreedBy: string[] }[]
  openIssues: { issue: string; positions: { ai: string; stance: string }[] }[]
  roundConsensusScore: number
  nextDirective: string
}

type Converge = {
  ok: boolean
  overallScore: number
  method?: 'trimmed_mean'
  dispersion: number
  confidence: 'high' | 'medium' | 'low'
  intervalLow: number
  intervalHigh: number
  measuredCount: number
  contributions: { id: string; roleLabelKo: string; weight: number; score: number }[]
}

type RecommendationGrade = '추진 권장' | '조건부 추진' | '재검토 필요' | '보류 권고'

type Verdict = {
  ok: boolean
  recommendationGrade?: RecommendationGrade | null
  recommendationRationale?: string | null
  successProbability: string | null
  topRisks: string | null
  prescriptions: string | null
  minorityReport: string | null
  disclaimer: string
  provider: string
  overallScore: number
  error?: string
}

type Rescore = {
  id: string
  roleLabelKo?: string
  roleName?: string
  provider?: string
  model?: string
  /** STAGE-1 — rescoring-stage field name */
  stage1Score?: number
  /** STAGE-2 — rescoring-stage field name */
  stage2Score?: number
  /** STAGE-1 — done-payload field name (mapRescoresForClient) */
  score1?: number
  /** STAGE-2 — done-payload field name */
  score2?: number
  delta: number
  changeReason: string
  reasoning?: string
  ok: boolean
  error?: string
}

type StageResult = {
  action: string
  ok: boolean
  error?: string
  // scoring
  scores?: InvestigatorScore[]
  // benchmark
  benchmark?: Benchmark
  // open / turn
  roundNumber?: number
  turns?: DebateTurn[]
  // facilitate
  consensusScore?: number
  summary?: FacilitatorSummary
  done?: boolean
  stoppedReason?: string
  // rescoring
  rescores?: Rescore[]
  // converge
  converge?: Converge
  // verdict
  verdict?: Verdict
}

const VENUE_OPTIONS: FestivalVenueType[] = ['indoor', 'outdoor', 'mixed']
const YN_OPTIONS = ['yes', 'no', 'unknown'] as const
const ENTRY_OPTIONS = ['free', 'paid', 'reservation'] as const

// ── Small UI atoms (festival-local; no shared theme import) ──────────────────

function SectionCard({
  title,
  required,
  optional,
  defaultOpen,
  children,
}: {
  title: string
  required?: boolean
  optional?: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen ?? true)
  return (
    <section className="rounded-2xl border border-stone-200 bg-white/80 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-stone-800">{title}</span>
          {required && (
            <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700">
              필수
            </span>
          )}
          {optional && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              선택
            </span>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-stone-500" /> : <ChevronDown className="h-4 w-4 text-stone-500" />}
      </button>
      {open && <div className="space-y-4 px-5 pb-5 pt-1">{children}</div>}
    </section>
  )
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <label className="text-sm font-medium text-stone-700">{children}</label>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'

function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} min-h-[72px] ${props.className ?? ''}`} />
}

function PillGroup<T extends string>({
  value,
  options,
  labels,
  onChange,
}: {
  value: T | undefined
  options: readonly T[]
  labels: Record<T, string>
  onChange: (v: T) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              active
                ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                : 'border-stone-300 bg-white text-stone-600 hover:border-stone-400'
            }`}
          >
            {labels[opt]}
          </button>
        )
      })}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function FestivalPage() {
  const [plan, setPlan] = useState<FestivalPlan>(EMPTY_PLAN)
  const [supplements, setSupplements] = useState<FestivalSupplement[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [started, setStarted] = useState<StartResponse | null>(null)
  const [extractBusy, setExtractBusy] = useState(false)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [pasteUrl, setPasteUrl] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Plan field updaters (per-block) ─────────────────────────────────────────
  const setB1 = (patch: Partial<FestivalPlanBlock1>) =>
    setPlan((p) => ({ ...p, block1: { ...p.block1, ...patch } }))
  const setB2 = (patch: Partial<FestivalPlanBlock2>) =>
    setPlan((p) => ({ ...p, block2: { ...p.block2, ...patch } }))
  const setB3 = (patch: Partial<FestivalPlanBlock3>) =>
    setPlan((p) => ({ ...p, block3: { ...p.block3, ...patch } }))
  const setB4 = (patch: Partial<FestivalPlanBlock4>) =>
    setPlan((p) => ({ ...p, block4: { ...(p.block4 ?? {}), ...patch } }))
  const setB5 = (patch: Partial<FestivalPlanBlock5>) =>
    setPlan((p) => ({ ...p, block5: { ...(p.block5 ?? {}), ...patch } }))
  const setB6 = (patch: Partial<FestivalPlanBlock6>) =>
    setPlan((p) => ({ ...p, block6: { ...(p.block6 ?? {}), ...patch } }))

  const setProgram = (i: number, v: string) =>
    setB3({
      corePrograms: plan.block3.corePrograms.map((p, idx) => (idx === i ? v : p)),
    })
  const addProgram = () =>
    setB3({ corePrograms: [...plan.block3.corePrograms, ''] })
  const removeProgram = (i: number) =>
    setB3({ corePrograms: plan.block3.corePrograms.filter((_, idx) => idx !== i) })

  const setSplit = (k: keyof FestivalPlanBlock2['budgetSplit'], v: string) =>
    setB2({
      budgetSplit: {
        ...plan.block2.budgetSplit,
        [k]: v === '' ? '' : Math.max(0, Math.min(100, Number(v))),
      },
    })

  // ── "예시로 채우기" ─────────────────────────────────────────────────────────
  const fillExample = (variant: 1 | 2) => {
    setPlan(variant === 1 ? buildExampleFestivalPlan() : buildExampleFestivalPlan2())
    setErrors([])
  }

  // ── Supplement handlers (paste / URL / file → /api/festival/extract) ─────────
  const addPasteSupplement = () => {
    if (!pasteText.trim()) return
    setSupplements((s) => [
      ...s,
      { label: '붙여넣기', text: pasteText.trim(), source: 'paste', truncated: false, ok: true },
    ])
    setPasteText('')
  }

  const addUrlSupplement = useCallback(async () => {
    if (!pasteUrl.trim()) return
    setExtractBusy(true)
    setExtractError(null)
    try {
      const res = await fetch('/api/festival/extract', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'url', url: pasteUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.supplement) {
        setExtractError(data.error ?? 'URL 추출에 실패했습니다.')
        return
      }
      setSupplements((s) => [...s, data.supplement as FestivalSupplement])
      setPasteUrl('')
    } catch {
      setExtractError('URL 추출 중 오류가 발생했습니다.')
    } finally {
      setExtractBusy(false)
    }
  }, [pasteUrl])

  const onFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setExtractBusy(true)
    setExtractError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/festival/extract', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok || !data.supplement) {
        setExtractError(data.error ?? '파일 추출에 실패했습니다.')
        return
      }
      setSupplements((s) => [...s, data.supplement as FestivalSupplement])
    } catch {
      setExtractError('파일 추출 중 오류가 발생했습니다.')
    } finally {
      setExtractBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }, [])

  const removeSupplement = (i: number) =>
    setSupplements((s) => s.filter((_, idx) => idx !== i))

  // ── Submit → start the deliberation session ─────────────────────────────────
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateFestivalPlan(plan)
    if (errs.length > 0) {
      setErrors(errs)
      return
    }
    setErrors([])
    setSubmitting(true)
    setStarted(null)
    try {
      const res = await fetch('/api/festival/deliberate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          plan,
          ...(supplements.length > 0 ? { supplements } : {}),
        }),
      })
      const data = (await res.json()) as StartResponse
      setStarted(data)
      if (!res.ok || !data.ok) {
        setErrors([data.error ?? '심의 시작에 실패했습니다.'])
      }
    } catch {
      setErrors(['네트워크 오류로 심의를 시작하지 못했습니다.'])
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-stone-50 to-stone-100 px-4 py-8 text-stone-800">
      <div className={`mx-auto ${started?.ok && started.sessionId ? 'max-w-4xl' : 'max-w-3xl'}`}>
        {/* Header */}
        <header className="mb-6">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
            <Sparkles className="h-3.5 w-3.5" /> 축제 흥행 예측 · 다중 AI 심의
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            축제 흥행 예측 · 성공을 위한 기획 보완 진단
          </h1>
          <p className="mt-1.5 text-sm leading-relaxed text-stone-600">
            기획 담당자(주최측)를 위한 축제 성공 가능성 분석입니다. 8명의 AI 조사관이 흥행 가능성을
            조사·토론하여 흥행 점수·확률을 제시하는 데서 멈추지 않고, 무엇을 더하고·고치고·빼야
            성공 확률이 올라가는지 구체적인 보완 처방(A/B/C)까지 제시합니다. &ldquo;조건부
            추진&rdquo; 판정이 나온 경우에도 어떤 조건을 채우면 되는지 알 수 있도록 설계되었습니다.
            선택 항목을 비우면 예측의 불확실성이 커집니다 — 비워둔 항목은 &ldquo;미입력&rdquo;으로
            표시되어 점수에 반영됩니다.
          </p>
        </header>

        {/* Example + reset toolbar */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fillExample(1)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-emerald-400 hover:bg-emerald-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> 예시 1 (제주)
          </button>
          <button
            type="button"
            onClick={() => fillExample(2)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-emerald-400 hover:bg-emerald-50"
          >
            <Sparkles className="h-3.5 w-3.5" /> 예시 2 (경주)
          </button>
          <button
            type="button"
            onClick={() => {
              setPlan(EMPTY_PLAN)
              setSupplements([])
              setErrors([])
              setStarted(null)
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:border-stone-400"
          >
            <X className="h-3.5 w-3.5" /> 전체 초기화
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Block 1 — 기본정보 (required) */}
          <SectionCard title="1. 기본정보" required>
            <div>
              <FieldLabel>축제명</FieldLabel>
              <TextInput value={plan.block1.name} onChange={(e) => setB1({ name: e.target.value })} placeholder="예: 제주 감귤 빛 축제" />
            </div>
            <div>
              <FieldLabel>지역(시/군/구)</FieldLabel>
              <TextInput value={plan.block1.region} onChange={(e) => setB1({ region: e.target.value })} placeholder="예: 제주특별자치도 서귀포시" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FieldLabel>개최 시작일</FieldLabel>
                <TextInput type="date" value={plan.block1.dateStart} onChange={(e) => setB1({ dateStart: e.target.value })} />
              </div>
              <div>
                <FieldLabel>개최 종료일</FieldLabel>
                <TextInput type="date" value={plan.block1.dateEnd} onChange={(e) => setB1({ dateEnd: e.target.value })} />
              </div>
            </div>
            <div>
              <FieldLabel hint="실내/실외/혼합 여부가 안전·가동률 예측에 반영됩니다.">장소유형</FieldLabel>
              <PillGroup<FestivalVenueType>
                value={plan.block1.venueType}
                options={VENUE_OPTIONS}
                labels={FESTIVAL_VENUE_TYPE_LABELS}
                onChange={(v) => setB1({ venueType: v })}
              />
            </div>
            <div>
              <FieldLabel hint="음악·먹거리·전통·불꽃·체험 등">축제유형</FieldLabel>
              <TextInput value={plan.block1.festivalType} onChange={(e) => setB1({ festivalType: e.target.value })} placeholder="예: 체험·미디어아트·먹거리" />
            </div>
            <div>
              <FieldLabel hint="신규 축제면 '신규', 기존 축제면 회차 숫자">회차</FieldLabel>
              <div className="flex items-center gap-3">
                <PillGroup<'new'>
                  value={plan.block1.edition === 'new' ? 'new' : undefined}
                  options={['new'] as const}
                  labels={{ new: '신규' }}
                  onChange={() => setB1({ edition: 'new' })}
                />
                <span className="text-xs text-stone-400">또는</span>
                <TextInput
                  type="number"
                  min={1}
                  value={plan.block1.edition === 'new' ? '' : plan.block1.edition}
                  onChange={(e) => setB1({ edition: e.target.value === '' ? 'new' : Math.max(1, Number(e.target.value)) })}
                  placeholder="N회차"
                  className="w-28"
                />
              </div>
            </div>
          </SectionCard>

          {/* Block 2 — 규모·예산 (required) */}
          <SectionCard title="2. 규모·예산" required>
            <div>
              <FieldLabel>총예산</FieldLabel>
              <TextInput value={plan.block2.totalBudget} onChange={(e) => setB2({ totalBudget: e.target.value })} placeholder="예: 총 42억 원 (도비 20억, 시비 12억, 협찬 10억)" />
            </div>
            <div>
              <FieldLabel>예상 방문객 목표</FieldLabel>
              <TextInput value={plan.block2.visitorTarget} onChange={(e) => setB2({ visitorTarget: e.target.value })} placeholder="예: 연 목표 25만 명" />
            </div>
            <div>
              <FieldLabel hint="대략 비율(0~100). 합이 100이 아니어도 됩니다 — 계획 단계의 근사치면 충분합니다.">예산배분</FieldLabel>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(['program', 'safety', 'promo', 'operation'] as const).map((k) => (
                  <div key={k}>
                    <label className="mb-1 block text-xs text-stone-500">
                      {k === 'program' ? '프로그램' : k === 'safety' ? '안전' : k === 'promo' ? '홍보' : '운영'}
                    </label>
                    <TextInput
                      type="number"
                      min={0}
                      max={100}
                      value={plan.block2.budgetSplit[k] === '' ? '' : String(plan.block2.budgetSplit[k])}
                      onChange={(e) => setSplit(k, e.target.value)}
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>

          {/* Block 3 — 프로그램 (required) */}
          <SectionCard title="3. 프로그램" required>
            <div>
              <FieldLabel hint="3~5개. 한 줄에 하나씩.">핵심 프로그램</FieldLabel>
              <div className="space-y-2">
                {plan.block3.corePrograms.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <TextInput value={p} onChange={(e) => setProgram(i, e.target.value)} placeholder={`핵심 프로그램 ${i + 1}`} />
                    {plan.block3.corePrograms.length > 3 && (
                      <button type="button" onClick={() => removeProgram(i)} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {plan.block3.corePrograms.length < 5 && (
                <button type="button" onClick={addProgram} className="mt-2 text-xs font-medium text-emerald-700 hover:text-emerald-800">
                  + 프로그램 추가
                </button>
              )}
            </div>
            <div>
              <FieldLabel>대표콘텐츠/헤드라이너 유무</FieldLabel>
              <PillGroup value={plan.block3.hasHeadliner} options={YN_OPTIONS} labels={FESTIVAL_HEADLINER_LABELS} onChange={(v) => setB3({ hasHeadliner: v })} />
            </div>
            <div>
              <FieldLabel hint="야외 축제의 가동률·안정성에 직접 영향.">우천 대체프로그램 유무</FieldLabel>
              <PillGroup value={plan.block3.hasRainBackup} options={YN_OPTIONS} labels={FESTIVAL_RAIN_BACKUP_LABELS} onChange={(v) => setB3({ hasRainBackup: v })} />
            </div>
          </SectionCard>

          {/* Block 4 — 타깃·접근성 (optional) */}
          <SectionCard title="4. 타깃·접근성" optional defaultOpen={false}>
            <div>
              <FieldLabel hint="비우면 '미입력'으로 표시되어 수요 예측의 불확실성이 커집니다.">주 타깃층</FieldLabel>
              <TextInput value={plan.block4?.primaryAudience ?? ''} onChange={(e) => setB4({ primaryAudience: e.target.value })} placeholder="예: 가족 단위 관광객 + 20~30대 야간 나들이" />
            </div>
            <div>
              <FieldLabel>대중교통 접근성</FieldLabel>
              <TextArea value={plan.block4?.transitAccess ?? ''} onChange={(e) => setB4({ transitAccess: e.target.value })} placeholder="예: 서귀포 시내에서 차량 20분, 전용 주차 800면, 셔틀 3개 노선" />
            </div>
            <div>
              <FieldLabel>주변 숙박·관광 인프라</FieldLabel>
              <TextArea value={plan.block4?.lodgingTourism ?? ''} onChange={(e) => setB4({ lodgingTourism: e.target.value })} placeholder="예: 중문 관광단지 숙박단지 인근, 감귤체험 농장 5곳과 연계" />
            </div>
          </SectionCard>

          {/* Block 5 — 안전·운영 (optional) */}
          <SectionCard title="5. 안전·운영" optional defaultOpen={false}>
            <div>
              <FieldLabel>예상 동시 최대인파</FieldLabel>
              <TextInput value={plan.block5?.peakCrowd ?? ''} onChange={(e) => setB5({ peakCrowd: e.target.value })} placeholder="예: 야간 피크 1.2만 명" />
            </div>
            <div>
              <FieldLabel>안전인력·의료계획 유무</FieldLabel>
              <PillGroup value={plan.block5?.hasSafetyPlan} options={YN_OPTIONS} labels={FESTIVAL_SAFETY_PLAN_LABELS} onChange={(v) => setB5({ hasSafetyPlan: v })} />
            </div>
            <div>
              <FieldLabel>입장방식</FieldLabel>
              <PillGroup value={plan.block5?.entryMode} options={ENTRY_OPTIONS} labels={FESTIVAL_ENTRY_MODE_LABELS} onChange={(v) => setB5({ entryMode: v })} />
            </div>
          </SectionCard>

          {/* Block 6 — 홍보·차별성 (optional) — foreignVisitorPlan is the key axis */}
          <SectionCard title="6. 홍보·차별성" optional defaultOpen={false}>
            <div>
              <FieldLabel>홍보채널</FieldLabel>
              <TextInput value={plan.block6?.promoChannels ?? ''} onChange={(e) => setB6({ promoChannels: e.target.value })} placeholder="예: SNS 인플루언서 20팀, 지역 방송 협찬" />
            </div>
            <div>
              <FieldLabel>홍보시작시점</FieldLabel>
              <TextInput value={plan.block6?.promoStart ?? ''} onChange={(e) => setB6({ promoStart: e.target.value })} placeholder="예: 행사 90일 전" />
            </div>
            <div>
              <FieldLabel>작년대비 새로운 것 / 재방문 유도요소</FieldLabel>
              <TextArea value={plan.block6?.novelty ?? ''} onChange={(e) => setB6({ novelty: e.target.value })} placeholder="예: 미디어아트 루트 2개 신규, 재방문 시 감귤 디저트 쿠폰" />
            </div>
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
              <FieldLabel hint="★ 핵심 차별 축: 이 항목은 글로벌관광관 조사관의 평가에 직접 반영됩니다. 비우면 '외국인 대응 계획 미입력'으로 표시되어 해당 점수가 제한됩니다.">
                외국인 대상여부 + 다국어/결제/동선 계획
              </FieldLabel>
              <TextArea
                value={plan.block6?.foreignVisitorPlan ?? ''}
                onChange={(e) => setB6({ foreignVisitorPlan: e.target.value })}
                placeholder="예: 영어·중국어 안내판, 다언어 결제 키오스크 3대, 동선 다언어 표지"
              />
            </div>
          </SectionCard>

          {/* Manual supplement area */}
          <SectionCard title="첨부·추가 자료 (선택)" optional defaultOpen={false}>
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                <div className="text-xs leading-relaxed text-amber-800">
                  <p className="font-medium">주최측 제공 자료임을 안내합니다.</p>
                  <p className="mt-1">
                    첨부한 자료는 공식 검증된 정보가 아니며, AI 조사관들은 &ldquo;주장과 사실을 구분&rdquo;해
                    참고합니다. 자기홍보성 표현이나 근거 없는 호전적 수치가 점수를 부풀리지 않도록 설계되어
                    있습니다. 개인정보(주민번호·연락처 등)는 입력하지 마세요 — 파일은 추출 후 즉시 삭제됩니다.
                  </p>
                </div>
              </div>
            </div>

            {/* Paste */}
            <div>
              <FieldLabel>텍스트 붙여넣기</FieldLabel>
              <TextArea value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="보도자료, 기획서 일부, 메모 등을 붙여넣으세요" />
              <button type="button" onClick={addPasteSupplement} disabled={!pasteText.trim()} className="mt-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition enabled:hover:border-emerald-400 disabled:opacity-40">
                + 붙여넣기 추가
              </button>
            </div>

            {/* URL */}
            <div>
              <FieldLabel>URL (웹페이지 본문 추출)</FieldLabel>
              <div className="flex gap-2">
                <TextInput value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder="https://..." />
                <button type="button" onClick={addUrlSupplement} disabled={!pasteUrl.trim() || extractBusy} className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition enabled:hover:border-emerald-400 disabled:opacity-40">
                  {extractBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : '추출'}
                </button>
              </div>
            </div>

            {/* File */}
            <div>
              <FieldLabel hint="pdf, docx, xlsx, hwpx (구 hwp 제외). 최대 10MB.">파일 업로드</FieldLabel>
              <input ref={fileRef} type="file" accept=".pdf,.docx,.xlsx,.hwpx" onChange={onFileChange} disabled={extractBusy} className="block w-full text-xs text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-emerald-700 hover:file:bg-emerald-100" />
            </div>

            {extractError && <p className="text-xs text-rose-600">{extractError}</p>}

            {/* List */}
            {supplements.length > 0 && (
              <div className="space-y-2">
                {supplements.map((s, i) => (
                  <div key={i} className="flex items-start justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-xs">
                        <Paperclip className="h-3.5 w-3.5 text-stone-400" />
                        <span className="font-medium text-stone-700">{s.label}</span>
                        {s.truncated && <span className="text-amber-600">(일부 잘림)</span>}
                        {!s.ok && <span className="text-rose-600">(추출 실패)</span>}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-stone-500">{s.text.slice(0, 160)}</p>
                    </div>
                    <button type="button" onClick={() => removeSupplement(i)} className="rounded-md p-1 text-stone-400 hover:bg-stone-200 hover:text-stone-600">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              <ul className="list-inside list-disc space-y-0.5">
                {errors.map((er, i) => (
                  <li key={i}>{er}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Submit */}
          <div className="sticky bottom-3 z-10 rounded-2xl border border-stone-200 bg-white/90 p-3 shadow-lg backdrop-blur">
            <button
              type="submit"
              disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
              {submitting ? '심의 시작 중…' : '8명 AI 조사관 심의 시작'}
            </button>
            <p className="mt-1.5 text-center text-[11px] text-stone-500">
              제출 시 8명 AI 조사관이 기획안을 검토하고 토론·종합하여 흥행 전망을 제시합니다.
            </p>
          </div>
        </form>

        {/* Started → progress + result view (replaces the started block) */}
        {started && started.ok && started.sessionId ? (
          <FestivalProgressView
            sessionId={started.sessionId}
            question={started.question ?? ''}
            investigators={started.investigators ?? []}
            debateSeats={started.debateSeats ?? []}
            initialNextAction={started.nextAction ?? 'scoring'}
            onReset={() => {
              setStarted(null)
              setErrors([])
            }}
          />
        ) : (
          started && (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
              심의 시작에 실패했습니다: {started.error ?? '알 수 없는 오류'}
            </div>
          )
        )}
      </div>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FestivalProgressView — client-driven polling loop + append-only live log.
//
// Drives the chunked stage sequence from the browser:
//   start(already done) → scoring → benchmark → open → turn↔facilitate →
//   rescoring → converge → verdict → done
// One POST per stage, following nextAction. Append-only: completed stages
// never leave the screen. A sticky live bar shows the running stage + elapsed
// mm:ss + an animated pulse, so a several-minute wait never looks hung.
//
// Honesty rule: no fake staggered per-investigator reveal. The scoring POST
// returns all 7 scores together; while it is in flight each investigator card
// shows WHAT that lens examines (real reading content), and an honest note that
// all 8 deliberate simultaneously and results appear together.
//
// Transient resilience: each stage is retried up to MAX_RETRIES times on network
// error. The sessionId persists in festival_sessions, so a transient error never
// loses the run — the user can also manually retry a failed stage.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1500

const STAGE_LABEL_KO: Record<string, string> = {
  scoring: '조사 단계 — 1차 점수 (전문분야 진단)',
  benchmark: '조사 단계 — 벤치마크·경쟁환경 조사 (Perplexity)',
  open: '토론 단계 — 1라운드 개회 발언',
  turn: '토론 단계 — 라운드별 심화 발언',
  facilitate: '토론 단계 — 라운드 정리·합의 진행도',
  rescoring: '2차 재채점 — 토론 반영 (전문 렌즈 + 전체 그림)',
  converge: '종합 — 2차 점수 trimmed mean',
  verdict: '판정 단계 — 의장(Claude Opus) 권고 등급·최종 전망',
  done: '완료',
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function useElapsed(running: boolean): string {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    if (!running) {
      startRef.current = null
      return
    }
    if (startRef.current === null) startRef.current = Date.now()
    const t = setInterval(() => {
      if (startRef.current !== null) setElapsed(Date.now() - startRef.current)
    }, 1000)
    return () => clearInterval(t)
  }, [running])
  return formatElapsed(elapsed)
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

type InvestigatorInfo = { id: string; roleLabelKo: string; kind: 'score' | 'search'; provider: string }

/** Seat label → highlight chip classes (distinct per debate seat). */
const SEAT_CHIP_CLASS: Record<string, string> = {
  '수요예측 대표': 'bg-sky-100 text-sky-900 ring-1 ring-sky-200',
  '예산타당성 대표': 'bg-amber-100 text-amber-950 ring-1 ring-amber-200',
  '안전·평판 대표': 'bg-rose-100 text-rose-900 ring-1 ring-rose-200',
  '프로그램·차별성 대표': 'bg-violet-100 text-violet-900 ring-1 ring-violet-200',
  '마케팅·홍보 대표': 'bg-teal-100 text-teal-900 ring-1 ring-teal-200',
  '외부 유입·연계관광 대표': 'bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200',
  수요예측관: 'bg-sky-100 text-sky-900 ring-1 ring-sky-200',
  예산타당성관: 'bg-amber-100 text-amber-950 ring-1 ring-amber-200',
  '안전·평판관': 'bg-rose-100 text-rose-900 ring-1 ring-rose-200',
  '프로그램·차별성관': 'bg-violet-100 text-violet-900 ring-1 ring-violet-200',
  '마케팅·홍보관': 'bg-teal-100 text-teal-900 ring-1 ring-teal-200',
  '접근성·연계관광관': 'bg-indigo-100 text-indigo-900 ring-1 ring-indigo-200',
  글로벌관광관: 'bg-cyan-100 text-cyan-900 ring-1 ring-cyan-200',
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Color-highlight named debate seats / investigator roles inside free text. */
function highlightNamedSeats(text: string): React.ReactNode {
  const names = Object.keys(SEAT_CHIP_CLASS).sort((a, b) => b.length - a.length)
  if (names.length === 0 || !text) return text
  const re = new RegExp(`(${names.map(escapeRegExp).join('|')})`, 'g')
  const parts = text.split(re)
  return parts.map((part, i) => {
    const cls = SEAT_CHIP_CLASS[part]
    if (cls) {
      return (
        <span key={i} className={`mx-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>
          {part}
        </span>
      )
    }
    return <span key={i}>{part}</span>
  })
}

/**
 * Expandable body text — CRITICAL: when open, NEVER apply line-clamp /
 * max-height / text-overflow. Collapsed preview may use line-clamp only.
 * Optional `highlightSeats` colors named debate seats inside the body.
 */
function ExpandableText({
  text,
  collapsedLines = 4,
  emptyLabel,
  highlightSeats: doHighlight = false,
}: {
  text: string
  collapsedLines?: 3 | 4 | 5 | 6
  emptyLabel?: string
  highlightSeats?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!text || !text.trim()) {
    return emptyLabel ? <p className="text-xs text-stone-400">{emptyLabel}</p> : null
  }
  const clampCls =
    collapsedLines === 3
      ? 'line-clamp-3'
      : collapsedLines === 5
        ? 'line-clamp-5'
        : collapsedLines === 6
          ? 'line-clamp-6'
          : 'line-clamp-4'
  return (
    <div className="mt-2">
      <div
        className={`whitespace-pre-wrap text-sm leading-relaxed text-stone-700 ${
          open ? '' : clampCls
        }`}
      >
        {doHighlight ? highlightNamedSeats(text) : text}
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900"
      >
        {open ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" /> 접기
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" /> 전문 보기
          </>
        )}
      </button>
    </div>
  )
}

function DeltaBadge({ delta }: { delta: number }) {
  if (delta > 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
        ↑{delta}
      </span>
    )
  }
  if (delta < 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800">
        ↓{Math.abs(delta)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-md bg-stone-100 px-2 py-0.5 text-xs font-bold text-stone-600">
      =
    </span>
  )
}

function dispersionPlain(dispersion: number, confidence: 'high' | 'medium' | 'low'): string {
  if (confidence === 'high' || dispersion <= 8) return '작음'
  if (confidence === 'medium' || dispersion <= 16) return '보통'
  return '큼'
}

function FestivalProgressView({
  sessionId,
  question,
  investigators,
  debateSeats: _debateSeats,
  initialNextAction,
  onReset,
}: {
  sessionId: string
  question: string
  investigators: InvestigatorInfo[]
  debateSeats: { id: string; labelKo: string; investigatorIds: string[] }[]
  initialNextAction: string
  onReset: () => void
}) {
  void _debateSeats
  const [results, setResults] = useState<StageResult[]>([])
  const [currentAction, setCurrentAction] = useState<string>(initialNextAction)
  const [running, setRunning] = useState(true)
  const [fatalError, setFatalError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [done, setDone] = useState(false)
  const elapsed = useElapsed(running)
  const finishedRef = useRef(false)
  const verdictSectionRef = useRef<HTMLElement | null>(null)

  // Refs to keep the loop reading latest state inside async without re-runs.
  const nextActionRef = useRef(initialNextAction)
  const resultsRef = useRef<StageResult[]>([])
  const appendResult = useCallback((r: StageResult) => {
    resultsRef.current = [...resultsRef.current, r]
    setResults(resultsRef.current)
  }, [])
  const setNext = (a: string) => {
    nextActionRef.current = a
    setCurrentAction(a)
  }

  // ── Per-stage POST with retry ────────────────────────────────────────────────
  const callStage = useCallback(
    async (action: string): Promise<StageResult> => {
      let lastErr = ''
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        setRetrying(attempt > 1)
        try {
          const res = await fetch('/api/festival/deliberate', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, sessionId }),
          })
          const data = (await res.json()) as StageResult & { nextAction?: string; stoppedReason?: string }
          setRetrying(false)
          return {
            ...data,
            action,
            stoppedReason: data.stoppedReason ?? (data as { stoppedReason?: string }).stoppedReason,
          } as StageResult
        } catch (e: unknown) {
          lastErr = e instanceof Error ? e.message : 'network error'
          if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS)
        }
      }
      setRetrying(false)
      return { action, ok: false, error: `네트워크 오류(재시도 ${MAX_RETRIES}회 실패): ${lastErr}` }
    },
    [sessionId]
  )

  const [retryTick, setRetryTick] = useState(0)
  useEffect(() => {
    let cancelled = false

    async function run() {
      while (!cancelled && !finishedRef.current) {
        const action = nextActionRef.current
        if (action === 'done' || action === '') {
          finishedRef.current = true
          setRunning(false)
          setDone(true)
          break
        }
        const r = await callStage(action)
        if (cancelled) return
        appendResult(r)

        const resp = r as StageResult & { nextAction?: string }
        const next = resp.nextAction ?? ''
        if (!r.ok && !next && action !== 'verdict') {
          setFatalError(r.error ?? `${action} 단계 실패`)
          setRunning(false)
          finishedRef.current = true
          break
        }
        setNext(next || 'done')
        if (next === 'done' || next === '') {
          finishedRef.current = true
          setRunning(false)
          setDone(true)
          break
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [retryTick, appendResult, callStage])

  const manualRetry = () => {
    setFatalError(null)
    setRunning(true)
    finishedRef.current = false
    const last = resultsRef.current[resultsRef.current.length - 1]
    if (last && !last.ok) {
      resultsRef.current = resultsRef.current.slice(0, -1)
      setResults(resultsRef.current)
      setNext(last.action)
    }
    setRetryTick((t) => t + 1)
  }

  // ── Derived state ────────────────────────────────────────────────────────────
  const scoringResult = results.find((r) => r.action === 'scoring')
  const benchmarkResult = results.find((r) => r.action === 'benchmark')
  const rescoringResult = results.find((r) => r.action === 'rescoring')
  const convergeResult = results.find((r) => r.action === 'converge')
  const verdictResult = results.find((r) => r.action === 'verdict')
  const debateTurns = results.filter((r) => r.action === 'open' || r.action === 'turn')
  const facilitations = results.filter((r) => r.action === 'facilitate')

  const benchmark = benchmarkResult?.benchmark
  // Normalize rescoring-stage (stage1Score) and done-payload (score1) shapes.
  const rawRescores = rescoringResult?.rescores ?? verdictResult?.rescores ?? []
  const rescores = rawRescores.map((r) => ({
    id: r.id,
    stage1Score: r.stage1Score ?? r.score1 ?? -1,
    stage2Score: r.stage2Score ?? r.score2 ?? -1,
    delta: r.delta,
    changeReason: r.changeReason,
    reasoning: r.reasoning ?? '',
    ok: r.ok,
    error: r.error,
  }))
  const converge = convergeResult?.converge ?? verdictResult?.converge
  const verdict = verdictResult?.verdict

  const inScoring = currentAction === 'scoring'
  const inBenchmark = currentAction === 'benchmark'
  const inDebate = ['open', 'turn', 'facilitate'].includes(currentAction)
  const inRescoring = currentAction === 'rescoring'
  const inConverge = currentAction === 'converge'
  const inVerdict = currentAction === 'verdict'

  const scrollToVerdict = () => {
    verdictSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Sticky live bar (+ final summary when done) */}
      <div className="sticky top-3 z-20 space-y-2">
        <div className="rounded-2xl border border-emerald-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {running ? (
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                </span>
              ) : done ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : fatalError ? (
                <XCircle className="h-5 w-5 text-rose-600" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-stone-400" />
              )}
              <div>
                <div className="text-sm font-semibold text-stone-800">
                  {done ? '심의 완료' : fatalError ? '일시 중단됨' : STAGE_LABEL_KO[currentAction] ?? currentAction}
                </div>
                {retrying && <div className="text-[11px] text-amber-600">네트워크 일시 오류 — 재시도 중…</div>}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-stone-500">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" /> 경과 {elapsed}
              </span>
              {done && (
                <button
                  type="button"
                  onClick={onReset}
                  className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1 font-medium text-stone-700 transition hover:border-emerald-400"
                >
                  <RefreshCw className="h-3 w-3" /> 새 심의
                </button>
              )}
            </div>
          </div>
        </div>

        {/* [7] Sticky summary banner — conclusion without scrolling */}
        {done && verdict && (
          <button
            type="button"
            onClick={scrollToVerdict}
            className="flex w-full items-center justify-between gap-3 rounded-2xl border border-emerald-400 bg-emerald-700 px-4 py-3 text-left text-white shadow-lg transition hover:bg-emerald-800"
          >
            <span className="text-sm font-semibold tracking-tight">
              ⚖️ 최종 판정: {verdict.recommendationGrade ?? '—'} · 흥행{' '}
              {verdict.overallScore >= 0 ? verdict.overallScore : '—'}점
            </span>
            <span className="shrink-0 text-xs font-medium text-emerald-100">자세히 보기 ↓</span>
          </button>
        )}
      </div>

      {/* Upfront notice — [8] 8~12분 */}
      <div className="rounded-2xl border border-stone-200 bg-white/80 p-4 text-sm leading-relaxed text-stone-700">
        <p className="font-medium text-stone-800">
          AI 8명이 심의합니다. 수 분(약 8~12분) 소요될 수 있으니 창을 닫지 말고 기다려 주세요.
        </p>
        <p className="mt-1 text-stone-600">
          아래에 진행 상황이 실시간으로 표시됩니다 — ①조사 → ②토론 → ③종합 → ④판정 순서로 누적됩니다.
        </p>
        {question && <p className="mt-2 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">심의 안건: {question}</p>}
      </div>

      {/* ── ① 조사 (weight ~3) — full-width cards, expandable findings ── */}
      <section className="rounded-2xl border border-stone-200 bg-white/90 p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-stone-900">① 조사 — 8명 AI 조사관</h2>
        <p className="mb-4 text-sm text-stone-600">
          1차는 전문분야만, 2차는 토론 전체 그림을 반영합니다. 카드의 「전문 보기」로 전체 근거를 펼칠 수 있습니다.
        </p>
        {inScoring && (
          <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            8명이 동시에 검토 중입니다. 결과는 일괄 반환됩니다 — 그동안 각 조사관이 무엇을 살피는지 읽어보세요.
          </p>
        )}
        {inRescoring && !rescoringResult && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            2차 재채점 중 — 전문 렌즈 + 토론 전체 그림을 함께 반영합니다. 결과는 일괄 반환됩니다.
          </p>
        )}

        <div className="space-y-4">
          {investigators.map((inv) => {
            const score = scoringResult?.scores?.find((s) => s.id === inv.id)
            const rescore = rescores.find((r) => r.id === inv.id)
            const isPerplexity = inv.kind === 'search'
            const inFlight =
              (inScoring && !isPerplexity && !scoringResult) ||
              (inBenchmark && isPerplexity && !benchmarkResult) ||
              (inRescoring && !isPerplexity && !rescoringResult)
            const landed = isPerplexity ? !!benchmarkResult : !!score
            const failed = isPerplexity
              ? benchmarkResult && !benchmarkResult.ok
              : rescore
                ? !rescore.ok
                : score && !score.ok
            const blurb = FESTIVAL_INVESTIGATOR_BLURBS[inv.id] ?? ''
            const model = FESTIVAL_INVESTIGATOR_MODEL_LABEL[inv.id] ?? inv.provider
            return (
              <article
                key={inv.id}
                className={`rounded-xl border p-4 ${
                  failed
                    ? 'border-rose-200 bg-rose-50/40'
                    : landed
                      ? 'border-emerald-200 bg-emerald-50/30'
                      : inFlight
                        ? 'border-amber-200 bg-amber-50/30'
                        : 'border-stone-200 bg-stone-50/50'
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold text-stone-900">{inv.roleLabelKo}</h3>
                    <p className="text-xs text-stone-500">{model}</p>
                  </div>
                  <div className="text-xs font-medium">
                    {failed ? (
                      <span className="inline-flex items-center gap-1 text-rose-700">
                        <XCircle className="h-3.5 w-3.5" /> 실패
                      </span>
                    ) : rescore ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 2차 완료
                      </span>
                    ) : landed ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 1차 완료
                      </span>
                    ) : inFlight ? (
                      <span className="inline-flex items-center gap-1 text-amber-700">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />{' '}
                        {inRescoring ? '재채점중' : '조사중'}
                      </span>
                    ) : (
                      <span className="text-stone-400">대기</span>
                    )}
                  </div>
                </div>

                <p className="mt-2 text-sm leading-relaxed text-stone-600">
                  <span className="font-medium text-stone-700">살펴보는 것: </span>
                  {blurb}
                </p>

                {isPerplexity ? (
                  benchmark?.ok && benchmark.facts ? (
                    <ExpandableText text={benchmark.facts} collapsedLines={5} />
                  ) : failed ? (
                    <p className="mt-2 text-xs text-rose-700">{benchmark?.error ?? '추출 실패'}</p>
                  ) : null
                ) : rescore ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white/80 px-3 py-2">
                      <div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-stone-500">
                          1차 점수 (전문분야 진단)
                        </div>
                        <div className="text-xl font-bold text-stone-800">
                          {rescore.stage1Score >= 0 ? rescore.stage1Score : '—'}
                          <span className="ml-0.5 text-xs font-normal text-stone-500">/100</span>
                        </div>
                      </div>
                      <span className="text-stone-400">→</span>
                      <div>
                        <div className="text-[10px] font-medium uppercase tracking-wide text-stone-500">2차 점수</div>
                        <div className="text-xl font-bold text-emerald-700">
                          {rescore.ok && rescore.stage2Score >= 0 ? rescore.stage2Score : '—'}
                          <span className="ml-0.5 text-xs font-normal text-stone-500">/100</span>
                        </div>
                      </div>
                      <DeltaBadge delta={rescore.delta} />
                    </div>
                    {rescore.changeReason && (
                      <p className="text-sm leading-relaxed text-stone-700">
                        <span className="font-medium text-stone-800">변동 사유: </span>
                        {rescore.changeReason}
                      </p>
                    )}
                    <ExpandableText text={rescore.reasoning} collapsedLines={4} />
                    {!rescore.ok && (
                      <p className="text-xs text-rose-700">{rescore.error ?? '2차 점수 파싱 실패'}</p>
                    )}
                  </div>
                ) : score ? (
                  <div className="mt-3">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-stone-500">
                      1차 점수 (전문분야 진단)
                    </div>
                    {score.ok ? (
                      <div className="text-2xl font-bold text-emerald-700">
                        {score.score}
                        <span className="ml-1 text-sm font-normal text-stone-500">/ 100</span>
                      </div>
                    ) : (
                      <span className="text-xs text-rose-700">{score.error ?? '점수 파싱 실패'}</span>
                    )}
                    <ExpandableText text={score.reasoning} collapsedLines={4} />
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      {/* ── ② 토론 (weight ~4) ── */}
      {(inDebate || debateTurns.length > 0 || facilitations.length > 0) && (
        <section className="rounded-2xl border border-stone-200 bg-white/90 p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-semibold text-stone-900">② 토론 — 6개 좌석 다중 라운드</h2>
          <p className="mb-4 text-sm text-stone-600">
            라운드를 거듭하며 쟁점을 좁힙니다. 다른 좌석을 지목·반박할 때 해당 좌석명이 색으로 강조됩니다.
          </p>

          {inDebate && (
            <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              토론 진행 중 — 발언과 정리가 도착하는 대로 아래에 누적됩니다.
            </p>
          )}

          <div className="space-y-3">
            {debateTurns.flatMap((r) =>
              (r.turns ?? []).map((t, i) => (
                <div key={`${r.action}-${r.roundNumber}-${i}`} className="rounded-lg border border-stone-200 bg-stone-50/70 p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-stone-200 px-1.5 py-0.5 font-medium text-stone-700">R{t.roundNumber}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-semibold ${
                        SEAT_CHIP_CLASS[t.seatLabel] ?? 'bg-stone-200 text-stone-800'
                      }`}
                    >
                      {t.seatLabel}
                    </span>
                    {t.isRedTeam && (
                      <span
                        className="inline-flex cursor-help items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-800"
                        title="이 발언은 성급한 합의를 막기 위해 의도적으로 반대 관점을 제기하는 검증 역할입니다."
                      >
                        검증 반론
                        <span className="text-[10px] font-normal text-rose-600">(의도적 반대)</span>
                      </span>
                    )}
                    {t.actionTag && <span className="text-emerald-700">{t.actionTag}</span>}
                  </div>
                  {t.isRedTeam && (
                    <p className="mt-1.5 text-[11px] leading-relaxed text-rose-700/90">
                      이 발언은 성급한 합의를 막기 위해 의도적으로 반대 관점을 제기하는 검증 역할입니다.
                    </p>
                  )}
                  {t.claim && (
                    <p className="mt-2 text-sm font-medium leading-relaxed text-stone-900">
                      {highlightNamedSeats(t.claim)}
                    </p>
                  )}
                  <ExpandableText text={t.content} collapsedLines={3} highlightSeats />
                </div>
              ))
            )}

            {facilitations.map((f) => (
              <div key={`fac-${f.roundNumber}`} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-stone-200 px-1.5 py-0.5 font-medium text-stone-700">R{f.roundNumber} 정리</span>
                  {/* [6] Demoted — not a headline score */}
                  <span className="inline-flex items-center gap-1 text-stone-600">
                    합의 진행도{' '}
                    <span className="font-medium text-stone-800">{f.consensusScore}</span>
                    <span className="text-emerald-600" aria-hidden>
                      ↗
                    </span>
                  </span>
                  <span className="text-[10px] text-stone-400">최종 점수가 아님 · 토론 진행 지표</span>
                  {f.done && (
                    <span className="text-emerald-700">
                      토론 종료{f.stoppedReason ? ` (${f.stoppedReason})` : ''}
                    </span>
                  )}
                </div>
                {f.summary && f.summary.consensusPoints.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-stone-700">
                    {f.summary.consensusPoints.map((cp, i) => (
                      <li key={i}>{highlightNamedSeats(cp.point)}</li>
                    ))}
                  </ul>
                )}
                {f.summary && f.summary.openIssues.length > 0 && (
                  <div className="mt-2 text-sm text-stone-600">
                    <span className="font-medium">남은 쟁점: </span>
                    {f.summary.openIssues.map((oi, i) => (
                      <span key={i}>
                        {i > 0 ? ' · ' : ''}
                        {highlightNamedSeats(oi.issue)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── ③ 종합 ── */}
      {(inConverge || convergeResult) && (
        <section className="rounded-2xl border border-stone-200 bg-white/90 p-6 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-stone-900">③ 종합 — 흥행 점수</h2>
          {inConverge && !convergeResult && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              2차 점수 중 최고·최저를 제외한 중간값 평균을 계산 중…
            </p>
          )}
          {converge && (
            <div className="space-y-4">
              <div>
                <div className="text-xs text-stone-500">최종 흥행 점수 (2차 점수 중간값 평균)</div>
                <div className="text-4xl font-bold text-emerald-700">
                  {converge.overallScore >= 0 ? converge.overallScore : '—'}
                  <span className="ml-1 text-base font-medium text-stone-500">/ 100</span>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3">
                  <div className="text-xs font-medium text-stone-500">조사관 간 의견 편차</div>
                  <div className="mt-1 text-lg font-semibold text-stone-900">
                    {dispersionPlain(converge.dispersion, converge.confidence)}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-stone-600">
                    7명 2차 점수가 서로 얼마나 갈리는지입니다. 편차가 클수록 전망이 한쪽으로 확정되기 어렵습니다.
                  </p>
                </div>
                <div className="rounded-lg border border-stone-200 bg-stone-50/80 p-3">
                  <div className="text-xs font-medium text-stone-500">이 예측의 불확실성 범위</div>
                  <div className="mt-1 text-lg font-semibold text-stone-900">
                    {converge.intervalLow >= 0 ? `${converge.intervalLow} ~ ${converge.intervalHigh}점` : '—'}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-stone-600">
                    조사관 점수 편차를 반영한 예상 구간입니다. 점수가 이 범위 안에서 움직일 수 있다는 뜻입니다.
                  </p>
                </div>
              </div>
              <p className="text-xs text-stone-500">측정 좌석 {converge.measuredCount} / 7</p>
            </div>
          )}
        </section>
      )}

      {/* ── ④ 판정 (weight ~3) ── */}
      {(inVerdict || verdictResult) && (
        <section
          ref={verdictSectionRef}
          id="festival-verdict"
          className="scroll-mt-28 rounded-2xl border border-emerald-300 bg-emerald-50/50 p-6 shadow-sm"
        >
          <h2 className="mb-3 text-lg font-semibold text-stone-900">④ 판정 — 의장 최종 전망</h2>
          {inVerdict && !verdictResult && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              의장이 전체 심의 자료를 읽고 권고 등급과 최종 전망을 작성 중… (가장 긴 단계)
            </p>
          )}
          {verdict && (
            <div className="space-y-4">
              {verdict.recommendationGrade && (
                <div className="rounded-xl border border-emerald-300 bg-white p-5">
                  <div className="text-xs font-medium text-stone-500">권고 등급</div>
                  <div className="mt-1 text-3xl font-bold tracking-tight text-emerald-800">
                    {verdict.recommendationGrade}
                  </div>
                  {verdict.overallScore >= 0 && (
                    <div className="mt-1 text-sm text-stone-600">흥행 점수 {verdict.overallScore}점</div>
                  )}
                  {verdict.recommendationRationale && (
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
                      {verdict.recommendationRationale.replace(
                        new RegExp(`^\\s*${verdict.recommendationGrade}\\s*\\n?`),
                        ''
                      )}
                    </div>
                  )}
                </div>
              )}
              {verdict.successProbability && (
                <VerdictBlock title="흥행 확률 및 신뢰구간">{verdict.successProbability}</VerdictBlock>
              )}
              {verdict.topRisks && <VerdictBlock title="핵심 리스크 Top 3">{verdict.topRisks}</VerdictBlock>}
              {verdict.prescriptions && <VerdictBlock title="보완 처방 (A/B/C)">{verdict.prescriptions}</VerdictBlock>}
              {verdict.minorityReport && (
                <VerdictBlock title="소수의견 (마이너리티 리포트)">{verdict.minorityReport}</VerdictBlock>
              )}
              {verdict.disclaimer && (
                <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs leading-relaxed text-stone-600">
                  {verdict.disclaimer}
                </p>
              )}
              {verdict.error && <p className="text-xs text-rose-700">{verdict.error}</p>}
            </div>
          )}
        </section>
      )}

      {fatalError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <div className="flex items-start gap-2 text-rose-800">
            <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="text-sm">
              <p className="font-medium">단계 일시 중단: {fatalError}</p>
              <p className="mt-1 text-xs text-rose-700">
                세션은 festival_sessions에 보존되어 있습니다. 재시도하면 중단된 단계부터 이어 진행합니다.
              </p>
              <button
                type="button"
                onClick={manualRetry}
                className="mt-2 inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50"
              >
                <RefreshCw className="h-3.5 w-3.5" /> 이 단계 재시도
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function VerdictBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="mb-2 text-xs font-semibold text-emerald-800">{title}</div>
      <div className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{children}</div>
    </div>
  )
}
