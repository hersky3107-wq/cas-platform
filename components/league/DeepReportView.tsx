import type { ReactNode } from 'react'
import type { SourceTier } from '@/lib/league/deep-report-dossier'
import type {
  DeepReportEvidence,
  DeepReportPoint,
  DeepReportSeat,
  DeepReportSide,
  DeepReportSnapshot,
} from '@/lib/league/deep-snapshot'
import { deepReportCopy, type DeepReportCopy, type DeepReportStep } from '@/lib/league/i18n/deep-report-copy'
import type { LeagueLocale } from '@/lib/league/i18n/locales'

export const DEEP_REPORT_STEPS: readonly DeepReportStep[] = ['research', 'opening', 'rebuttal', 'counter', 'chair']

/** Server stage ids → the 4 plain-language steps. */
export function reportStepIndex(stage: string | null): number {
  if (stage === 'done') return DEEP_REPORT_STEPS.length
  if (!stage || stage === 'start' || stage === 'seed_retry') return 0
  const index = DEEP_REPORT_STEPS.indexOf(stage as DeepReportStep)
  return index === -1 ? 0 : index
}

export function reportStepLabel(stage: string | null, copy: DeepReportCopy): string {
  const index = Math.min(reportStepIndex(stage), DEEP_REPORT_STEPS.length - 1)
  return copy.steps[DEEP_REPORT_STEPS[index]!]
}

function sideWord(snap: DeepReportSnapshot, side: DeepReportSide): string {
  return side === 'yes' ? snap.sideWords.yes : snap.sideWords.no
}

// ── Progress ──────────────────────────────────────────────────────────────────

