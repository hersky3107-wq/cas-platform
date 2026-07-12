'use client'

import { useState, useCallback, useRef, useEffect, type RefObject } from 'react'
import {
  ChevronDown,
  ChevronUp,
  PlayCircle,
  Search,
  Activity,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'
import { aiProductNameWithGloss } from '@/components/jeju/aiProviderLabel'
import { DIAGNOSTIC_CATEGORIES } from '@/lib/jeju/diagnostic-categories'

// ── Local types (shape-compatible with the brief + diagnostic routes) ─────────

type RoleInfo = {
  roleId: string
  roleLabel: string
  mandate?: string
  provider?: string
  subQuestion?: string
  isDoubledAngle?: boolean
}

type ExecutedSearch = {
  query: string
  ok: boolean
  result: string | null
  error?: string
}

type OpenAnalysis = {
  roleId: string
  roleLabel: string
  provider: string
  subQuestion: string
  isDoubledAngle: boolean
  ok: boolean
  analysis: string | null
  error?: string
}

type BriefApiResult = {
  ok: boolean
  stage?: string
  sessionId?: string
  nextAction?: string
  done?: boolean
  error?: string
  reportError?: string
  synthesisError?: string
  analystCount?: number
  rationale?: string
  primaryAngleId?: string
  roles?: RoleInfo[]
  plan?: { roles?: RoleInfo[]; rationale?: string; primaryAngleId?: string }
  report?: string | null
  leadAnalysis?: string | null
  searches?: ExecutedSearch[]
  droppedSearchCount?: number
  analyses?: OpenAnalysis[]
  synthesis?: string | null
  provider?: string
  completedCount?: number
}

/** One diagnostic part (AI① 현황 / AI② 시급사안). */
type DiagnosticPart = {
  ok: boolean
  text: string | null
  provider: string
  model: string
  error?: string
}

type DiagnosticApiResult = {
  ok: boolean
  stage?: string
  sessionId?: string
  nextAction?: string
  done?: boolean
  error?: string
  question?: string
  categoryId?: string | null
  searches?: ExecutedSearch[]
  status?: DiagnosticPart
  issues?: DiagnosticPart
}

/** Which engine produced the currently-displayed result. */
type ResultMode = 'none' | 'brief' | 'diagnostic'

/**
 * Strip orchestrator machine jargon from the roster rationale so users see plain
 * Korean (e.g. "반도체를 2명이 중점 분석") instead of "primary로 두 좌석에 배치".
 */
function humanizeRosterRationale(raw: string): string {
  return raw
    .replace(/\bprimary\s*angle\b/gi, '중점 분야')
    .replace(/\bas\s+primary\b/gi, '중점으로')
    .replace(/\bprimary(?:로|에|를|을|의|인)?/gi, '중점')
    .replace(/좌석/g, '분석가')
    .replace(/배치하([였었는게])/g, '배정하$1')
    .replace(/배치/g, '배정')
    .replace(/두\s*분석가에\s*배정/g, '2명이 중점 분석')
    .replace(/중점\s*중점/g, '중점')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

type BriefStageKey =
  | 'idle'
  | 'start'
  | 'orchestrate'
  | 'pre-report'
  | 'analyses'
  | 'synthesize'
  | 'done'
  | 'error'

type DiagStageKey = 'idle' | 'start' | 'search' | 'status' | 'issues' | 'done' | 'error'

type Ui = ReturnType<typeof useJejuUi>['t']

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * The lead analyst's first-pass is a JSON object { analysis, searchRequests }.
 * Sometimes the raw JSON (fences/braces/field names) leaks into leadAnalysis
 * (e.g. when the first-pass JSON was truncated and the server fell back to raw
 * text). Show ONLY the human-readable `analysis` content; never the wrapper.
 */
function cleanLeadAnalysis(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null
  let text = raw.trim()

  // 1) Strip a ```json … ``` (or ``` … ```) code fence if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1]) text = fence[1].trim()

  const pickAnalysis = (s: string): string | null => {
    try {
      const o = JSON.parse(s) as Record<string, unknown>
      if (o && typeof o.analysis === 'string' && o.analysis.trim()) return o.analysis.trim()
    } catch {
      /* fall through to regex/strip fallbacks */
    }
    return null
  }

  // 2) Whole-string JSON, then just the {...} block.
  const whole = pickAnalysis(text)
  if (whole) return whole
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    const block = pickAnalysis(text.slice(start, end + 1))
    if (block) return block
  }

  // 3) Pull the analysis value out of (possibly truncated) JSON via regex.
  const m = text.match(/"analysis"\s*:\s*"([\s\S]*?)"\s*(?:,\s*"searchRequests"|}|$)/)
  if (m && m[1]) {
    return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim() || null
  }

  // 4) Last resort: drop braces, the field label, and any searchRequests array.
  let out = text
    .replace(/^\s*\{/, '')
    .replace(/\}\s*$/, '')
    .replace(/"?searchRequests"?\s*:\s*\[[\s\S]*$/i, '')
    .replace(/"?analysis"?\s*:\s*"?/i, '')
    .trim()
  out = out.replace(/^["']|["']$/g, '').trim()
  return out || null
}

/**
 * Strips CJK ideograph characters (Chinese/Japanese kanji; U+4E00–U+9FFF and
 * common extension blocks) that have leaked into Perplexity search results and
 * analyst outputs. Keeps: Hangul (Korean), Latin letters, digits, spaces,
 * standard punctuation, and common technical units (MW, %, kWh, etc.).
 * After stripping, collapses stray whitespace left by the removed chars.
 */
function sanitizeCjk(text: string | null | undefined): string | null {
  if (!text || !text.trim()) return null
  const stripped = text
    // CJK Unified Ideographs + extensions A/B/C/D/E/F + Compatibility Ideographs
    .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u{20000}-\u{2A6DF}\uF900-\uFAFF]/gu, '')
    // CJK Radicals, Kangxi, bopomofo
    .replace(/[\u2E80-\u2FFF\u3100-\u312F]/g, '')
    // Collapse multiple spaces left by removed chars
    .replace(/[ \t]{2,}/g, ' ')
    // Tidy space left before punctuation
    .replace(/ +([,.\])])/g, '$1')
    .trim()
  return stripped || null
}

