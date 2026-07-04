'use client'

import { useState, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, PlayCircle, Search, Activity, AlertTriangle } from 'lucide-react'
import { JejuThemeShell } from '@/components/motie/JejuThemeShell'
import { useMotieMode } from '@/components/motie/mode-context'
import { useJejuUi } from '@/components/motie/useJejuUi'
import { aiProductNameWithGloss } from '@/components/motie/aiProviderLabel'
import { getDiagnosticCategories } from '@/lib/motie/diagnostic-categories'

// ── Local types (shape-compatible with app/api/jeju/diagnostic/route.ts) ──────

type ExecutedSearch = {
  query: string
  ok: boolean
  result: string | null
  error?: string
}

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

type StageKey = 'idle' | 'start' | 'search' | 'status' | 'issues' | 'done' | 'error'

type Ui = ReturnType<typeof useJejuUi>['t']

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function Prose({ text }: { text: string | null | undefined }) {
  if (!text || !text.trim())
    return <p className="text-xs italic text-jeju-fg-muted">(내용 없음)</p>
  return <p className="whitespace-pre-wrap text-sm leading-7 text-jeju-fg">{text}</p>
}

function Section({
  title,
  defaultOpen = true,
  t,
  children,
}: {
  title: string
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
        <span className="text-sm font-bold text-jeju-fg">{title}</span>
        <span className="flex items-center gap-1 text-xs text-jeju-fg-muted">
          {open ? t.deepCollapse : t.deepExpand}
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>
      {open && <div className="border-t border-jeju-border px-5 py-4">{children}</div>}
    </section>
  )
}

const STAGE_ORDER: StageKey[] = ['start', 'search', 'status', 'issues', 'done']

function ProgressStrip({ stage, t }: { stage: StageKey; t: Ui }) {
  const steps: { key: StageKey; label: string }[] = [
    { key: 'start', label: t.diagnosticStageStart },
    { key: 'search', label: t.diagnosticStageSearch },
    { key: 'status', label: t.diagnosticStageStatus },
    { key: 'issues', label: t.diagnosticStageIssues },
    { key: 'done', label: t.deepStageDone },
  ]
  const activeIdx = STAGE_ORDER.indexOf(stage)
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
          <span className="text-xs text-jeju-fg-muted">{aiProductNameWithGloss(part.provider)}</span>
        )}
      </div>
      {part.ok ? <Prose text={part.text} /> : <p className="text-xs text-rose-300">{part.error ?? t.diagnosticNoResult}</p>}
    </div>
  )
}

// ── Section (reusable body — no shell/back-link; used by page + unified) ──────

