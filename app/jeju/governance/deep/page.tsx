'use client'

import { useState, useCallback, useRef } from 'react'
import { ChevronDown, ChevronUp, PlayCircle, Users } from 'lucide-react'
import { JejuThemeShell } from '@/components/jeju/JejuThemeShell'
import { useJejuUi } from '@/components/jeju/useJejuUi'
import { aiProductName, aiProductNameWithGloss } from '@/components/jeju/aiProviderLabel'

// ── Local types (shape-compatible with the route's responses) ─────────────────

type Role = {
  roleId: string
  roleLabel: string
  mandate?: string
  provider?: string
  isRedTeam?: boolean
}

type RoleAnalysis = {
  roleId: string
  roleLabel: string
  provider?: string
  isRedTeam?: boolean
  ok: boolean
  analysis?: string | null
  error?: string
}

type ExecutedSearch = {
  query: string
  requestedBy: string[]
  ok: boolean
  result: string | null
  error?: string
}

type RevisedAnalysis = {
  roleId: string
  roleLabel: string
  provider?: string
  isRedTeam?: boolean
  ok: boolean
  firstPass?: string | null
  revised?: string | null
  changed?: boolean
  error?: string
}

type Rebuttal = {
  roleId: string
  roleLabel: string
  provider?: string
  isRedTeam?: boolean
  ok: boolean
  targetRoleLabels?: string[]
  rebuttal?: string | null
  error?: string
}

type DeliberationTurn = {
  roleId: string
  roleLabel: string
  provider?: string
  isRedTeam?: boolean
  ok: boolean
  position?: string | null
  concedes?: string | null
  holds?: string | null
  error?: string
}

type RoundResult = {
  roundNumber: number
  turns: DeliberationTurn[]
  consensusScore: number
  agreedPoints: string[]
  contestedPoints: string[]
  summary: string
  ok: boolean
  error?: string
}

type VoteEntry = {
  provider: string
  ok: boolean
  choice: string | null
  reason: string | null
}

type VoteResult = {
  votes: VoteEntry[]
  approveCount: number
  opposeCount: number
  abstainCount: number
  approveProviders: string[]
  opposeProviders: string[]
  abstainProviders: string[]
  outcome: string
  ok: boolean
  summary: string
}

type Verdict = {
  judgment: string | null
  beat1Summary: string | null
  beat2Summary: string | null
  beat3Summary: string | null
  minorityReport: string | null
  mediaRisk: string | null
  disclaimer: string
  provider: string
  error?: string
}

type DeepApiResult = {
  ok: boolean
  stage?: string
  sessionId?: string
  nextAction?: string
  done?: boolean
  error?: string
  plan?: { questionType?: string }
  questionType?: string
  roles?: Role[]
  analyses?: RoleAnalysis[]
  searches?: ExecutedSearch[]
  droppedSearchCount?: number
  revised?: RevisedAnalysis[]
  debate?: Rebuttal[]
  roundNumber?: number
  consensusScore?: number
  roundOk?: boolean
  round?: RoundResult
  stoppedReason?: string
  verdict?: Verdict
  vote?: VoteResult
  deliberation?: {
    finalScore: number
    roundsRun: number
    stoppedReason: string
    agreedPoints: string[]
    contestedPoints: string[]
    summary: string
  }
}

type StageKey =
  | 'idle'
  | 'start'
  | 'search'
  | 'revise'
  | 'debate'
  | 'deliberate'
  | 'verdict'
  | 'done'
  | 'error'

type Ui = ReturnType<typeof useJejuUi>['t']

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ── Provider brand chip ───────────────────────────────────────────────────────

function ProviderChip({ provider }: { provider?: string }) {
  if (!provider) return null
  return (
    <span className="rounded-md bg-jeju-tile-bg px-1.5 py-0.5 text-[10px] font-semibold text-jeju-fg-muted">
      {aiProductName(provider)}
    </span>
  )
}

// ── Collapsible section — DEFAULT OPEN ────────────────────────────────────────

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

function RoleHeader({ label, provider, isRedTeam, t }: { label: string; provider?: string; isRedTeam?: boolean; t: Ui }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-jeju-fg">{label}</span>
      <ProviderChip provider={provider} />
      {isRedTeam && (
        <span className="rounded-md bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
          {t.deepRedTeamBadge}
        </span>
      )}
    </div>
  )
}

