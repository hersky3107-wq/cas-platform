'use client'

import { useState, useCallback, useRef, useEffect, RefObject } from 'react'
import { ChevronDown, ChevronUp, Loader2, PlayCircle, MessageSquare, Search } from 'lucide-react'
import { JejuThemeShell } from '@/components/gunpo/JejuThemeShell'
import { useMotieMode, toJejuCouncilMode } from '@/components/gunpo/mode-context'
import { useJejuUi } from '@/components/gunpo/useJejuUi'
import { aiProductName, aiProductNameWithGloss } from '@/components/motie/aiProviderLabel'
import { SupplementCard } from '@/app/gunpo/governance/_components/SupplementCard'
import { GunpoPanelNotice, PublicDataNotice } from '@/app/gunpo/governance/_components/GunpoPanelNotice'
import type { MotieSupplement } from '@/lib/gunpo/supplements'

// ── Local types (shape-compatible with app/api/jeju/deliberate/route.ts) ──────

type DebaterInfo = { provider: string; brand: string }

type RoleInfo = {
  roleId: string
  roleLabel: string
  mandate?: string
  provider?: string
  isRedTeam?: boolean
}

type ExecutedSearch = {
  query: string
  ok: boolean
  result: string | null
  error?: string
}

/** A SYNOD-style debate turn (from the opening and turn actions). */
type DebateTurn = {
  roundNumber: number
  aiName: string
  actionTag?: string
  claim?: string
  content: string
  isRedTeam?: boolean
  /** True when this seat produced no usable statement this round (see noResponseTurn). */
  failed?: boolean
}

/** A facilitator summary (from the facilitate action). */
type FacilitatorSummary = {
  roundNumber: number
  consensusPoints: { point: string; agreedBy: string[] }[]
  openIssues: { issue: string; positions: { ai: string; stance: string }[] }[]
  roundConsensusScore: number
  nextDirective: string
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
  conditionalCount: number
  opposeCount: number
  abstainCount: number
  approveProviders: string[]
  conditionalProviders: string[]
  opposeProviders: string[]
  abstainProviders: string[]
  outcome: string
  ok: boolean
  summary: string
}