export function DiagnosticSection() {
  const { t } = useJejuUi()

  const [question, setQuestion] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [stage, setStage] = useState<StageKey>('idle')
  const [error, setError] = useState<string | null>(null)
  const [failedStage, setFailedStage] = useState<string | null>(null)

  const [searches, setSearches] = useState<ExecutedSearch[]>([])
  const [status, setStatus] = useState<DiagnosticPart | null>(null)
  const [issues, setIssues] = useState<DiagnosticPart | null>(null)

  const runningRef = useRef(false)

  // AX COUNCIL mode — read via ref so the retry helper always sends the latest.
  const { mode: councilMode } = useMotieMode()
  const councilModeRef = useRef(councilMode)
  councilModeRef.current = councilMode
  const categories = getDiagnosticCategories(councilMode)

  const postWithRetry = useCallback(
    async (reqBody: Record<string, unknown>): Promise<DiagnosticApiResult | null> => {
      const MAX_ATTEMPTS = 4
      let lastErr = ''
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch('/api/motie/diagnostic', {
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
          const data = (await res.json().catch(() => null)) as DiagnosticApiResult | null
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

  const stop = useCallback((stageName: string, msg: string) => {
    setError(msg)
    setFailedStage(stageName)
    setStage('error')
    runningRef.current = false
  }, [])

  const runDiagnostic = useCallback(
    async (opts: { categoryId?: string; overrideQ?: string }) => {
      if (runningRef.current) return
      const q = (opts.overrideQ ?? question).trim()
      if (!opts.categoryId && !q) return

      runningRef.current = true
      setError(null)
      setFailedStage(null)
      setStage('start')
      setSearches([])
      setStatus(null)
      setIssues(null)
      setActiveCategory(opts.categoryId ?? null)

      // ── start ──
      const startRes = await postWithRetry({
        action: 'start',
        ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
        ...(q ? { question: q } : {}),
      })
      if (!startRes?.ok || !startRes.sessionId) {
        stop('start', startRes?.error ?? '데이터 수집 단계 실패')
        return
      }
      const sessionId = startRes.sessionId
      setStage('search')

      // ── search ──
      const searchRes = await postWithRetry({ action: 'search', sessionId })
      if (searchRes?.searches) setSearches(searchRes.searches)
      if (!searchRes?.ok) {
        stop('search', searchRes?.error ?? '검색 단계 실패')
        return
      }
      setStage('status')

      // ── status (AI① Sonnet) ──
      const statusRes = await postWithRetry({ action: 'status', sessionId })
      if (statusRes?.status) setStatus(statusRes.status)
      if (!statusRes?.ok) {
        stop('status', statusRes?.error ?? '현황 분석 실패')
        return
      }
      setStage('issues')

      // ── issues (AI② Opus) ──
      const issuesRes = await postWithRetry({ action: 'issues', sessionId })
      if (issuesRes?.issues) setIssues(issuesRes.issues)
      if (!issuesRes?.ok) {
        stop('issues', issuesRes?.error ?? '현안 진단 실패')
        return
      }

      setStage('done')
      runningRef.current = false
    },
    [question, postWithRetry, stop]
  )

  const running = stage !== 'idle' && stage !== 'done' && stage !== 'error'

  return (
    <div className="flex flex-col gap-6">
      {/* Category buttons */}
        <div className="rounded-2xl border border-jeju-border bg-jeju-bg-elevated p-5 shadow-[var(--jeju-shadow)]">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
            {t.diagnosticCategoryHeading}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((c) => {
              const badge =
                c.backing === 'data'
                  ? { icon: '🟢', label: '공공데이터', cls: 'text-emerald-400/80' }
                  : c.backing === 'hybrid'
                    ? { icon: '🟡', label: '일부 데이터', cls: 'text-amber-400/80' }
                    : { icon: '🔍', label: '검색 기반', cls: 'text-jeju-fg-muted' }
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={running}
                  onClick={() => runDiagnostic({ categoryId: c.id })}
                  className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-center text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    activeCategory === c.id
                      ? 'border-jeju-accent bg-jeju-accent/15 text-jeju-accent'
                      : 'border-jeju-border bg-jeju-tile-bg text-jeju-fg hover:bg-jeju-tile-hover'
                  }`}
                >
                  <span className="text-xl leading-none" aria-hidden>
                    {c.emoji}
                  </span>
                  {c.label}
                  <span className={`text-[10px] font-normal leading-none ${badge.cls}`}>
                    {badge.icon} {badge.label}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-3 text-[10px] text-jeju-fg-muted">
            🟢 공공데이터 연동 · 🟡 일부 데이터 · 🔍 검색 기반 — 각 분야가 무엇을 근거로 진단하는지 표시합니다.
          </p>

          {/* Free-text question */}
          <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
            {t.diagnosticCustomHeading}
          </p>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t.diagnosticCustomPlaceholder}
            rows={2}
            disabled={running}
            className="w-full resize-y rounded-xl border border-jeju-border bg-jeju-bg px-4 py-3 text-sm text-jeju-fg placeholder:text-jeju-fg-muted focus:border-jeju-accent focus:outline-none focus:ring-1 focus:ring-jeju-accent disabled:opacity-60"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => runDiagnostic({})}
              disabled={running || !question.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-jeju-accent px-5 py-2.5 text-sm font-bold text-jeju-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <PlayCircle className="h-4 w-4" aria-hidden />
              {t.diagnosticRunBtn}
            </button>
            {running && <p className="text-xs text-jeju-fg-muted">{t.diagnosticRunningHint}</p>}
          </div>
        </div>

        {/* Progress */}
        {stage !== 'idle' && <ProgressStrip stage={stage} t={t} />}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <span className="font-semibold">{t.errorHeading}</span>
            {failedStage && ` (${failedStage})`}: {error}
          </div>
        )}

        {/* TOP: two-part brief */}
        {status && (
          <PartCard
            heading={t.diagnosticStatusHeading}
            icon={<Activity className="h-4 w-4" aria-hidden />}
            part={status}
            t={t}
          />
        )}
        {issues && (
          <PartCard
            heading={t.diagnosticIssuesHeading}
            icon={<AlertTriangle className="h-4 w-4" aria-hidden />}
            part={issues}
            t={t}
          />
        )}

        {/* BELOW: evidence */}
        {searches.length > 0 && (
          <Section title={t.diagnosticSearchesHeading} defaultOpen={!status} t={t}>
            <p className="mb-2 text-[10px] italic text-jeju-fg-muted">{t.diagnosticSearchByline}</p>
            <div className="flex flex-col gap-2">
              {searches.map((s, i) => (
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
  )
}

// ── Main page (standalone route — wraps the section in its own shell) ─────────

export default function JejuGovernanceDiagnosticPage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="governance"
      title={t.diagnosticTitle}
      tagline={t.diagnosticDesc}
      backHref="/motie/governance"
      backLabel={t.backToGovernance}
    >
      <DiagnosticSection />
    </JejuThemeShell>
  )
}