function Prose({ text }: { text: string | null | undefined }) {
  if (!text || !text.trim()) {
    return <p className="text-xs italic text-jeju-fg-muted">(내용 없음)</p>
  }
  return <p className="whitespace-pre-wrap text-sm leading-7 text-jeju-fg">{text}</p>
}

// ── Progress strip (분석→검색→재분석→토론→수렴→표결→판결) ──────────────────────

const STAGE_ORDER: StageKey[] = ['start', 'search', 'revise', 'debate', 'deliberate', 'verdict', 'done']

function ProgressStrip({ stage, t }: { stage: StageKey; t: Ui }) {
  const steps: { key: StageKey; label: string }[] = [
    { key: 'start', label: t.deepStageAnalysis },
    { key: 'search', label: t.deepStageSearch },
    { key: 'revise', label: t.deepStageRevise },
    { key: 'debate', label: t.deepStageDebate },
    { key: 'deliberate', label: t.deepStageDeliberate },
    { key: 'verdict', label: t.deepStageVote }, // vote pill between 수렴 and 판결
    { key: 'done', label: t.deepStageVerdict },
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

// ── Consensus progression bar (38 → 52 → 62 …) ────────────────────────────────

function ConsensusProgression({ rounds, t }: { rounds: RoundResult[]; t: Ui }) {
  if (rounds.length === 0) return null
  const maxScore = Math.max(...rounds.map((r) => (r.consensusScore >= 0 ? r.consensusScore : 0)), 1)
  return (
    <div className="flex flex-col gap-4">
      {/* Numeric chips with connectors */}
      <div className="flex flex-wrap items-center gap-2">
        {rounds.map((r, i) => {
          const prev = i > 0 ? rounds[i - 1]!.consensusScore : null
          const delta = prev != null && r.consensusScore >= 0 && prev >= 0 ? r.consensusScore - prev : null
          return (
            <span key={r.roundNumber} className="flex items-center gap-2">
              {i > 0 && <span className="text-jeju-accent/60" aria-hidden>→</span>}
              <span className="flex flex-col items-center rounded-xl border border-jeju-border bg-jeju-tile-bg px-4 py-2">
                <span className="text-[10px] uppercase tracking-wider text-jeju-fg-muted">
                  {t.deepEvidenceRoundLabel(r.roundNumber)}
                </span>
                <span className="text-2xl font-black leading-none text-jeju-accent">
                  {r.consensusScore >= 0 ? r.consensusScore : '—'}
                </span>
                {delta != null && (
                  <span className={`text-[10px] font-semibold ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-jeju-fg-muted'}`}>
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                )}
              </span>
            </span>
          )
        })}
      </div>
      {/* Mini bar chart */}
      <div className="flex items-end gap-2" style={{ height: 64 }}>
        {rounds.map((r) => {
          const h = r.consensusScore >= 0 ? Math.max(6, (r.consensusScore / Math.max(maxScore, 100)) * 64) : 6
          return (
            <div key={r.roundNumber} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div
                className="w-full rounded-t bg-gradient-to-t from-jeju-accent-secondary to-jeju-accent"
                style={{ height: `${h}px` }}
                aria-hidden
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Verdict (pinned summary at top once finished) ─────────────────────────────

function VerdictBlock({
  verdict,
  vote,
  consensusScore,
  stoppedReason,
  t,
}: {
  verdict: Verdict
  vote: VoteResult | null
  consensusScore: number
  stoppedReason: string
  t: Ui
}) {
  const sections: { heading: string; content: string | null }[] = [
    { heading: t.deepJudgmentHeading, content: verdict.judgment },
    { heading: t.deepBeat3Heading, content: verdict.beat3Summary },
    { heading: t.deepBeat1Heading, content: verdict.beat1Summary },
    { heading: t.deepBeat2Heading, content: verdict.beat2Summary },
    { heading: t.deepMinorityHeading, content: verdict.minorityReport },
    ...(verdict.mediaRisk ? [{ heading: t.deepMediaRiskHeading, content: verdict.mediaRisk }] : []),
    { heading: t.deepDisclaimerHeading, content: verdict.disclaimer },
  ]
  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-jeju-accent/40 bg-gradient-to-b from-jeju-bg-elevated to-jeju-bg px-6 py-6 shadow-[var(--jeju-shadow)]">
      {/* Headline band: verdict label + BIG consensus score */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-jeju-border pb-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-jeju-accent">
            {t.deepVerdictHeading}
          </p>
          <p className="mt-1 text-xs text-jeju-fg-muted">
            {t.deepStoppedReason(stoppedReason)}
            {verdict.provider && ` · ${t.providerLabel}: ${aiProductName(verdict.provider)}`}
          </p>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-widest text-jeju-fg-muted">
            {t.deepConsensusLabel}
          </span>
          <span className="flex items-baseline gap-1">
            <span className="text-5xl font-black leading-none text-jeju-accent">
              {consensusScore >= 0 ? consensusScore : '—'}
            </span>
            {consensusScore >= 0 && <span className="text-lg font-bold text-jeju-fg-muted">점</span>}
          </span>
        </div>
      </div>

      {sections.map((s, i) => (
        <div key={i}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
            {s.heading}
          </h3>
          <Prose text={s.content} />
        </div>
      ))}

      {vote && vote.ok && vote.votes.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
            {t.deepVoteHeading}
          </h3>
          <p className="mb-2 text-xs text-jeju-fg-muted">
            찬성 {vote.approveCount} · 반대 {vote.opposeCount} · 기권 {vote.abstainCount} —{' '}
            <span className={vote.outcome === 'approved' ? 'text-emerald-300' : vote.outcome === 'rejected' ? 'text-rose-300' : 'text-amber-300'}>
              {t.deepVoteOutcome(vote.outcome)}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

// ── Vote section (each AI's choice + reason) ──────────────────────────────────

function VoteSection({ vote, t }: { vote: VoteResult; t: Ui }) {
  return (
    <Section title={t.deepVoteHeading} t={t}>
      <p className="mb-3 text-xs text-jeju-fg-muted">
        찬성 {vote.approveCount} · 반대 {vote.opposeCount} · 기권 {vote.abstainCount} —{' '}
        <span className={vote.outcome === 'approved' ? 'text-emerald-300' : vote.outcome === 'rejected' ? 'text-rose-300' : 'text-amber-300'}>
          {t.deepVoteOutcome(vote.outcome)}
        </span>
      </p>
      <div className="flex flex-col gap-2">
        {vote.votes.map((v, i) => (
          <div key={i} className="flex flex-wrap gap-2 border-b border-jeju-border/50 pb-2 text-xs last:border-0">
            <span className="w-28 shrink-0 font-semibold text-jeju-fg">
              {aiProductNameWithGloss(v.provider)}
            </span>
            <span
              className={`w-10 shrink-0 font-bold ${
                v.choice === 'approve' ? 'text-emerald-300' : v.choice === 'oppose' ? 'text-rose-300' : 'text-amber-300'
              }`}
            >
              {v.choice === 'approve' ? '찬성' : v.choice === 'oppose' ? '반대' : '기권'}
            </span>
            <span className="flex-1 leading-relaxed text-jeju-fg-muted">{v.reason}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function JejuGovernanceDeepPage() {
  const { t } = useJejuUi()

  const [question, setQuestion] = useState('')
  const [stage, setStage] = useState<StageKey>('idle')
  const [error, setError] = useState<string | null>(null)
  const [failedStage, setFailedStage] = useState<string | null>(null)

  // Live-accumulating process state
  const [roles, setRoles] = useState<Role[]>([])
  const [questionType, setQuestionType] = useState<string | null>(null)
  const [analyses, setAnalyses] = useState<RoleAnalysis[]>([])
  const [searches, setSearches] = useState<ExecutedSearch[]>([])
  const [droppedSearchCount, setDroppedSearchCount] = useState(0)
  const [revised, setRevised] = useState<RevisedAnalysis[]>([])
  const [debate, setDebate] = useState<Rebuttal[]>([])
  const [rounds, setRounds] = useState<RoundResult[]>([])
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [vote, setVote] = useState<VoteResult | null>(null)
  const [consensusScore, setConsensusScore] = useState(-1)
  const [stoppedReason, setStoppedReason] = useState('max_rounds')

  const runningRef = useRef(false)

  const postWithRetry = useCallback(
    async (reqBody: Record<string, unknown>): Promise<DeepApiResult | null> => {
      const MAX_ATTEMPTS = 4
      let lastErr = ''
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch('/api/jeju/deep', {
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
            if (attempt < MAX_ATTEMPTS) { await delay(attempt * 1000); continue }
            setError(lastErr)
            return null
          }
          const data = (await res.json().catch(() => null)) as DeepApiResult | null
          if (!data) {
            lastErr = '응답 파싱 실패'
            if (attempt < MAX_ATTEMPTS) { await delay(attempt * 1000); continue }
            setError(lastErr)
            return null
          }
          return data
        } catch (e: unknown) {
          lastErr = e instanceof Error ? e.message : '네트워크 오류'
          if (attempt < MAX_ATTEMPTS) { await delay(attempt * 1000); continue }
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

  const runDeep = useCallback(async () => {
    const q = question.trim()
    if (!q || runningRef.current) return
    runningRef.current = true

    setStage('start')
    setError(null)
    setFailedStage(null)
    setRoles([])
    setQuestionType(null)
    setAnalyses([])
    setSearches([])
    setDroppedSearchCount(0)
    setRevised([])
    setDebate([])
    setRounds([])
    setVerdict(null)
    setVote(null)
    setConsensusScore(-1)
    setStoppedReason('max_rounds')

    try {
      // ── start ──────────────────────────────────────────────────────────────
      const startRes = await postWithRetry({ action: 'start', question: q })
      if (!startRes) { runningRef.current = false; return }
      if (startRes.roles) setRoles(startRes.roles)
      if (startRes.questionType) setQuestionType(startRes.questionType)
      if (startRes.analyses) setAnalyses(startRes.analyses)
      if (!startRes.ok) { stop(startRes.stage ?? 'start', startRes.error ?? '분석 시작 실패'); return }
      const sessionId = startRes.sessionId
      if (!sessionId) { stop('start', '세션 ID를 받지 못했습니다.'); return }

      // ── search ─────────────────────────────────────────────────────────────
      setStage('search')
      const searchRes = await postWithRetry({ action: 'search', sessionId })
      if (!searchRes) { runningRef.current = false; return }
      if (searchRes.searches) setSearches(searchRes.searches)
      if (typeof searchRes.droppedSearchCount === 'number') setDroppedSearchCount(searchRes.droppedSearchCount)
      if (!searchRes.ok) { stop(searchRes.stage ?? 'search', searchRes.error ?? '검색 실패'); return }

      // ── revise ─────────────────────────────────────────────────────────────
      setStage('revise')
      const reviseRes = await postWithRetry({ action: 'revise', sessionId })
      if (!reviseRes) { runningRef.current = false; return }
      if (reviseRes.revised) setRevised(reviseRes.revised)
      if (!reviseRes.ok) { stop(reviseRes.stage ?? 'revise', reviseRes.error ?? '재분석 실패'); return }

      // ── debate ─────────────────────────────────────────────────────────────
      setStage('debate')
      const debateRes = await postWithRetry({ action: 'debate', sessionId })
      if (!debateRes) { runningRef.current = false; return }
      if (debateRes.debate) setDebate(debateRes.debate)
      if (!debateRes.ok) { stop(debateRes.stage ?? 'debate', debateRes.error ?? '토론 실패'); return }

      // ── deliberate (repeat) ──────────────────────────────────────────────────
      setStage('deliberate')
      let deliberateDone = false
      let lastStoppedReason = 'max_rounds'
      while (!deliberateDone) {
        const delRes = await postWithRetry({ action: 'deliberate', sessionId })
        if (!delRes) { runningRef.current = false; return }
        if (delRes.round) {
          setRounds((prev) => [...prev, delRes.round as RoundResult])
        }
        if (typeof delRes.consensusScore === 'number') setConsensusScore(delRes.consensusScore)
        if (!delRes.ok) { stop(delRes.stage ?? 'deliberate', delRes.error ?? '수렴 실패'); return }
        deliberateDone = delRes.done === true
        if (delRes.stoppedReason) lastStoppedReason = delRes.stoppedReason
      }
      setStoppedReason(lastStoppedReason)

      // ── verdict ────────────────────────────────────────────────────────────
      setStage('verdict')
      const verdictRes = await postWithRetry({ action: 'verdict', sessionId })
      if (!verdictRes) { runningRef.current = false; return }
      if (verdictRes.verdict) setVerdict(verdictRes.verdict)
      if (verdictRes.vote) setVote(verdictRes.vote)
      if (verdictRes.deliberation?.finalScore !== undefined) setConsensusScore(verdictRes.deliberation.finalScore)
      if (verdictRes.deliberation?.stoppedReason) setStoppedReason(verdictRes.deliberation.stoppedReason)
      if (!verdictRes.ok && !verdictRes.verdict) { stop(verdictRes.stage ?? 'verdict', verdictRes.error ?? '판결 생성 실패'); return }

      setStage('done')
    } finally {
      runningRef.current = false
    }
  }, [question, postWithRetry, stop])

  const isRunning = stage !== 'idle' && stage !== 'done' && stage !== 'error'
  const pressAnalystConvened = roles.some((r) => r.roleLabel.includes('언론'))
  const showProcess = stage !== 'idle'

  return (
    <JejuThemeShell
      theme="governance"
      title={t.deepTitle}
      tagline={t.deepDesc}
      backHref="/jeju/governance"
      backLabel={t.backToGovernance}
    >
      {/* Input */}
      <div className="mb-6 flex flex-col gap-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t.deepQuestionPlaceholder}
          disabled={isRunning}
          rows={3}
          className="w-full resize-none rounded-xl border border-jeju-border bg-jeju-bg-elevated px-4 py-3 text-sm text-jeju-fg placeholder:text-jeju-fg-muted focus:border-jeju-accent focus:outline-none disabled:opacity-50"
        />
        <div className="flex justify-end">
          <button
            type="button"
            disabled={isRunning || !question.trim()}
            onClick={runDeep}
            className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-xl bg-jeju-accent px-6 py-2.5 text-sm font-bold text-black shadow-[var(--jeju-shadow)] transition hover:opacity-90 disabled:opacity-40"
          >
            <PlayCircle className={`h-4 w-4 ${isRunning ? 'animate-pulse' : ''}`} aria-hidden />
            {t.deepStartBtn}
          </button>
        </div>
      </div>

      {/* Progress strip */}
      {showProcess && (
        <div className="mb-6 rounded-xl border border-jeju-border bg-jeju-bg-elevated px-5 py-4">
          <ProgressStrip stage={stage} t={t} />
          {isRunning && <p className="mt-3 text-xs leading-relaxed text-jeju-fg-muted">{t.deepRunningHint}</p>}
        </div>
      )}

      {/* Error */}
      {stage === 'error' && error && (
        <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-300">
          <span className="font-semibold">
            {t.errorHeading}{failedStage ? ` (${failedStage})` : ''}:
          </span>{' '}
          {error}
        </div>
      )}

      {/* PINNED verdict summary at top (executives want the answer first) */}
      {verdict && (
        <div className="mb-8">
          <VerdictBlock
            verdict={verdict}
            vote={vote}
            consensusScore={consensusScore}
            stoppedReason={stoppedReason}
            t={t}
          />
        </div>
      )}

      {/* LIVE PROCESS — accumulates top-to-bottom, expanded by default */}
      {showProcess && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
            {t.deepProcessHeading}
          </h2>

          {/* 1. Convened experts */}
          {roles.length > 0 && (
            <Section
              title={t.deepConvenedHeading}
              t={t}
              badge={
                <span
                  className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    pressAnalystConvened ? 'bg-emerald-500/20 text-emerald-300' : 'bg-jeju-tile-bg text-jeju-fg-muted'
                  }`}
                >
                  <Users className="h-3 w-3" aria-hidden />
                  {pressAnalystConvened ? t.deepPressAnalystYes : t.deepPressAnalystNo}
                </span>
              }
            >
              <div className="flex flex-col gap-3">
                {roles.map((r) => (
                  <div key={r.roleId} className="border-b border-jeju-border/40 pb-2 last:border-0">
                    <RoleHeader label={r.roleLabel} provider={r.provider} isRedTeam={r.isRedTeam} t={t} />
                    {r.mandate && (
                      <p className="text-xs leading-relaxed text-jeju-fg-muted">
                        <span className="font-semibold">{t.deepMandateLabel}:</span> {r.mandate}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 2. Initial drafts */}
          {analyses.length > 0 && (
            <Section title={t.deepDraftsHeading} t={t}>
              <div className="flex flex-col gap-4">
                {analyses.map((a) => (
                  <div key={a.roleId} className="border-b border-jeju-border/40 pb-3 last:border-0">
                    <RoleHeader label={a.roleLabel} provider={a.provider} isRedTeam={a.isRedTeam} t={t} />
                    <Prose text={a.ok ? a.analysis : (a.error ?? '오류')} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 3. Search results */}
          {searches.length > 0 && (
            <Section
              title={t.deepSearchLiveHeading}
              t={t}
              badge={droppedSearchCount > 0 ? (
                <span className="text-[10px] text-jeju-fg-muted">{t.deepSearchDroppedNote(droppedSearchCount)}</span>
              ) : undefined}
            >
              <div className="flex flex-col gap-4">
                {searches.map((s, i) => (
                  <div key={i} className="border-b border-jeju-border/40 pb-3 last:border-0">
                    <p className="mb-1.5 text-sm font-semibold text-jeju-fg">
                      {t.deepEvidenceQueryLabel}: {s.query}
                    </p>
                    <Prose text={s.ok ? s.result : (s.error ?? '오류')} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 4. Re-analysis */}
          {revised.length > 0 && (
            <Section title={t.deepReviseHeading} t={t}>
              <div className="flex flex-col gap-4">
                {revised.map((r) => (
                  <div key={r.roleId} className="border-b border-jeju-border/40 pb-3 last:border-0">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-jeju-fg">{r.roleLabel}</span>
                      <ProviderChip provider={r.provider} />
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                          r.changed ? 'bg-amber-500/20 text-amber-300' : 'bg-jeju-tile-bg text-jeju-fg-muted'
                        }`}
                      >
                        {r.changed ? t.deepChangedBadge : t.deepUnchangedBadge}
                      </span>
                    </div>
                    <Prose text={r.ok ? (r.revised ?? r.firstPass) : (r.error ?? '오류')} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 5. Debate (rebuttals) */}
          {debate.length > 0 && (
            <Section title={t.deepDebateLiveHeading} t={t}>
              <div className="flex flex-col gap-4">
                {debate.map((d) => (
                  <div key={d.roleId} className="border-b border-jeju-border/40 pb-3 last:border-0">
                    <RoleHeader label={d.roleLabel} provider={d.provider} isRedTeam={d.isRedTeam} t={t} />
                    {d.targetRoleLabels && d.targetRoleLabels.length > 0 && (
                      <p className="mb-1 text-[11px] text-jeju-fg-muted">
                        {t.deepRebuttalTargetLabel}: {d.targetRoleLabels.join(', ')}
                      </p>
                    )}
                    <Prose text={d.ok ? d.rebuttal : (d.error ?? '오류')} />
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 6. Consensus progression + per-round detail */}
          {rounds.length > 0 && (
            <Section title={t.deepConsensusProgressionHeading} t={t}>
              <div className="mb-5">
                <ConsensusProgression rounds={rounds} t={t} />
              </div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
                {t.deepRoundsLiveHeading}
              </h4>
              <div className="flex flex-col gap-3">
                {rounds.map((r) => (
                  <details key={r.roundNumber} className="rounded-xl border border-jeju-border bg-jeju-bg" open>
                    <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-jeju-fg">
                      {t.deepRoundLabel(r.roundNumber, r.consensusScore)}
                    </summary>
                    <div className="flex flex-col gap-3 border-t border-jeju-border px-4 py-3">
                      {r.summary && <Prose text={r.summary} />}
                      {/* per-expert turns */}
                      {r.turns && r.turns.length > 0 && (
                        <div className="flex flex-col gap-3">
                          {r.turns.map((turn) => (
                            <div key={turn.roleId} className="rounded-lg bg-jeju-tile-bg px-3 py-2">
                              <RoleHeader label={turn.roleLabel} provider={turn.provider} isRedTeam={turn.isRedTeam} t={t} />
                              {turn.position && (
                                <p className="text-xs leading-relaxed text-jeju-fg">
                                  <span className="font-semibold text-jeju-accent">{t.deepTurnPosition}:</span> {turn.position}
                                </p>
                              )}
                              {turn.concedes && turn.concedes.trim() && (
                                <p className="mt-1 text-xs leading-relaxed text-emerald-300/90">
                                  <span className="font-semibold">{t.deepTurnConcedes}:</span> {turn.concedes}
                                </p>
                              )}
                              {turn.holds && turn.holds.trim() && (
                                <p className="mt-1 text-xs leading-relaxed text-rose-300/90">
                                  <span className="font-semibold">{t.deepTurnHolds}:</span> {turn.holds}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {r.agreedPoints.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-emerald-400">{t.deepEvidenceAgreedLabel}</p>
                          <ul className="list-disc pl-4 text-xs text-jeju-fg-muted">
                            {r.agreedPoints.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        </div>
                      )}
                      {r.contestedPoints.length > 0 && (
                        <div>
                          <p className="mb-1 text-xs font-semibold text-rose-400">{t.deepEvidenceContestedLabel}</p>
                          <ul className="list-disc pl-4 text-xs text-jeju-fg-muted">
                            {r.contestedPoints.map((p, i) => <li key={i}>{p}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </Section>
          )}

          {/* 7. Vote */}
          {vote && vote.ok && vote.votes.length > 0 && <VoteSection vote={vote} t={t} />}
        </div>
      )}
    </JejuThemeShell>
  )
}