type Verdict = {
  keyIssues: string | null
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

type DeliberateApiResult = {
  ok: boolean
  stage?: string
  sessionId?: string
  nextAction?: string
  done?: boolean
  error?: string
  reportError?: string
  questionType?: string
  roles?: RoleInfo[]
  rationale?: string
  debaters?: DebaterInfo[]
  // report action
  report?: string | null
  leadAnalysis?: string | null
  searches?: ExecutedSearch[]
  droppedSearchCount?: number
  // open / turn
  roundNumber?: number
  turns?: DebateTurn[]
  // facilitate
  consensusScore?: number
  summary?: FacilitatorSummary
  stoppedReason?: string
  // vote
  voted?: boolean
  voteSkipReason?: 'none' | 'open_ended' | 'unmeasurable' | 'high_consensus'
  vote?: VoteResult
  // verdict
  verdict?: Verdict
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
  | 'report'
  | 'open'
  | 'turn'
  | 'facilitate'
  | 'vote'
  | 'verdict'
  | 'done'
  | 'error'

type Ui = ReturnType<typeof useJejuUi>['t']

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// ── Shared micro-components ───────────────────────────────────────────────────

function BrandChip({ name }: { name: string }) {
  return (
    <span className="rounded-md bg-jeju-tile-bg px-1.5 py-0.5 text-[10px] font-semibold text-jeju-fg-muted">
      {name}
    </span>
  )
}

function RedTeamBadge({ t }: { t: Ui }) {
  return (
    <span className="rounded-md bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
      {t.deliberateRedTeamBadge}
    </span>
  )
}

/** Explicit, un-missable marker for a seat that produced nothing this round — never rendered silently. */
function FailedBadge({ t }: { t: Ui }) {
  return (
    <span className="rounded-md border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
      ⚠ {t.deliberateSeatFailedBadge}
    </span>
  )
}

function ActionTagBadge({ tag }: { tag: string }) {
  const colour =
    tag === 'CHALLENGE'
      ? 'bg-rose-500/20 text-rose-300'
      : tag === 'AGREE'
        ? 'bg-emerald-500/20 text-emerald-300'
        : tag === 'REFRAME'
          ? 'bg-amber-500/20 text-amber-300'
          : 'bg-sky-500/20 text-sky-300'
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${colour}`}>{tag}</span>
  )
}

function Prose({ text }: { text: string | null | undefined }) {
  if (!text || !text.trim())
    return <p className="text-xs italic text-jeju-fg-muted">(내용 없음)</p>
  return <p className="whitespace-pre-wrap text-sm leading-7 text-jeju-fg">{text}</p>
}

// Notice text for a skipped ballot. Never references the runtime consensus as a
// "target": the high-consensus branch hardcodes the fixed 85 threshold, and the
// open-ended branch makes no convergence claim (open-ended has no pro/con vote).
function voteSkipNotice(reason: 'none' | 'open_ended' | 'unmeasurable' | 'high_consensus'): string {
  if (reason === 'high_consensus')
    return '합의도가 85점 이상으로 강하게 수렴하여 표결을 생략하고 의장 판결로 이행합니다.'
  if (reason === 'open_ended')
    return '개방형 심의는 진영 표결 없이 병렬 분석을 종합해 의장 권고로 이행합니다.'
  return '이번 심의는 진영 표결 없이 의장 판결로 이행합니다.'
}

// ── Collapsible section ───────────────────────────────────────────────────────

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

const DELIBERATE_STAGE_LABELS: Partial<Record<StageKey, (t: Ui) => string>> = {
  start: (t) => t.deliberateStageStart,
  report: (t) => t.deliberateStageReport,
  open: (t) => t.deliberateStageOpen,
  turn: (t) => t.deliberateStageTurn,
  facilitate: (t) => t.deliberateStageFacilitate,
  vote: (t) => t.deliberateStageVote,
  verdict: (t) => t.deliberateStageVerdict,
}

function DeliberateRunningBanner({
  stage,
  elapsed,
  t,
  bannerRef,
}: {
  stage: StageKey
  elapsed: string
  t: Ui
  bannerRef: RefObject<HTMLDivElement | null>
}) {
  const stageLabel = DELIBERATE_STAGE_LABELS[stage]?.(t) ?? '처리 중'
  return (
    <div
      ref={bannerRef}
      className="sticky top-2 z-10 mb-6 rounded-xl border-2 border-jeju-accent bg-jeju-accent/15 px-6 py-5 shadow-[0_4px_20px_rgba(0,0,0,0.35)]"
    >
      <div className="flex items-center gap-3">
        <Loader2 className="h-6 w-6 shrink-0 animate-spin text-jeju-accent" aria-hidden />
        <p className="text-base font-bold text-jeju-fg">AI가 분석 중입니다 — 잠시만 기다려 주세요</p>
        <span className="ml-auto font-mono text-xl font-extrabold tabular-nums text-jeju-accent">
          {elapsed}
        </span>
      </div>
      <p className="mt-2 text-sm font-semibold text-jeju-accent">{stageLabel}</p>
      <p className="mt-1 text-xs text-jeju-fg-muted">
        다중 AI 심층 토론·표결은 보통 8~11분 걸립니다. 정상 작동 중이니 창을 닫지 말고 기다려 주세요.
      </p>
    </div>
  )
}

// ── Progress strip (start→report→open→turn/facilitate→vote→verdict) ───────────

const STAGE_ORDER: StageKey[] = [
  'start',
  'report',
  'open',
  'turn',
  'facilitate',
  'vote',
  'verdict',
  'done',
]

function ProgressStrip({ stage, t }: { stage: StageKey; t: Ui }) {
  const steps: { key: StageKey; label: string }[] = [
    { key: 'start', label: t.deliberateStageStart },
    { key: 'report', label: t.deliberateStageReport },
    { key: 'open', label: t.deliberateStageOpen },
    { key: 'turn', label: t.deliberateStageTurn },
    { key: 'facilitate', label: t.deliberateStageFacilitate },
    { key: 'vote', label: t.deliberateStageVote },
    { key: 'verdict', label: t.deliberateStageVerdict },
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

// ── Consensus trajectory: labeled chips + bar chart (no naked bars) ────────────

type RoundScore = { roundNumber: number; score: number }

function ConsensusTrajectory({ scores, t }: { scores: RoundScore[]; t: Ui }) {
  if (scores.length === 0) return null
  const maxScore = Math.max(...scores.map((s) => (s.score >= 0 ? s.score : 0)), 1)

  return (
    <div className="flex flex-col gap-5">
      {/* Numeric chips with deltas */}
      <div className="flex flex-wrap items-center gap-2">
        {scores.map((s, i) => {
          const prev = i > 0 ? scores[i - 1]!.score : null
          const delta = prev != null && s.score >= 0 && prev >= 0 ? s.score - prev : null
          return (
            <span key={s.roundNumber} className="flex items-center gap-2">
              {i > 0 && (
                <span className="text-jeju-accent/60" aria-hidden>
                  →
                </span>
              )}
              <span className="flex flex-col items-center rounded-xl border border-jeju-border bg-jeju-tile-bg px-4 py-2">
                <span className="text-[10px] uppercase tracking-wider text-jeju-fg-muted">
                  {t.deepEvidenceRoundLabel(s.roundNumber)}
                </span>
                <span className="text-2xl font-black leading-none text-jeju-accent">
                  {s.score >= 0 ? s.score : '—'}
                </span>
                {delta != null && (
                  <span
                    className={`text-[10px] font-semibold ${
                      delta > 0
                        ? 'text-emerald-400'
                        : delta < 0
                          ? 'text-rose-400'
                          : 'text-jeju-fg-muted'
                    }`}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </span>
                )}
              </span>
            </span>
          )
        })}
      </div>

      {/* Bar chart — each bar labelled with round + score so nothing is "naked" */}
      <div className="flex items-end gap-2" style={{ height: 80 }}>
        {scores.map((s) => {
          const barH =
            s.score >= 0
              ? Math.max(8, (s.score / Math.max(maxScore, 100)) * 72)
              : 8
          return (
            <div key={s.roundNumber} className="flex flex-1 flex-col items-center justify-end gap-1">
              {/* Score label on top of bar */}
              <span className="text-[10px] font-bold leading-none text-jeju-accent">
                {s.score >= 0 ? s.score : '—'}
              </span>
              <div
                className="w-full rounded-t bg-gradient-to-t from-jeju-accent-secondary to-jeju-accent"
                style={{ height: `${barH}px` }}
                title={`라운드 ${s.roundNumber}: ${s.score}점`}
              />
              {/* Round label below bar */}
              <span className="text-[10px] text-jeju-fg-muted">{`R${s.roundNumber}`}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── One debate turn card ──────────────────────────────────────────────────────

function TurnCard({ turn, t }: { turn: DebateTurn; t: Ui }) {
  return (
    <div
      className={`rounded-xl px-4 py-3 ${turn.failed ? 'border border-amber-500/30 bg-amber-500/5' : 'bg-jeju-tile-bg'}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-jeju-fg">
          {aiProductNameWithGloss(turn.aiName)}
        </span>
        {turn.failed && <FailedBadge t={t} />}
        {turn.isRedTeam && <RedTeamBadge t={t} />}
        {turn.actionTag && <ActionTagBadge tag={turn.actionTag} />}
      </div>
      {turn.claim && (
        <p className="mb-1.5 text-[11px] italic text-jeju-accent">
          <span className="not-italic font-semibold">{t.deliberateClaimLabel}:</span> {turn.claim}
        </p>
      )}
      <Prose text={turn.content} />
    </div>
  )
}

// ── Per-round details (turns + facilitator summary) ───────────────────────────

function RoundAccordion({
  roundNumber,
  turns,
  summary,
  t,
}: {
  roundNumber: number
  turns: DebateTurn[]
  summary: FacilitatorSummary | undefined
  t: Ui
}) {
  const score = summary?.roundConsensusScore ?? -1
  const label = t.deliberateRoundLabel(roundNumber, score)

  return (
    <details className="rounded-xl border border-jeju-border bg-jeju-bg" open>
      <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-semibold text-jeju-fg">
        {label}
      </summary>
      <div className="flex flex-col gap-4 border-t border-jeju-border px-4 py-4">
        {/* Facilitator summary block */}
        {summary && (
          <div className="rounded-lg border border-jeju-accent/20 bg-jeju-bg-elevated px-4 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-jeju-fg-muted">
                {t.deliberateFacilitatorScore}
              </span>
              <span className="text-xl font-black text-jeju-accent">
                {score >= 0 ? `${score}점` : '—'}
              </span>
            </div>
            {summary.consensusPoints.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-[11px] font-semibold text-emerald-400">
                  {t.deliberateAgreePointsLabel}
                </p>
                <ul className="list-disc pl-4 text-xs text-jeju-fg-muted">
                  {summary.consensusPoints.map((cp, i) => (
                    <li key={i}>
                      {cp.point}
                      {cp.agreedBy.length > 0 && (
                        <span className="text-jeju-fg-muted/60"> ({cp.agreedBy.join(', ')})</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.openIssues.length > 0 && (
              <div className="mb-2">
                <p className="mb-1 text-[11px] font-semibold text-rose-400">
                  {t.deliberateOpenIssuesLabel}
                </p>
                <ul className="list-disc pl-4 text-xs text-jeju-fg-muted">
                  {summary.openIssues.map((oi, i) => (
                    <li key={i}>
                      {oi.issue}
                      {oi.positions.length > 0 && (
                        <ul className="mt-0.5 list-none pl-3 text-[10px] text-jeju-fg-muted/70">
                          {oi.positions.map((p, j) => (
                            <li key={j}>
                              {p.ai}: {p.stance}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.nextDirective && (
              <p className="text-[11px] text-jeju-fg-muted">
                <span className="font-semibold">{t.deliberateNextDirectiveLabel}:</span>{' '}
                {summary.nextDirective}
              </p>
            )}
          </div>
        )}

        {/* Per-debater turns */}
        {turns.length > 0 && (
          <div className="flex flex-col gap-3">
            {turns.map((turn, i) => (
              <TurnCard key={i} turn={turn} t={t} />
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

// ── Verdict block (pinned at top once done) ───────────────────────────────────

function VerdictBlock({
  verdict,
  vote,
  voteSkipped,
  voteSkipReason,
  consensusScore,
  stoppedReason,
  showPublicDataNotice,
  t,
}: {
  verdict: Verdict
  vote: VoteResult | null
  voteSkipped: boolean
  voteSkipReason: 'none' | 'open_ended' | 'unmeasurable' | 'high_consensus'
  consensusScore: number
  stoppedReason: string
  showPublicDataNotice: boolean
  t: Ui
}) {
  const sections: { heading: string; content: string | null }[] = [
    ...(verdict.keyIssues
      ? [{ heading: t.deepKeyIssuesHeading, content: verdict.keyIssues }]
      : []),
    { heading: t.deepJudgmentHeading, content: verdict.judgment },
    { heading: t.deepBeat3Heading, content: verdict.beat3Summary },
    { heading: t.deepBeat1Heading, content: verdict.beat1Summary },
    { heading: t.deepBeat2Heading, content: verdict.beat2Summary },
    { heading: t.deepMinorityHeading, content: verdict.minorityReport },
    ...(verdict.mediaRisk
      ? [{ heading: t.deepMediaRiskHeading, content: verdict.mediaRisk }]
      : []),
    { heading: t.deepDisclaimerHeading, content: verdict.disclaimer },
  ]

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-jeju-accent/40 bg-gradient-to-b from-jeju-bg-elevated to-jeju-bg px-6 py-6 shadow-[var(--jeju-shadow)]">
      {showPublicDataNotice && <PublicDataNotice t={t} />}
      {/* Headline band */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-jeju-border pb-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-jeju-accent">
            {t.deepVerdictHeading}
          </p>
          <p className="mt-1 text-xs text-jeju-fg-muted">
            {t.deepStoppedReason(stoppedReason)}
            {verdict.provider &&
              ` · ${t.providerLabel}: ${aiProductName(verdict.provider)}`}
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
            {consensusScore >= 0 && (
              <span className="text-lg font-bold text-jeju-fg-muted">점</span>
            )}
          </span>
          <p className="mt-1 max-w-[220px] text-right text-[10px] leading-snug text-jeju-fg-muted/80">
            {t.deepConsensusExplainer}
          </p>
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

      {/* Vote tally (shown here if vote fired) */}
      {vote && vote.ok && vote.votes.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
              {t.deepVoteHeading}
            </h3>
            <span className="rounded-full border border-jeju-accent/40 bg-jeju-bg px-2 py-0.5 text-[10px] font-semibold text-jeju-accent">
              {t.deliberateVoteSeatBreakdown(
                vote.votes.filter((v) => v.provider !== 'perplexity').length,
                vote.votes.filter((v) => v.provider === 'perplexity').length,
                vote.votes.length
              )}
            </span>
          </div>
          {/* FIX 1: flex-wrap so long tally line doesn't overflow on narrow cards */}
          <p className="mb-3 flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-jeju-fg-muted">
            <span>찬성 {vote.approveCount}</span>
            <span>·</span>
            <span>조건부 찬성 {vote.conditionalCount}</span>
            <span>·</span>
            <span>기권 {vote.abstainCount}</span>
            <span>·</span>
            <span>반대 {vote.opposeCount}</span>
            <span>—</span>
            <span
              className={
                vote.outcome === 'approved'
                  ? 'text-emerald-300'
                  : vote.outcome === 'rejected'
                    ? 'text-rose-300'
                    : 'text-amber-300'
              }
            >
              {t.deepVoteOutcome(vote.outcome)}
            </span>
          </p>
          <div className="flex flex-col gap-2">
            {vote.votes.map((v, i) => (
              <div
                key={i}
                className="flex flex-wrap gap-x-2 gap-y-1 border-b border-jeju-border/50 pb-2 text-xs last:border-0"
              >
                <span className="w-32 shrink-0 font-semibold text-jeju-fg">
                  {aiProductNameWithGloss(v.provider)}
                </span>
                {/* FIX 1: whitespace-nowrap + min-w so '조건부 찬성' never clips */}
                <span
                  className={`min-w-[5rem] shrink-0 whitespace-nowrap font-bold ${
                    v.choice === 'approve'
                      ? 'text-emerald-300'
                      : v.choice === 'conditional'
                        ? 'text-sky-300'
                        : v.choice === 'oppose'
                          ? 'text-rose-300'
                          : 'text-amber-300'
                  }`}
                >
                  {v.choice === 'approve'
                    ? '찬성'
                    : v.choice === 'conditional'
                      ? '조건부 찬성'
                      : v.choice === 'oppose'
                        ? '반대'
                        : '기권'}
                </span>
                <span className="flex-1 leading-relaxed text-jeju-fg-muted">{v.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ballot-skip notice — reason-aware; never prints the runtime consensus as a target */}
      {voteSkipped && (!vote || !vote.ok || vote.votes.length === 0) && (
        <div className="rounded-lg border border-jeju-accent/25 bg-jeju-accent/8 px-4 py-3">
          <p className="text-xs text-jeju-fg-muted">
            <span className="mr-1 font-semibold text-jeju-accent">표결 생략</span>
            {voteSkipNotice(voteSkipReason)}
          </p>
        </div>
      )}
    </div>
  )
}

// ── Section (reusable body — no shell/back-link; used by page + unified) ──────

export function DeliberateSection() {
  const { t } = useJejuUi()

  const [question, setQuestion] = useState('')
  const [stage, setStage] = useState<StageKey>('idle')
  const [error, setError] = useState<string | null>(null)
  const [failedStage, setFailedStage] = useState<string | null>(null)

  // Accumulated live state
  const [debaters, setDebaters] = useState<DebaterInfo[]>([])
  const [orchestratorRoles, setOrchestratorRoles] = useState<RoleInfo[]>([])
  const [questionType, setQuestionType] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [leadAnalysis, setLeadAnalysis] = useState<string | null>(null)
  const [reportSearches, setReportSearches] = useState<ExecutedSearch[]>([])
  const [openingTurns, setOpeningTurns] = useState<DebateTurn[]>([])
  // Map roundNumber → turns (from 'turn' action, round 2+)
  const [roundTurns, setRoundTurns] = useState<Map<number, DebateTurn[]>>(new Map())
  // Map roundNumber → facilitator summary
  const [summaries, setSummaries] = useState<Map<number, FacilitatorSummary>>(new Map())
  // Flat list of per-round scores for the trajectory chart
  const [scores, setScores] = useState<RoundScore[]>([])
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [vote, setVote] = useState<VoteResult | null>(null)
  const [consensusScore, setConsensusScore] = useState(-1)
  const [stoppedReason, setStoppedReason] = useState('max_rounds')
  // true when the vote stage ran but skipped the ballot; the reason drives the notice text
  const [voteSkipped, setVoteSkipped] = useState(false)
  const [voteSkipReason, setVoteSkipReason] = useState<
    'none' | 'open_ended' | 'unmeasurable' | 'high_consensus'
  >('none')

  // ── 첨부·추가 자료 (선택) — paste + file-upload supplements ──
  // Sent once with `start`; the route persists them in session state and injects
  // them into every debater's prompt and the chair's case file.
  const [supplements, setSupplements] = useState<MotieSupplement[]>([])
  const addSupplement = useCallback((supplement: MotieSupplement) => {
    setSupplements((prev) => [...prev, supplement])
  }, [])
  const removeSupplement = useCallback((index: number) => {
    setSupplements((prev) => prev.filter((_, i) => i !== index))
  }, [])
  // Snapshot of "did THIS run have attachments" — supplements can be edited
  // after a run finishes, so the public-data notice must not read live state.
  const [ranWithAttachments, setRanWithAttachments] = useState(false)

  const runningRef = useRef(false)

  // AX COUNCIL mode — read via ref so the retry helper always sends the latest.
  const { mode: councilMode } = useMotieMode()
  const councilModeRef = useRef(councilMode)
  councilModeRef.current = councilMode

  // ── POST with retry ─────────────────────────────────────────────────────────

  const postWithRetry = useCallback(
    async (reqBody: Record<string, unknown>): Promise<DeliberateApiResult | null> => {
      const MAX_ATTEMPTS = 4
      let lastErr = ''
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const res = await fetch('/api/gunpo/deliberate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ councilMode: toJejuCouncilMode(councilModeRef.current), ...reqBody }),
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
          const data = (await res.json().catch(() => null)) as DeliberateApiResult | null
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

  // ── Main poll loop ──────────────────────────────────────────────────────────

  const runDeliberate = useCallback(
    async (overrideQ?: string) => {
      const q = (overrideQ ?? question).trim()
      if (!q || runningRef.current) return
      runningRef.current = true
      setRanWithAttachments(supplements.length > 0)

      setStage('start')
      setError(null)
      setFailedStage(null)
      setDebaters([])
      setOrchestratorRoles([])
      setQuestionType(null)
      setReport(null)
      setLeadAnalysis(null)
      setReportSearches([])
      setOpeningTurns([])
      setRoundTurns(new Map())
      setSummaries(new Map())
      setScores([])
      setVerdict(null)
      setVote(null)
      setConsensusScore(-1)
      setStoppedReason('max_rounds')
      setVoteSkipped(false)
      setVoteSkipReason('none')

      try {
        // ── start ────────────────────────────────────────────────────────────
        const startRes = await postWithRetry({
          action: 'start',
          question: q,
          ...(supplements.length > 0 ? { supplements } : {}),
        })
        if (!startRes) { runningRef.current = false; return }
        if (startRes.roles) setOrchestratorRoles(startRes.roles)
        if (startRes.debaters) setDebaters(startRes.debaters)
        if (startRes.questionType) setQuestionType(startRes.questionType)
        if (!startRes.ok) {
          stop(startRes.stage ?? 'start', startRes.error ?? '소집 실패')
          return
        }
        const sessionId = startRes.sessionId
        if (!sessionId) { stop('start', '세션 ID를 받지 못했습니다.'); return }

        // ── report ───────────────────────────────────────────────────────────
        setStage('report')
        const reportRes = await postWithRetry({ action: 'report', sessionId })
        if (!reportRes) { runningRef.current = false; return }
        if (reportRes.report != null) setReport(reportRes.report)
        if (reportRes.leadAnalysis != null) setLeadAnalysis(reportRes.leadAnalysis)
        if (reportRes.searches) setReportSearches(reportRes.searches)
        // A partial report is still usable — only hard-fail if the route returned ok:false with no content.
        if (!reportRes.ok && !reportRes.report) {
          stop(reportRes.stage ?? 'report', reportRes.reportError ?? reportRes.error ?? '리포트 생성 실패')
          return
        }

        // ── open (round 1 — parallel opening statements) ─────────────────────
        setStage('open')
        const openRes = await postWithRetry({ action: 'open', sessionId })
        if (!openRes) { runningRef.current = false; return }
        if (openRes.turns) setOpeningTurns(openRes.turns)
        if (!openRes.ok) {
          stop(openRes.stage ?? 'open', openRes.error ?? '개회 발언 실패')
          return
        }

        // ── facilitate round 1 ───────────────────────────────────────────────
        setStage('facilitate')
        const fac1Res = await postWithRetry({ action: 'facilitate', sessionId })
        if (!fac1Res) { runningRef.current = false; return }
        if (!fac1Res.ok) {
          stop(fac1Res.stage ?? 'facilitate', fac1Res.error ?? '라운드 정리 실패')
          return
        }
        if (fac1Res.summary) {
          setSummaries((prev) => new Map(prev).set(1, fac1Res.summary as FacilitatorSummary))
          if (typeof fac1Res.consensusScore === 'number') {
            setConsensusScore(fac1Res.consensusScore)
            setScores((prev) => [...prev, { roundNumber: 1, score: fac1Res.consensusScore! }])
          }
        }
        if (fac1Res.done) {
          if (fac1Res.stoppedReason) setStoppedReason(fac1Res.stoppedReason)
        }

        // ── turn/facilitate loop (rounds 2+) ─────────────────────────────────
        let loopDone = fac1Res.done === true

        while (!loopDone) {
          setStage('turn')
          const turnRes = await postWithRetry({ action: 'turn', sessionId })
          if (!turnRes) { runningRef.current = false; return }
          if (turnRes.turns && typeof turnRes.roundNumber === 'number') {
            const rn = turnRes.roundNumber
            setRoundTurns((prev) => new Map(prev).set(rn, turnRes.turns!))
          }
          if (!turnRes.ok) {
            stop(turnRes.stage ?? 'turn', turnRes.error ?? '토론 라운드 실패')
            return
          }

          setStage('facilitate')
          const facRes = await postWithRetry({ action: 'facilitate', sessionId })
          if (!facRes) { runningRef.current = false; return }
          if (!facRes.ok) {
            stop(facRes.stage ?? 'facilitate', facRes.error ?? '라운드 정리 실패')
            return
          }
          if (facRes.summary && typeof facRes.summary.roundNumber === 'number') {
            const rn = facRes.summary.roundNumber
            setSummaries((prev) => new Map(prev).set(rn, facRes.summary as FacilitatorSummary))
            if (typeof facRes.consensusScore === 'number') {
              setConsensusScore(facRes.consensusScore)
              setScores((prev) => [...prev, { roundNumber: rn, score: facRes.consensusScore! }])
            }
          }
          loopDone = facRes.done === true
          if (facRes.stoppedReason) setStoppedReason(facRes.stoppedReason)
        }

        // ── vote ─────────────────────────────────────────────────────────────
        setStage('vote')
        const voteRes = await postWithRetry({ action: 'vote', sessionId })
        if (!voteRes) { runningRef.current = false; return }
        if (voteRes.vote) setVote(voteRes.vote)
        if (voteRes.voted === false) {
          setVoteSkipped(true)
          setVoteSkipReason(voteRes.voteSkipReason ?? 'high_consensus')
        }
        if (!voteRes.ok) {
          stop(voteRes.stage ?? 'vote', voteRes.error ?? '표결 실패')
          return
        }

        // ── verdict ───────────────────────────────────────────────────────────
        setStage('verdict')
        const verdictRes = await postWithRetry({ action: 'verdict', sessionId })
        if (!verdictRes) { runningRef.current = false; return }
        if (verdictRes.verdict) setVerdict(verdictRes.verdict)
        if (verdictRes.vote && !vote) setVote(verdictRes.vote)
        if (verdictRes.deliberation?.finalScore !== undefined)
          setConsensusScore(verdictRes.deliberation.finalScore)
        if (verdictRes.deliberation?.stoppedReason)
          setStoppedReason(verdictRes.deliberation.stoppedReason)
        if (!verdictRes.ok && !verdictRes.verdict) {
          stop(verdictRes.stage ?? 'verdict', verdictRes.error ?? '판결 생성 실패')
          return
        }

        setStage('done')
      } finally {
        runningRef.current = false
      }
    },
    [question, postWithRetry, stop, vote, supplements]
  )

  // ── Derived values ──────────────────────────────────────────────────────────

  const isRunning = stage !== 'idle' && stage !== 'done' && stage !== 'error'
  const elapsed = useElapsedTimer(isRunning)
  const showProcess = stage !== 'idle'

  const bannerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (isRunning) {
      bannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isRunning])

  // All debate rounds in order (opening = round 1 via openingTurns, subsequent via roundTurns map)
  const allRoundNumbers = Array.from(
    new Set([
      ...(openingTurns.length > 0 ? [1] : []),
      ...Array.from(roundTurns.keys()),
    ])
  ).sort((a, b) => a - b)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <GunpoPanelNotice t={t} />

      {/* Input */}
      <div className="mb-6 flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
          찬반 안건 입력
        </p>
        <p className="text-[11px] leading-relaxed text-jeju-fg-muted">{t.deliberateQuestionHelper}</p>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t.deliberateQuestionPlaceholderWarroom}
          disabled={isRunning}
          rows={3}
          className="w-full resize-y rounded-xl border border-jeju-border bg-jeju-bg px-4 py-3 text-base text-jeju-fg placeholder:text-jeju-fg-muted focus:border-jeju-accent focus:outline-none focus:ring-1 focus:ring-jeju-accent disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3">
          {questionType && (
            <span className="rounded-full bg-jeju-tile-bg px-3 py-1 text-xs font-semibold text-jeju-fg-muted">
              {questionType === 'binary' ? '찬반형 (표결 가능)' : '개방형'}
            </span>
          )}
          <div className="ml-auto">
            <button
              type="button"
              disabled={isRunning || !question.trim()}
              onClick={() => runDeliberate()}
              className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-xl bg-jeju-accent px-6 py-2.5 text-sm font-bold text-black shadow-[var(--jeju-shadow)] transition hover:opacity-90 disabled:opacity-40"
            >
              <PlayCircle
                className={`h-4 w-4 ${isRunning ? 'animate-pulse' : ''}`}
                aria-hidden
              />
              {t.deliberateStartBtn}
            </button>
          </div>
        </div>
      </div>

      {/* 첨부·추가 자료 (선택) — same card + same /api/gunpo/extract path as 개방형 */}
      <div className="mb-6">
        <Section
          title="첨부·추가 자료 (선택)"
          badge={
            supplements.length > 0 ? (
              <span className="rounded-md bg-jeju-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-jeju-accent">
                {supplements.length}
              </span>
            ) : undefined
          }
          defaultOpen
          t={t}
        >
          <SupplementCard
            supplements={supplements}
            onAdd={addSupplement}
            onRemove={removeSupplement}
            disabled={isRunning}
          />
        </Section>
      </div>

      {/* Running banner — prominent status while engine works */}
      {isRunning && <DeliberateRunningBanner stage={stage} elapsed={elapsed} t={t} bannerRef={bannerRef} />}

      {/* Progress strip */}
      {showProcess && (
        <div className="mb-6 rounded-xl border border-jeju-border bg-jeju-bg-elevated px-5 py-4">
          <ProgressStrip stage={stage} t={t} />
          {isRunning && (
            <p className="mt-3 text-xs leading-relaxed text-jeju-fg-muted">
              {t.deliberateRunningHint(debaters.length, debaters.length + 1)}
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {stage === 'error' && error && (
        <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-300">
          <span className="font-semibold">
            {t.errorHeading}
            {failedStage ? ` (${failedStage})` : ''}:
          </span>{' '}
          {error}
        </div>
      )}

      {/* ── PINNED VERDICT (executives see the answer first) ─── */}
      {verdict && (
        <div className="mb-8">
          <VerdictBlock
            verdict={verdict}
            vote={vote}
            voteSkipped={voteSkipped}
            voteSkipReason={voteSkipReason}
            consensusScore={consensusScore}
            stoppedReason={stoppedReason}
            showPublicDataNotice={!ranWithAttachments}
            t={t}
          />
        </div>
      )}

      {/* ── LIVE PROCESS (accumulates as each stage completes) ─── */}
      {showProcess && (
        <div className="flex flex-col gap-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-jeju-fg-muted">
            {t.deepProcessHeading}
          </h2>

          {/* 1. Orchestrator roster (the JEJU analytic seats convened for context,
               not the debaters — makes the context transparent) */}
          {orchestratorRoles.length > 0 && (
            <Section title="분석 소집 (컨텍스트)" defaultOpen={false} t={t}>
              <div className="flex flex-col gap-3">
                {orchestratorRoles.map((r) => (
                  <div
                    key={r.roleId}
                    className="border-b border-jeju-border/40 pb-2 last:border-0"
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-jeju-fg">{r.roleLabel}</span>
                      {r.provider && <BrandChip name={aiProductNameWithGloss(r.provider)} />}
                      {r.isRedTeam && <RedTeamBadge t={t} />}
                    </div>
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

          {/* 2. Debater roster (7 reasoning brands) + Perplexity search specialist */}
          {debaters.length > 0 && (
            <Section title={t.deliberateRosterHeading} defaultOpen={false} t={t}>
              <div className="flex flex-wrap gap-2">
                {debaters.map((d) => (
                  <span
                    key={d.provider}
                    className="flex items-center gap-1.5 rounded-full border border-jeju-border bg-jeju-tile-bg px-3 py-1 text-xs font-semibold text-jeju-fg"
                  >
                    <MessageSquare className="h-3 w-3 text-jeju-accent" aria-hidden />
                    {aiProductNameWithGloss(d.provider)}
                  </span>
                ))}
              </div>
              {/* Perplexity surfaced as the search/press specialist — a professional
                  function for the whole panel, not an absence from debate. */}
              <div className="mt-4 flex items-start gap-2 rounded-xl border border-jeju-accent/30 bg-jeju-bg px-4 py-3">
                <Search className="mt-0.5 h-4 w-4 shrink-0 text-jeju-accent" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-jeju-fg">{t.deliberateSearchSpecialist}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-jeju-fg-muted">
                    {t.deliberateSearchSpecialistDesc}
                  </p>
                </div>
              </div>
            </Section>
          )}

          {/* 3. Pre-debate report (with data provenance / search citations) */}
          {report && (
            <Section title={t.deliberateReportHeading} t={t}>
              <div className="flex flex-col gap-4">
                {/* The report itself — provenance citations are inline in the text */}
                <div>
                  <Prose text={report} />
                </div>
                {/* Lead analysis (transparency) */}
                {leadAnalysis && (
                  <details className="rounded-xl border border-jeju-border bg-jeju-bg">
                    <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold text-jeju-fg-muted">
                      {t.deliberateLeadAnalysisHeading}
                    </summary>
                    <div className="border-t border-jeju-border px-4 py-3">
                      <Prose text={leadAnalysis} />
                    </div>
                  </details>
                )}
                {/* Searches used (show query + result so provenance source is clear) */}
                {reportSearches.length > 0 && (
                  <details className="rounded-xl border border-jeju-border bg-jeju-bg">
                    <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold text-jeju-fg-muted">
                      {t.deliberateSearchesUsedHeading} ({reportSearches.filter((s) => s.ok).length}/{reportSearches.length})
                    </summary>
                    <div className="flex flex-col gap-3 border-t border-jeju-border px-4 py-3">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-jeju-accent">
                        <Search className="h-3 w-3" aria-hidden />
                        {t.deliberateSearchByline}
                      </p>
                      {reportSearches.map((s, i) => (
                        <div key={i} className="border-b border-jeju-border/40 pb-3 last:border-0">
                          <p className="mb-1 text-sm font-semibold text-jeju-fg">
                            {t.deepEvidenceQueryLabel}: {s.query}
                          </p>
                          <Prose text={s.ok ? s.result : (s.error ?? '검색 실패')} />
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </Section>
          )}

          {/* 4. Consensus trajectory (round-by-round scores with labels + bars) */}
          {scores.length > 0 && (
            <Section title={t.deliberateConsensusProgressionHeading} t={t}>
              <ConsensusTrajectory scores={scores} t={t} />
            </Section>
          )}

          {/* 5. Debate rounds (opening + subsequent turns, each in an accordion) */}
          {allRoundNumbers.length > 0 && (
            <Section title={t.deliberateDebateHeading} t={t}>
              <div className="flex flex-col gap-3">
                {allRoundNumbers.map((rn) => {
                  const turns = rn === 1 ? openingTurns : (roundTurns.get(rn) ?? [])
                  const summary = summaries.get(rn)
                  return (
                    <RoundAccordion
                      key={rn}
                      roundNumber={rn}
                      turns={turns}
                      summary={summary}
                      t={t}
                    />
                  )
                })}
              </div>
            </Section>
          )}

          {/* 6. Vote detail (if the motion vote fired) */}
          {vote && vote.ok && vote.votes.length > 0 && (
            <Section title={t.deepVoteHeading} t={t}>
              <p className="mb-2">
                <span className="rounded-full border border-jeju-accent/40 bg-jeju-bg px-2 py-0.5 text-[10px] font-semibold text-jeju-accent">
                  {t.deliberateVoteSeatBreakdown(
                    vote.votes.filter((v) => v.provider !== 'perplexity').length,
                    vote.votes.filter((v) => v.provider === 'perplexity').length,
                    vote.votes.length
                  )}
                </span>
              </p>
              {/* FIX 1: flex-wrap so long tally line doesn't overflow on narrow cards */}
              <p className="mb-3 flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs text-jeju-fg-muted">
                <span>찬성 {vote.approveCount}</span>
                <span>·</span>
                <span>조건부 찬성 {vote.conditionalCount}</span>
                <span>·</span>
                <span>기권 {vote.abstainCount}</span>
                <span>·</span>
                <span>반대 {vote.opposeCount}</span>
                <span>—</span>
                <span
                  className={
                    vote.outcome === 'approved'
                      ? 'text-emerald-300'
                      : vote.outcome === 'rejected'
                        ? 'text-rose-300'
                        : 'text-amber-300'
                  }
                >
                  {t.deepVoteOutcome(vote.outcome)}
                </span>
              </p>
              <div className="flex flex-col gap-2">
                {vote.votes.map((v, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap gap-x-2 gap-y-1 border-b border-jeju-border/50 pb-2 text-xs last:border-0"
                  >
                    <span className="w-32 shrink-0 font-semibold text-jeju-fg">
                      {aiProductNameWithGloss(v.provider)}
                    </span>
                    {/* FIX 1: whitespace-nowrap + min-w so '조건부 찬성' never clips */}
                    <span
                      className={`min-w-[5rem] shrink-0 whitespace-nowrap font-bold ${
                        v.choice === 'approve'
                          ? 'text-emerald-300'
                          : v.choice === 'conditional'
                            ? 'text-sky-300'
                            : v.choice === 'oppose'
                              ? 'text-rose-300'
                              : 'text-amber-300'
                      }`}
                    >
                      {v.choice === 'approve'
                        ? '찬성'
                        : v.choice === 'conditional'
                          ? '조건부 찬성'
                          : v.choice === 'oppose'
                            ? '반대'
                            : '기권'}
                    </span>
                    <span className="flex-1 leading-relaxed text-jeju-fg-muted">
                      {v.reason}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* FIX 2: show skip notice when ballot was skipped (e.g. high consensus) */}
          {voteSkipped && (!vote || !vote.ok || vote.votes.length === 0) && (
            <Section title={t.deepVoteHeading} t={t}>
              <div className="rounded-lg border border-jeju-accent/25 bg-jeju-accent/8 px-4 py-3">
                <p className="text-xs text-jeju-fg-muted">
                  <span className="mr-1 font-semibold text-jeju-accent">표결 생략</span>
                  {voteSkipNotice(voteSkipReason)}
                </p>
              </div>
            </Section>
          )}
        </div>
      )}
    </>
  )
}

// ── Main page (standalone route — wraps the section in its own shell) ─────────

export default function JejuGovernanceDeliberatePage() {
  const { t } = useJejuUi()

  return (
    <JejuThemeShell
      theme="governance"
      title={t.deliberateTitle}
      tagline={t.deliberateDesc}
      backHref="/motie/governance"
      backLabel={t.backToGovernance}
    >
      <DeliberateSection />
    </JejuThemeShell>
  )
}