export function DeepReportProgress({
  snap,
  stage,
  running,
  locale,
}: {
  snap: DeepReportSnapshot
  stage: string | null
  running: boolean
  locale: LeagueLocale
}) {
  const copy = deepReportCopy(locale)
  const active = reportStepIndex(stage ?? snap.stage)
  const counter = (step: DeepReportStep): string | null => {
    if (step === 'research') return snap.progress.sourcesFound > 0 ? copy.sourcesFound(snap.progress.sourcesFound) : null
    if (step === 'opening') return copy.debatersDone(snap.progress.openingsDone, snap.progress.debaters)
    if (step === 'rebuttal') return copy.debatersDone(snap.progress.rebuttalsDone, snap.progress.debaters)
    if (step === 'counter') return copy.debatersDone(snap.progress.countersDone, snap.progress.debaters)
    return null
  }
  return (
    <ol className="mt-3 flex flex-wrap items-center gap-1.5" data-testid="deep-stage-strip">
      {DEEP_REPORT_STEPS.map((step, i) => {
        const isDone = active > i
        const isActive = running && active === i
        const count = isDone || isActive ? counter(step) : null
        return (
          <li
            key={step}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              isDone
                ? 'bg-emerald-100 text-emerald-800'
                : isActive
                  ? 'bg-slate-800 text-white shadow-sm ring-2 ring-emerald-400/70'
                  : 'bg-slate-100 text-slate-500'
            }`}
            data-active={isActive ? 'true' : undefined}
          >
            {isDone ? <span aria-hidden>✓</span> : null}
            <span>{copy.steps[step]}</span>
            {count ? <span className="font-normal opacity-80">· {count}</span> : null}
          </li>
        )
      })}
    </ol>
  )
}

// ── Report body ───────────────────────────────────────────────────────────────

export function DeepReportView({
  snap,
  locale,
  running = false,
}: {
  snap: DeepReportSnapshot
  locale: LeagueLocale
  running?: boolean
}) {
  const copy = deepReportCopy(locale)
  const showVote = snap.vote && (snap.stage === 'chair' || snap.stage === 'done')
  return (
    <div className="mt-4 flex flex-col gap-4 text-league-fg" data-testid="deep-report-process">
      {snap.verdict ? <VerdictCard snap={snap} copy={copy} /> : null}
      {showVote ? <VoteBlock snap={snap} copy={copy} /> : null}
      {snap.keyEvidence.length > 0 ? (
        <Block heading={copy.evidenceHeading} testId="deep-report-evidence">
          <ul className="space-y-2">
            {snap.keyEvidence.map((row, i) => (
              <EvidenceRow key={`${row.ref ?? 'k'}-${i}`} row={row} copy={copy} />
            ))}
          </ul>
        </Block>
      ) : null}
      {snap.threads.length > 0 ? (
        <DebateThreads snap={snap} copy={copy} />
      ) : snap.seats.some((seat) => seat.headline) ? (
        <Highlights snap={snap} copy={copy} running={running} />
      ) : null}
      {snap.judgment.length > 0 ? (
        <Block heading={copy.judgmentHeading} testId="deep-report-judgment">
          <ul className="space-y-1.5">
            {snap.judgment.map((line, i) => (
              <li key={i} className="text-[13px] leading-relaxed">
                {line}
              </li>
            ))}
          </ul>
          {snap.minorityView ? (
            <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] leading-relaxed text-league-fg-muted">
              <span className="font-semibold">{copy.minorityHeading}</span> · {snap.minorityView}
            </p>
          ) : null}
        </Block>
      ) : null}
      {snap.flipTriggers.length > 0 ? (
        <Block heading={copy.flipHeading} testId="deep-report-flip">
          <ul className="space-y-1.5">
            {snap.flipTriggers.map((row, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[13px] leading-relaxed">
                <span>{row.event}</span>
                {row.byDate ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                    {copy.byDate(row.byDate)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {snap.scenarios.length > 0 ? (
            <p className="mt-2 text-[12px] text-league-fg-muted">
              <span className="font-semibold">{copy.scenariosHeading}</span> ·{' '}
              {snap.scenarios.map((row) => `${row.name} ${row.weight}%`).join(' · ')}
            </p>
          ) : null}
        </Block>
      ) : null}
      {snap.dossier.length > 0 ? <Dossier snap={snap} copy={copy} /> : null}
      {snap.legacyText ? (
        <div className="whitespace-pre-wrap rounded-xl bg-white p-3 text-[13px] leading-relaxed" data-testid="deep-report-legacy">
          {snap.legacyText}
        </div>
      ) : null}
    </div>
  )
}

function Block({ heading, testId, children }: { heading: string; testId: string; children: ReactNode }) {
  return (
    <section data-testid={testId}>
      <h4 className="text-[12px] font-bold tracking-wide text-league-fg-muted">{heading}</h4>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

function VerdictCard({ snap, copy }: { snap: DeepReportSnapshot; copy: DeepReportCopy }) {
  const v = snap.verdict!
  return (
    <section className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm" data-testid="deep-report-verdict">
      <p className="text-[11px] font-bold tracking-wide text-league-fg-muted">{copy.verdictHeading}</p>
      <p className="mt-1 text-3xl font-black tracking-tight" data-testid="deep-report-verdict-line">
        {sideWord(snap, v.side)} · <span className="tabular-nums">{v.probability}%</span>
      </p>
      {v.oneLine ? <p className="mt-2 text-[14px] leading-relaxed">{v.oneLine}</p> : null}
      {v.relation && v.ai40 ? (
        <p className="mt-2 text-[12px] leading-relaxed text-league-fg-muted" data-testid="deep-report-relation">
          {copy.relation[v.relation](sideWord(snap, v.ai40.side), v.ai40.confidence)}
          {v.why ? ` — ${v.why}` : ''}
        </p>
      ) : null}
    </section>
  )
}

const SIDE_TONE: Record<DeepReportSide, string> = {
  yes: 'border-sky-400 bg-sky-50 text-sky-900',
  no: 'border-rose-400 bg-rose-50 text-rose-900',
}

function VoteBlock({ snap, copy }: { snap: DeepReportSnapshot; copy: DeepReportCopy }) {
  const vote = snap.vote!
  const tallyLine = vote.majority
    ? copy.tally(vote.total, vote.majorityCount, sideWord(snap, vote.majority))
    : copy.tallyTie(vote.total, vote.yes, snap.sideWords.yes, vote.no, snap.sideWords.no)
  const changed = snap.seats.filter((seat) => seat.changedMind)
  return (
    <Block heading={copy.voteHeading} testId="deep-report-vote">
      <p className="text-[15px] font-bold" data-testid="deep-report-tally">
        {tallyLine}
      </p>
      <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {snap.seats.map((seat) => (
          <li key={seat.provider} className="flex flex-col items-center gap-1 text-center" data-testid="deep-report-voter">
            <span
              className={`inline-flex h-10 w-10 items-center justify-center rounded-full border-2 text-[14px] font-black ${
                seat.finalSide ? SIDE_TONE[seat.finalSide] : 'border-slate-300 bg-slate-50 text-slate-500'
              } ${seat.changedMind ? 'ring-2 ring-amber-400 ring-offset-1' : ''}`}
              aria-hidden
            >
              {seat.brand.slice(0, 1)}
            </span>
            <span className="text-[11px] font-semibold">{seat.brand}</span>
            <span className="text-[11px] text-league-fg-muted">
              {seat.finalSide && seat.finalProbability != null
                ? `${sideWord(snap, seat.finalSide)} ${seat.finalProbability}%`
                : copy.noFinal}
            </span>
          </li>
        ))}
      </ul>
      {changed.length > 0 ? (
        <div className="mt-3 space-y-1.5" data-testid="deep-report-changed">
          {changed.map((seat) => (
            <p key={seat.provider} className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] leading-relaxed text-amber-950">
              <span className="mr-1.5 rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-bold text-amber-950">{copy.changedBadge}</span>
              <span className="font-semibold">{seat.brand}</span>{' '}
              {copy.changedFromTo(sideWord(snap, seat.assignedSide), sideWord(snap, seat.finalSide!))}
              {seat.whyChanged ? ` — ${seat.whyChanged}` : ''}
            </p>
          ))}
        </div>
      ) : null}
    </Block>
  )
}

function TierIcon({ tier }: { tier: SourceTier }) {
  const paths: Record<SourceTier, string> = {
    official: 'M2 6l6-4 6 4v1H2V6zm1 2h2v5H3V8zm4 0h2v5H7V8zm4 0h2v5h-2V8zM2 14h12v1H2v-1z',
    regulator: 'M8 1v2M3 4h10M4 4l-2 5a2 2 0 004 0L4 4zm8 0l-2 5a2 2 0 004 0l-2-5zM8 3v11M5 14h6',
    major_outlet: 'M2 3h10v10H3a1 1 0 01-1-1V3zm10 3h2v6a1 1 0 01-2 0V6zM4 5h6v2H4V5zm0 4h6v1H4V9zm0 2h4v1H4v-1z',
    rumor: 'M2 3h12v8H7l-3 3v-3H2V3z',
    other: 'M7 9l2-2M6 5l1-1a2.5 2.5 0 013.5 3.5l-1 1M10 11l-1 1a2.5 2.5 0 01-3.5-3.5l1-1',
  }
  const stroke = tier === 'regulator' || tier === 'other'
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden>
      <path
        d={paths[tier]}
        fill={stroke ? 'none' : 'currentColor'}
        stroke={stroke ? 'currentColor' : 'none'}
        strokeWidth={stroke ? 1.4 : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function EvidenceMeta({ row, copy }: { row: DeepReportEvidence; copy: DeepReportCopy }) {
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-league-fg-muted">
      <span className="tabular-nums">{row.date ?? copy.undated}</span>
      <span className="inline-flex items-center gap-1" data-tier={row.tier}>
        <TierIcon tier={row.tier} />
        {copy.tier[row.tier]}
      </span>
      {row.source ? <span>{row.source}</span> : null}
      {row.agreement >= 2 ? <span>{copy.agreement(row.agreement)}</span> : null}
      {row.url ? (
        <a href={row.url} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-league-accent-strong underline-offset-2 hover:underline">
          {copy.openLink} ↗
        </a>
      ) : null}
    </p>
  )
}

function EvidenceRow({ row, copy }: { row: DeepReportEvidence; copy: DeepReportCopy }) {
  return (
    <li className="rounded-lg border border-league-border/50 bg-league-bg-elevated/40 px-3 py-2">
      <p className="text-[13px] leading-relaxed">{row.claim}</p>
      <EvidenceMeta row={row} copy={copy} />
    </li>
  )
}

function PointLine({ label, point }: { label: string; point: DeepReportPoint }) {
  return (
    <p className="mt-1 text-[12px] leading-relaxed">
      <span className="font-semibold text-league-fg-muted">{label}</span> · {point.text}
      {point.source ? <span className="text-league-fg-muted"> ({point.source})</span> : null}
    </p>
  )
}

function Avatar({ brand }: { brand: string }) {
  return (
    <span
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white"
      aria-hidden
    >
      {brand.slice(0, 1)}
    </span>
  )
}

function Bubble({
  brand,
  label,
  text,
  badge,
}: {
  brand: string
  label: string
  text: string
  badge?: string | null
}) {
  return (
    <div className="flex items-start gap-2" data-testid="deep-report-bubble">
      <Avatar brand={brand} />
      <div className="min-w-0 rounded-2xl bg-league-bg-elevated px-3 py-2">
        <p className="text-[11px] font-semibold text-league-fg">
          {brand}
          <span className="ms-1 font-normal text-league-fg-muted">{label}</span>
          {badge ? (
            <span className="ms-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900" data-testid="deep-report-stance">
              {badge}
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[13px] leading-relaxed">{text}</p>
      </div>
    </div>
  )
}

function DebateThreads({ snap, copy }: { snap: DeepReportSnapshot; copy: DeepReportCopy }) {
  return (
    <Block heading={copy.debateHeading} testId="deep-report-threads">
      {snap.concessions.length > 0 ? (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2" data-testid="deep-report-conceded">
          <p className="text-[12px] font-bold text-amber-950">{copy.concededHeading}</p>
          <ul className="mt-1 space-y-1">
            {snap.concessions.map((row, i) => (
              <li key={`${row.brand}-${i}`} className="text-[13px] leading-relaxed text-amber-950">
                <span className="font-semibold">{row.brand}</span> · {row.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-4">
        {snap.threads.map((thread) => (
          <article key={thread.id} className="space-y-2 rounded-lg border border-league-border/50 bg-league-bg-elevated/40 px-3 py-2.5" data-testid="deep-report-thread">
            {thread.exchanges.map((exchange, i) => (
              <div key={`${exchange.claimBrand}-${i}`} className="space-y-1.5" data-testid="deep-report-exchange">
                <Bubble brand={exchange.claimBrand} label={copy.openingRound} text={exchange.claimText} />
                <Bubble
                  brand={exchange.rebuttalBrand}
                  label={copy.rebuttalRound}
                  text={`${copy.rebuttalAbout(exchange.claimBrand, exchange.quote)} ${exchange.rebuttalText}`}
                />
                {exchange.replyText && exchange.replyBrand && exchange.stance ? (
                  <Bubble
                    brand={exchange.replyBrand}
                    label={copy.counterRound}
                    text={exchange.replyText}
                    badge={copy.stanceBadge[exchange.stance]}
                  />
                ) : null}
              </div>
            ))}
            {thread.openings.some((row) => row.headline || row.points.length > 0) ? (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] font-semibold text-league-fg-muted">{copy.fullTurns}</summary>
                <div className="mt-1.5 space-y-2 border-s-2 border-league-border/60 ps-3">
                  {thread.openings.map((opening) => (
                    <div key={opening.brand}>
                      <p className="text-[11px] font-bold text-league-fg-muted">
                        {opening.brand} · {copy.openingRound}
                      </p>
                      {opening.headline ? <p className="text-[12px] font-semibold">{opening.headline}</p> : null}
                      <ul className="mt-0.5 list-disc space-y-0.5 ps-4 text-[12px] leading-relaxed">
                        {opening.points.map((point, i) => (
                          <li key={i}>{point.text}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}
          </article>
        ))}
      </div>
    </Block>
  )
}

function SeatHighlight({ snap, seat, copy }: { snap: DeepReportSnapshot; seat: DeepReportSeat; copy: DeepReportCopy }) {
  return (
    <article className="rounded-lg border border-league-border/50 bg-league-bg-elevated/40 px-3 py-2.5" data-testid="deep-report-seat">
      <p className="text-[12px] text-league-fg-muted">
        <span className="font-semibold text-league-fg">{seat.brand}</span> · {copy.assigned(sideWord(snap, seat.assignedSide))}
      </p>
      {seat.headline ? <p className="mt-1 text-[14px] font-bold leading-snug">{seat.headline}</p> : null}
      {seat.strongestPoint ? <PointLine label={copy.strongestPoint} point={seat.strongestPoint} /> : null}
      {seat.rebuttalLine ? <PointLine label={copy.rebuttalLabel} point={seat.rebuttalLine} /> : null}
      {seat.opening || seat.rebuttal ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-league-fg-muted">{copy.fullTurns}</summary>
          <div className="mt-1.5 space-y-2 border-s-2 border-league-border/60 ps-3">
            {seat.opening ? (
              <div>
                <p className="text-[11px] font-bold text-league-fg-muted">{copy.openingRound}</p>
                {seat.opening.headline ? <p className="text-[12px] font-semibold">{seat.opening.headline}</p> : null}
                <ul className="mt-0.5 list-disc space-y-0.5 ps-4 text-[12px] leading-relaxed">
                  {seat.opening.points.map((point, i) => (
                    <li key={i}>
                      {point.text}
                      {point.source ? <span className="text-league-fg-muted"> ({point.source})</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {seat.rebuttal ? (
              <div>
                <p className="text-[11px] font-bold text-league-fg-muted">{copy.rebuttalRound}</p>
                {seat.rebuttal.headline ? <p className="text-[12px] font-semibold">{seat.rebuttal.headline}</p> : null}
                <ul className="mt-0.5 list-disc space-y-0.5 ps-4 text-[12px] leading-relaxed">
                  {[...seat.rebuttal.rebuttal, ...seat.rebuttal.points].map((point, i) => (
                    <li key={i}>
                      {point.text}
                      {point.source ? <span className="text-league-fg-muted"> ({point.source})</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </article>
  )
}

function Highlights({ snap, copy, running }: { snap: DeepReportSnapshot; copy: DeepReportCopy; running: boolean }) {
  return (
    <Block heading={copy.highlightsHeading} testId="deep-report-highlights">
      <div className="space-y-2.5">
        {snap.seats
          .filter((seat) => seat.headline || running)
          .map((seat) =>
            seat.headline ? (
              <SeatHighlight key={seat.provider} snap={snap} seat={seat} copy={copy} />
            ) : (
              <p key={seat.provider} className="text-[12px] text-league-fg-muted">
                {seat.brand} · {copy.waiting}
              </p>
            ),
          )}
      </div>
    </Block>
  )
}

function Dossier({ snap, copy }: { snap: DeepReportSnapshot; copy: DeepReportCopy }) {
  const titles = copy.sections(snap.sideWords)
  const total = snap.dossier.reduce((sum, section) => sum + section.items.length, 0)
  return (
    <details className="rounded-lg border border-league-border/50 bg-league-bg-elevated/30" data-testid="deep-report-dossier">
      <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-league-fg-muted">{copy.dossierHeading(total)}</summary>
      <div className="space-y-3 border-t border-league-border/40 px-3 py-2">
        {snap.researchPath === 'standard_fallback' ? <p className="text-[11px] text-league-fg-muted">{copy.fallbackNote}</p> : null}
        {snap.dossier.map((section) => (
          <section key={section.key}>
            <h5 className="text-[12px] font-bold">{titles[section.key]}</h5>
            <ul className="mt-1 space-y-1.5">
              {section.items.map((row, i) => (
                <li key={`${row.ref ?? 'd'}-${i}`} className="text-[12px] leading-relaxed">
                  {row.claim}
                  <EvidenceMeta row={row} copy={copy} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  )
}
