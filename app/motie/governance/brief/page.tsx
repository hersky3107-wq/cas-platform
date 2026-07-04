'use client'

import { useState, useCallback, useRef, useEffect, RefObject } from 'react'
import { ChevronDown, ChevronUp, Loader2, PlayCircle, Search } from 'lucide-react'
import { JejuThemeShell } from '@/components/motie/JejuThemeShell'
import { useMotieMode } from '@/components/motie/mode-context'
import { useJejuUi } from '@/components/motie/useJejuUi'
import { aiProductNameWithGloss } from '@/components/motie/aiProviderLabel'

// ── Local types (shape-compatible with the brief route) ───────────────────────

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

type BriefStageKey =
  | 'idle'
  | 'start'
  | 'orchestrate'
  | 'pre-report'
  | 'analyses'
  | 'synthesize'
  | 'done'
  | 'error'

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

// ── Elapsed-timer hook + running banner ──────────────────────────────────────

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

const BRIEF_STAGE_LABELS: Partial<Record<BriefStageKey, string>> = {
  start: '데이터 수집 중',
  orchestrate: '분석가 배치 중',
  'pre-report': '상황 브리핑 작성 중',
  analyses: '6개 AI 병렬 분석 중',
  synthesize: '통합 권고 작성 중',
}

function BriefRunningBanner({
  stage,
  elapsed,
  bannerRef,
}: {
  stage: BriefStageKey
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
        <p className="text-base font-bold text-jeju-fg">AI가 분석 중입니다 — 잠시만 기다려 주세요</p>
        <span className="ml-auto font-mono text-xl font-extrabold tabular-nums text-jeju-accent">
          {elapsed}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-jeju-accent">
        {BRIEF_STAGE_LABELS[stage] ?? '처리 중'}
      </p>
      <p className="mt-1 text-xs text-jeju-fg-muted">
        다중 AI 심층 분석은 보통 3~5분 걸립니다. 정상 작동 중이니 창을 닫지 말고 기다려 주세요.
      </p>
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

function AnalysisCard({
  analysis,
  t,
  isSearchCard = false,
}: {
  analysis: OpenAnalysis
  t: Ui
  isSearchCard?: boolean
}) {
  return (
    <div className="rounded-xl bg-jeju-tile-bg px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-jeju-fg">
          {aiProductNameWithGloss(analysis.provider)}
        </span>
        <span className="rounded-md bg-jeju-bg px-1.5 py-0.5 text-[10px] text-jeju-fg-muted">
          {analysis.roleLabel}
        </span>
        {isSearchCard && (
          <span className="inline-flex items-center gap-1 rounded-md bg-jeju-bg px-1.5 py-0.5 text-[10px] font-semibold text-jeju-accent">
            <Search className="h-2.5 w-2.5" aria-hidden />
            실시간 검색
          </span>
        )}
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

// ── Section (reusable body — open-brief only; no shell/back-link, no diagnostic) ──

export function BriefSection() {
  const { t } = useJejuUi()

  const [error, setError] = useState<string | null>(null)
  const [failedStage, setFailedStage] = useState<string | null>(null)
  const runningRef = useRef(false)

  // AX COUNCIL mode — read via ref so the retry helper always sends the latest.
  const { mode: councilMode } = useMotieMode()
  const councilModeRef = useRef(councilMode)
  councilModeRef.current = councilMode

  // ── Brief (prompt) state ──
  const [question, setQuestion] = useState('')
  const [briefStage, setBriefStage] = useState<BriefStageKey>('idle')
  const [analystCount, setAnalystCount] = useState(6)
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [rationale, setRationale] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [leadAnalysis, setLeadAnalysis] = useState<string | null>(null)
  const [searches, setSearches] = useState<ExecutedSearch[]>([])
  const [analyses, setAnalyses] = useState<OpenAnalysis[]>([])
  const [synthesis, setSynthesis] = useState<string | null>(null)

  // ── Shared request helper ──
  const requestWithRetry = useCallback(
    async (endpoint: string, reqBody: Record<string, unknown>): Promise<unknown> => {
      const MAX_ATTEMPTS = 4
      let lastErr = ''
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ councilMode: councilModeRef.current, ...reqBody }),
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
  }, [])

  // ── PROMPT mode → 7-AI brief engine ──
  const runBrief = useCallback(
    async (overrideQ?: string) => {
      const q = (overrideQ ?? question).trim()
      if (!q || runningRef.current) return

      runningRef.current = true
      resetAll()
      setBriefStage('start')

      const post = (body: Record<string, unknown>) =>
        requestWithRetry('/api/motie/brief', body) as Promise<BriefApiResult | null>
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

  const briefRunning = briefStage !== 'idle' && briefStage !== 'done' && briefStage !== 'error'
  const elapsed = useElapsedTimer(briefRunning)
  const running = briefRunning

  const bannerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (briefRunning) {
      bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [briefRunning])

  const hasBriefResult = roles.length > 0 || report || analyses.length > 0

  // Synthetic 7th card (trade only): surface the forced Perplexity 현지 언론·여론
  // search as a briefing card alongside the 6 analysts. Render-only — the
  // analyses state array is never mutated and no extra AI call is made.
  const localOpinionSearch =
    councilMode === 'trade'
      ? searches.find((s) => s.query.includes('현지 언론') || s.query.includes('여론'))
      : undefined
  const perplexityOpinionCard: OpenAnalysis | null = localOpinionSearch
    ? {
        roleId: 'perplexity-local-opinion',
        roleLabel: '현지 언론·여론 조사',
        provider: 'perplexity',
        subQuestion: localOpinionSearch.query.replace(/^\[오늘:[^\]]*\]\s*/, ''),
        isDoubledAngle: false,
        ok: localOpinionSearch.ok,
        analysis: localOpinionSearch.result,
        ...(localOpinionSearch.ok ? {} : { error: localOpinionSearch.error }),
      }
    : null

  return (
    <div className="flex flex-col gap-6">
      {/* Free-text prompt → 7-AI brief */}
      <div className="rounded-2xl border border-jeju-accent/40 bg-jeju-bg-elevated p-6 shadow-[var(--jeju-shadow)]">
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

      {/* Running banner — prominent status while engine works */}
      {briefRunning && <BriefRunningBanner stage={briefStage} elapsed={elapsed} bannerRef={bannerRef} />}

      {/* Progress */}
      {briefStage !== 'idle' && <BriefProgressStrip stage={briefStage} t={t} />}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <span className="font-semibold">{t.errorHeading}</span>
          {failedStage && ` (${failedStage})`}: {error}
        </div>
      )}

      {/* ── BRIEF result renderer ── */}
      {synthesis && <SynthesisBlock synthesis={synthesis} t={t} />}

      {hasBriefResult && (
        <div className="flex flex-col gap-4">
          {/* Roster */}
          {roles.length > 0 && (
            <Section title={t.briefRosterHeading} defaultOpen={!synthesis} t={t}>
              {rationale && (
                <p className="mb-3 text-xs leading-relaxed text-jeju-fg-muted">{rationale}</p>
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

          {/* Parallel analyses (+ synthetic Perplexity local-opinion card for trade) */}
          {analyses.length > 0 && (
            <Section title={t.briefAnalysesHeading} defaultOpen={!synthesis} t={t}>
              <div className="flex flex-col gap-3">
                {analyses.map((a, i) => (
                  <AnalysisCard key={i} analysis={a} t={t} />
                ))}
                {perplexityOpinionCard && (
                  <AnalysisCard analysis={perplexityOpinionCard} t={t} isSearchCard />
                )}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page (standalone route — wraps the section in its own shell) ─────────

export default function JejuGovernanceBriefPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="governance"
      title={t.briefTitle}
      tagline={t.briefDesc}
      backHref="/motie/governance"
      backLabel={t.backToGovernance}
    >
      <BriefSection />
    </JejuThemeShell>
  )
}