function Prose({ text }: { text: string | null | undefined }) {
  if (!text || !text.trim())
    return <p className="text-xs italic text-jeju-fg-muted">(내용 없음)</p>
  return <p className="whitespace-pre-wrap text-sm leading-7 text-jeju-fg">{text}</p>
}

function Section({
  title,
  badge,
  defaultOpen = true,
  t,
  children,
}: {
  title: string
  badge?: React.ReactNode
  defaultOpen?: boolean
  t: Ui
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-2xl border border-jeju-border bg-jeju-bg-elevated shadow-[var(--jeju-shadow)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-bold text-jeju-fg">
          {title}
          {badge}
        </span>
        <span className="flex items-center gap-1 text-xs text-jeju-fg-muted">
          {open ? t.deepCollapse : t.deepExpand}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {open && <div className="border-t border-jeju-border px-5 py-4">{children}</div>}
    </section>
  )
}

// ── Brief progress strip ──────────────────────────────────────────────────────

const BRIEF_STAGE_ORDER: BriefStageKey[] = [
  'start',
  'orchestrate',
  'pre-report',
  'analyses',
  'synthesize',
  'done',
]

function BriefProgressStrip({ stage, t }: { stage: BriefStageKey; t: Ui }) {
  const steps: { key: BriefStageKey; label: string }[] = [
    { key: 'start', label: t.briefStageStart },
    { key: 'orchestrate', label: t.briefStageOrchestrate },
    { key: 'pre-report', label: t.briefStagePreReport },
    { key: 'analyses', label: t.briefStageAnalyses },
    { key: 'synthesize', label: t.briefStageSynthesize },
    { key: 'done', label: t.deepStageDone },
  ]
  return <ProgressStripBase steps={steps} activeIdx={BRIEF_STAGE_ORDER.indexOf(stage)} />
}

// ── Diagnostic progress strip ─────────────────────────────────────────────────

const DIAG_STAGE_ORDER: DiagStageKey[] = ['start', 'search', 'status', 'issues', 'done']

function DiagProgressStrip({ stage, t }: { stage: DiagStageKey; t: Ui }) {
  const steps: { key: DiagStageKey; label: string }[] = [
    { key: 'start', label: t.diagnosticStageStart },
    { key: 'search', label: t.diagnosticStageSearch },
    { key: 'status', label: t.diagnosticStageStatus },
    { key: 'issues', label: t.diagnosticStageIssues },
    { key: 'done', label: t.deepStageDone },
  ]
  return <ProgressStripBase steps={steps} activeIdx={DIAG_STAGE_ORDER.indexOf(stage)} />
}

function ProgressStripBase({
  steps,
  activeIdx,
}: {
  steps: { key: string; label: string }[]
  activeIdx: number
}) {
  return (
    <ol className="flex flex-wrap gap-2">
      {steps.map((step, i) => {
        const done = activeIdx > i
        const active = activeIdx === i
        return (
          <li
            key={step.key}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition ${
              done
                ? 'bg-emerald-500/20 text-emerald-300'
                : active
                  ? 'bg-jeju-accent/20 text-jeju-accent ring-1 ring-jeju-accent/50'
                  : 'bg-jeju-tile-bg text-jeju-fg-muted'
            }`}
          >
            {done && <span aria-hidden>✓</span>}
            {active && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-jeju-accent"
                style={{ animation: 'pulse 1s ease-in-out infinite' }}
                aria-hidden
              />
            )}
            {step.label}
          </li>
        )
      })}
    </ol>
  )
}

// ── Elapsed-timer hook + running banner (ported from motie's governance UI) ──

function useElapsedTimer(running: boolean): string {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    if (!running) {
      setElapsed(0)
      return
    }
    startRef.current = Date.now()
    const id = setInterval(() => {
      if (startRef.current !== null) {
        setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [running])
  const m = Math.floor(elapsed / 60)
  const s = elapsed % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * One banner covers BOTH engines (brief + diagnostic). The active engine's
 * stage label is resolved by the caller and passed in, so the banner stays
 * engine-agnostic. `kind` switches the headline + hint between the two flows.
 */
function BriefRunningBanner({
  headline,
  stageLabel,
  hint,
  elapsed,
  bannerRef,
}: {
  headline: string
  stageLabel: string
  hint: string
  elapsed: string
  bannerRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={bannerRef}
      className="sticky top-2 z-10 rounded-xl border-2 border-jeju-accent bg-jeju-accent/15 px-6 py-5 shadow-[0_4px_20px_rgba(0,0,0,0.35)]"
    >
      <div className="flex items-center gap-3">
        <Loader2 className="h-6 w-6 shrink-0 animate-spin text-jeju-accent" aria-hidden />
        <p className="text-base font-bold text-jeju-fg">{headline}</p>
        <span className="ml-auto font-mono text-xl font-extrabold tabular-nums text-jeju-accent">
          {elapsed}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-jeju-accent">{stageLabel}</p>
      <p className="mt-1 text-xs text-jeju-fg-muted">{hint}</p>
    </div>
  )
}

// ── Brief result pieces ───────────────────────────────────────────────────────

function SynthesisBlock({ synthesis, t }: { synthesis: string; t: Ui }) {
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-jeju-accent/40 bg-gradient-to-b from-jeju-bg-elevated to-jeju-bg px-6 py-6 shadow-[var(--jeju-shadow)]">
      <div className="border-b border-jeju-border pb-4">
        <p className="text-sm font-bold uppercase tracking-widest text-jeju-accent">
          {t.briefSynthesisHeading}
        </p>
        <p className="mt-1 text-xs text-jeju-fg-muted">{t.briefRecommendHeading}</p>
      </div>
      <Prose text={synthesis} />
    </div>
  )
}

function AnalysisCard({ analysis, t }: { analysis: OpenAnalysis; t: Ui }) {
  return (
    <div className="rounded-xl bg-jeju-tile-bg px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-jeju-fg">
          {aiProductNameWithGloss(analysis.provider)}
        </span>
        <span className="rounded-md bg-jeju-bg px-1.5 py-0.5 text-[10px] text-jeju-fg-muted">
          {analysis.roleLabel}
        </span>
        {analysis.isDoubledAngle && (
          <span className="rounded-md bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
            {t.briefDoubledBadge}
          </span>
        )}
      </div>
      <p className="mb-2 text-[11px] text-jeju-fg-muted">
        <span className="font-semibold text-jeju-accent">{t.briefSubQuestionLabel}:</span>{' '}
        {analysis.subQuestion}
      </p>
      {analysis.ok ? (
        <Prose text={sanitizeCjk(analysis.analysis)} />
      ) : (
        <p className="text-xs text-rose-300">{analysis.error ?? '분석 실패'}</p>
      )}
    </div>
  )
}

// ── Diagnostic result piece ───────────────────────────────────────────────────

function PartCard({
  heading,
  icon,
  part,
  t,
}: {
  heading: string
  icon: React.ReactNode
  part: DiagnosticPart
  t: Ui
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-jeju-accent/40 bg-gradient-to-b from-jeju-bg-elevated to-jeju-bg px-6 py-5 shadow-[var(--jeju-shadow)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-jeju-border pb-3">
        <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-jeju-accent">
          {icon}
          {heading}
        </span>
        {part.provider && (
          <span className="text-xs text-jeju-fg-muted">
            {aiProductNameWithGloss(part.provider)}
          </span>
        )}
      </div>
      {part.ok ? (
        <Prose text={part.text} />
      ) : (
        <p className="text-xs text-rose-300">{part.error ?? t.diagnosticNoResult}</p>
      )}
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function JejuGovernanceBriefPage() {
  const { t } = useJejuUi()

  const [mode, setMode] = useState<ResultMode>('none')
  const [error, setError] = useState<string | null>(null)
  const [failedStage, setFailedStage] = useState<string | null>(null)
  const runningRef = useRef(false)

  // ── Brief (prompt) state ──
  const [question, setQuestion] = useState('')
  const [briefStage, setBriefStage] = useState<BriefStageKey>('idle')
  const [analystCount, setAnalystCount] = useState(7)
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [rationale, setRationale] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [leadAnalysis, setLeadAnalysis] = useState<string | null>(null)
  const [searches, setSearches] = useState<ExecutedSearch[]>([])
  const [analyses, setAnalyses] = useState<OpenAnalysis[]>([])
  const [synthesis, setSynthesis] = useState<string | null>(null)

  // ── Diagnostic (category) state ──
  const [diagStage, setDiagStage] = useState<DiagStageKey>('idle')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [diagSearches, setDiagSearches] = useState<ExecutedSearch[]>([])
  const [diagStatus, setDiagStatus] = useState<DiagnosticPart | null>(null)
  const [diagIssues, setDiagIssues] = useState<DiagnosticPart | null>(null)

  // ── Shared request helper (per-endpoint) ──
  const requestWithRetry = useCallback(
    async (endpoint: string, reqBody: Record<string, unknown>): Promise<unknown> => {
      const MAX_ATTEMPTS = 4
      let lastErr = ''
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reqBody),
          })
          if (res.status === 402) {
            const j = (await res.json().catch(() => null)) as { error?: string } | null
            setError(j?.error ?? '크레딧이 부족합니다.')
            return null
          }
          if (!res.ok) {
            lastErr = `요청 실패 (HTTP ${res.status})`
            if (attempt < MAX_ATTEMPTS) {
              await delay(attempt * 1000)
              continue
            }
            setError(lastErr)
            return null
          }
          const data = (await res.json().catch(() => null)) as unknown
          if (!data) {
            lastErr = '응답 파싱 실패'
            if (attempt < MAX_ATTEMPTS) {
              await delay(attempt * 1000)
              continue
            }
            setError(lastErr)
            return null
          }
          return data
        } catch (e: unknown) {
          lastErr = e instanceof Error ? e.message : '네트워크 오류'
          if (attempt < MAX_ATTEMPTS) {
            await delay(attempt * 1000)
            continue
          }
          setError(lastErr)
          return null
        }
      }
      setError(lastErr)
      return null
    },
    []
  )

  const resetAll = useCallback(() => {
    setError(null)
    setFailedStage(null)
    setRoles([])
    setRationale(null)
    setReport(null)
    setLeadAnalysis(null)
    setSearches([])
    setAnalyses([])
    setSynthesis(null)
    setDiagSearches([])
    setDiagStatus(null)
    setDiagIssues(null)
  }, [])

  // ── PROMPT mode → 7-AI brief engine ──
  const runBrief = useCallback(
    async (overrideQ?: string) => {
      const q = (overrideQ ?? question).trim()
      if (!q || runningRef.current) return

      runningRef.current = true
      resetAll()
      setMode('brief')
      setActiveCategory(null)
      setDiagStage('idle')
      setBriefStage('start')

      const post = (body: Record<string, unknown>) =>
        requestWithRetry('/api/jeju/brief', body) as Promise<BriefApiResult | null>
      const failBrief = (stageName: string, msg: string) => {
        setError(msg)
        setFailedStage(stageName)
        setBriefStage('error')
        runningRef.current = false
      }

      const startRes = await post({ action: 'start', question: q })
      if (!startRes?.ok || !startRes.sessionId) {
        failBrief('start', startRes?.error ?? '데이터 수집 단계 실패')
        return
      }
      const sessionId = startRes.sessionId
      if (startRes.analystCount) setAnalystCount(startRes.analystCount)
      setBriefStage('orchestrate')

      const orchRes = await post({ action: 'orchestrate', sessionId })
      if (!orchRes?.ok) {
        failBrief('orchestrate', orchRes?.error ?? '분석 배치 단계 실패')
        return
      }
      if (orchRes.roles) setRoles(orchRes.roles)
      if (orchRes.rationale) setRationale(orchRes.rationale)
      if (orchRes.analystCount) setAnalystCount(orchRes.analystCount)
      setBriefStage('pre-report')

      const reportRes = await post({ action: 'pre-report', sessionId })
      if (reportRes?.report) setReport(reportRes.report)
      if (reportRes?.leadAnalysis) setLeadAnalysis(reportRes.leadAnalysis)
      if (reportRes?.searches) setSearches(reportRes.searches)
      if (!reportRes?.ok) {
        failBrief('pre-report', reportRes?.reportError ?? reportRes?.error ?? '상황 브리핑 실패')
        return
      }
      setBriefStage('analyses')

      const analRes = await post({ action: 'analyses', sessionId })
      if (analRes?.analyses) setAnalyses(analRes.analyses)
      if (!analRes?.ok) {
        failBrief('analyses', analRes?.error ?? '병렬 분석 실패')
        return
      }
      setBriefStage('synthesize')

      const synRes = await post({ action: 'synthesize', sessionId })
      if (synRes?.synthesis) setSynthesis(synRes.synthesis)
      if (!synRes?.ok) {
        failBrief('synthesize', synRes?.synthesisError ?? synRes?.error ?? t.briefNoSynthesis)
        return
      }

      setBriefStage('done')
      runningRef.current = false
    },
    [question, requestWithRetry, resetAll, t.briefNoSynthesis]
  )

  // ── DIAGNOSTIC mode → 2-AI quick brief (category preset) ──
  const runDiagnostic = useCallback(
    async (categoryId: string) => {
      if (runningRef.current) return

      runningRef.current = true
      resetAll()
      setMode('diagnostic')
      setActiveCategory(categoryId)
      setBriefStage('idle')
      setDiagStage('start')

      const post = (body: Record<string, unknown>) =>
        requestWithRetry('/api/jeju/diagnostic', body) as Promise<DiagnosticApiResult | null>
      const failDiag = (stageName: string, msg: string) => {
        setError(msg)
        setFailedStage(stageName)
        setDiagStage('error')
        runningRef.current = false
      }

      const startRes = await post({ action: 'start', categoryId })
      if (!startRes?.ok || !startRes.sessionId) {
        failDiag('start', startRes?.error ?? '데이터 수집 단계 실패')
        return
      }
      const sessionId = startRes.sessionId
      setDiagStage('search')

      const searchRes = await post({ action: 'search', sessionId })
      if (searchRes?.searches) setDiagSearches(searchRes.searches)
      if (!searchRes?.ok) {
        failDiag('search', searchRes?.error ?? '검색 단계 실패')
        return
      }
      setDiagStage('status')

      const statusRes = await post({ action: 'status', sessionId })
      if (statusRes?.status) setDiagStatus(statusRes.status)
      if (!statusRes?.ok) {
        failDiag('status', statusRes?.error ?? '현황 분석 실패')
        return
      }
      setDiagStage('issues')

      const issuesRes = await post({ action: 'issues', sessionId })
      if (issuesRes?.issues) setDiagIssues(issuesRes.issues)
      if (!issuesRes?.ok) {
        failDiag('issues', issuesRes?.error ?? '현안 진단 실패')
        return
      }

      setDiagStage('done')
      runningRef.current = false
    },
    [requestWithRetry, resetAll]
  )

  const briefRunning = briefStage !== 'idle' && briefStage !== 'done' && briefStage !== 'error'
  const diagRunning = diagStage !== 'idle' && diagStage !== 'done' && diagStage !== 'error'
  const running = briefRunning || diagRunning
  const elapsed = useElapsedTimer(running)

  // Resolve the active engine's stage label + banner copy. Brief takes priority
  // (it's the primary flow on this page); diagnostic fills in when it's the one
  // running. Both reuse the existing i18n stage labels — no new strings added.
  const briefStageLabels: Partial<Record<BriefStageKey, string>> = {
    start: t.briefStageStart,
    orchestrate: t.briefStageOrchestrate,
    'pre-report': t.briefStagePreReport,
    analyses: t.briefStageAnalyses,
    synthesize: t.briefStageSynthesize,
  }
  const diagStageLabels: Partial<Record<DiagStageKey, string>> = {
    start: t.diagnosticStageStart,
    search: t.diagnosticStageSearch,
    status: t.diagnosticStageStatus,
    issues: t.diagnosticStageIssues,
  }
  const bannerHeadline = briefRunning
    ? 'AI가 분석 중입니다 — 잠시만 기다려 주세요'
    : 'AI가 진단 중입니다 — 잠시만 기다려 주세요'
  const bannerStageLabel = briefRunning
    ? (briefStageLabels[briefStage] ?? t.deepStageDone)
    : (diagStageLabels[diagStage] ?? t.deepStageDone)
  const bannerHint = briefRunning
    ? '다중 AI 심층 분석은 보통 6~8분 걸립니다. 정상 작동 중이니 창을 닫지 말고 기다려 주세요.'
    : 'AI 진단은 보통 40초 내외 걸립니다. 창을 닫지 말고 기다려 주세요.'

  const bannerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (running) {
      bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [running])

  const hasBriefResult = mode === 'brief' && (roles.length > 0 || report || analyses.length > 0)

  return (
    <JejuThemeShell
      theme="governance"
      title={t.briefTitle}
      tagline={t.briefDesc}
      backHref="/jeju/governance"
      backLabel={t.backToGovernance}
    >
      <div className="flex flex-col gap-10">
        {/* TOP (primary): free-text prompt → 7-AI brief */}
        <div className="rounded-2xl border border-jeju-accent/40 bg-jeju-bg-elevated p-6 shadow-[var(--jeju-shadow)] sm:p-7">
          <p className="mb-3 text-sm font-bold text-jeju-fg">{t.briefPromptSectionLabel}</p>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t.briefQuestionPlaceholder}
            rows={3}
            disabled={running}
            className="w-full resize-y rounded-xl border border-jeju-border bg-jeju-bg px-4 py-3 text-base text-jeju-fg placeholder:text-jeju-fg-muted focus:border-jeju-accent focus:outline-none focus:ring-1 focus:ring-jeju-accent disabled:opacity-60"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => runBrief()}
              disabled={running || !question.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-jeju-accent px-6 py-3 text-sm font-bold text-jeju-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PlayCircle className="h-4 w-4" aria-hidden />
              {t.briefStartBtn}
            </button>
            {briefRunning && (
              <p className="text-xs text-jeju-fg-muted">{t.briefRunningHint(analystCount)}</p>
            )}
          </div>
        </div>

        {/* Divider — marks diagnostic as a separate, secondary tool */}
        <div className="flex items-center gap-3" role="separator" aria-label="또는">
          <div className="h-px flex-1 bg-jeju-border/50" />
          <span className="shrink-0 text-[11px] tracking-widest text-jeju-fg-muted">─── 또는 ───</span>
          <div className="h-px flex-1 bg-jeju-border/50" />
        </div>

        {/* BELOW (secondary): category grid → diagnostic — visually lighter */}
        <div className="rounded-xl border border-jeju-border/40 bg-jeju-bg/40 px-4 py-4">
          <p className="mb-1.5 text-[11px] font-medium tracking-wide text-jeju-fg-muted">
            {t.briefDiagnosticSectionLabel}
          </p>
          <p className="mb-3 text-[12px] leading-relaxed text-jeju-fg-muted/90">
            {t.briefDiagnosticExplain}
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
            {DIAGNOSTIC_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={running}
                onClick={() => runDiagnostic(c.id)}
                className={`flex flex-col items-center gap-0.5 rounded-lg border px-2.5 py-2 text-center text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  activeCategory === c.id
                    ? 'border-jeju-accent/70 bg-jeju-accent/10 text-jeju-accent'
                    : 'border-jeju-border/40 bg-transparent text-jeju-fg-muted hover:border-jeju-border hover:text-jeju-fg'
                }`}
              >
                <span className="text-base leading-none opacity-80" aria-hidden>
                  {c.emoji}
                </span>
                {c.label}
              </button>
            ))}
          </div>
          {diagRunning && (
            <p className="mt-3 text-xs text-jeju-fg-muted">{t.diagnosticRunningHint}</p>
          )}
        </div>

        {/* Running banner — prominent status while either engine works */}
        {running && (
          <BriefRunningBanner
            headline={bannerHeadline}
            stageLabel={bannerStageLabel}
            hint={bannerHint}
            elapsed={elapsed}
            bannerRef={bannerRef}
          />
        )}

        {/* Progress (whichever engine is running/ran) */}
        {mode === 'brief' && briefStage !== 'idle' && (
          <BriefProgressStrip stage={briefStage} t={t} />
        )}
        {mode === 'diagnostic' && diagStage !== 'idle' && (
          <DiagProgressStrip stage={diagStage} t={t} />
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <span className="font-semibold">{t.errorHeading}</span>
            {failedStage && ` (${failedStage})`}: {error}
          </div>
        )}

        {/* ── BRIEF result renderer ── */}
        {mode === 'brief' && synthesis && <SynthesisBlock synthesis={synthesis} t={t} />}

        {hasBriefResult && (
          <div className="flex flex-col gap-4">
            {/* Roster */}
            {roles.length > 0 && (
              <Section title={t.briefRosterHeading} defaultOpen={!synthesis} t={t}>
                {rationale && (
                  <p className="mb-3 text-xs leading-relaxed text-jeju-fg-muted">
                    {humanizeRosterRationale(rationale)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {roles.map((r) => (
                    <span
                      key={r.roleId}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-jeju-border bg-jeju-tile-bg px-3 py-1.5 text-xs"
                    >
                      <span className="font-semibold text-jeju-fg">
                        {aiProductNameWithGloss(r.provider ?? '')}
                      </span>
                      <span className="text-jeju-fg-muted">{r.roleLabel}</span>
                      {r.isDoubledAngle && (
                        <span className="rounded bg-amber-500/20 px-1 text-[9px] font-bold text-amber-300">
                          {t.briefDoubledBadge}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex items-start gap-2 rounded-xl border border-jeju-accent/30 bg-jeju-bg px-4 py-3">
                  <Search className="mt-0.5 h-4 w-4 shrink-0 text-jeju-accent" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-jeju-fg">{t.briefSearchSpecialist}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-jeju-fg-muted">
                      {t.briefSearchSpecialistDesc}
                    </p>
                  </div>
                </div>
              </Section>
            )}

            {/* Pre-report briefing */}
            {report && (
              <Section title={t.briefReportHeading} defaultOpen={!synthesis} t={t}>
                <Prose text={report} />
                {leadAnalysis && (
                  <details className="mt-4 rounded-xl border border-jeju-border bg-jeju-bg px-4 py-3">
                    <summary className="cursor-pointer text-xs font-semibold text-jeju-fg-muted">
                      {t.briefLeadAnalysisHeading}
                    </summary>
                    <div className="mt-2">
                      <Prose text={cleanLeadAnalysis(leadAnalysis)} />
                    </div>
                  </details>
                )}
                {searches.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-semibold text-jeju-fg-muted">
                      {t.briefSearchesHeading}
                    </p>
                    <p className="mb-2 text-[10px] italic text-jeju-fg-muted">
                      {t.briefSearchByline}
                    </p>
                    <div className="flex flex-col gap-2">
                      {searches.map((s, i) => (
                        <div key={i} className="rounded-lg bg-jeju-tile-bg px-3 py-2 text-xs">
                          <p className="font-semibold text-jeju-accent">{s.query}</p>
                          <Prose text={s.ok ? sanitizeCjk(s.result) : `(실패: ${s.error})`} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Section>
            )}

            {/* Parallel analyses */}
            {analyses.length > 0 && (
              <Section title={t.briefAnalysesHeading} defaultOpen={!synthesis} t={t}>
                <div className="flex flex-col gap-3">
                  {analyses.map((a, i) => (
                    <AnalysisCard key={i} analysis={a} t={t} />
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}

        {/* ── DIAGNOSTIC result renderer ── */}
        {mode === 'diagnostic' && diagStatus && (
          <PartCard
            heading={t.diagnosticStatusHeading}
            icon={<Activity className="h-4 w-4" aria-hidden />}
            part={diagStatus}
            t={t}
          />
        )}
        {mode === 'diagnostic' && diagIssues && (
          <PartCard
            heading={t.diagnosticIssuesHeading}
            icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
            part={diagIssues}
            t={t}
          />
        )}
        {mode === 'diagnostic' && diagSearches.length > 0 && (
          <Section title={t.diagnosticSearchesHeading} defaultOpen={!diagStatus} t={t}>
            <p className="mb-2 text-[10px] italic text-jeju-fg-muted">
              {t.diagnosticSearchByline}
            </p>
            <div className="flex flex-col gap-2">
              {diagSearches.map((s, i) => (
                <div key={i} className="rounded-lg bg-jeju-tile-bg px-3 py-2 text-xs">
                  <p className="flex items-center gap-1.5 font-semibold text-jeju-accent">
                    <Search className="h-3 w-3" aria-hidden />
                    {s.query}
                  </p>
                  <Prose text={s.ok ? s.result : `(실패: ${s.error})`} />
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </JejuThemeShell>
  )
}
