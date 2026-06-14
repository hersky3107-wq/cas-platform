import type { Metadata } from 'next'
import Link from 'next/link'
import { parseCompareResponses } from '@/lib/compare/session-types'
import { parsePersonaResponses } from '@/lib/persona/session-types'
import { parseCustomResponses } from '@/lib/custom/session-types'
import { parsePanelResponses } from '@/lib/panel/session-types'
import { parseDeepResponses } from '@/lib/deep/session-types'
import { parseComedyResponses } from '@/lib/comedy/session-types'
import { parseTaleResponses } from '@/lib/tale/session-types'
import { parseOracleResponses } from '@/lib/oracle/session-types'
import { parseSuitResponses } from '@/lib/suit/session-types'
import {
  parseArenaShareRoundRows,
  type ArenaShareRoundRow,
} from '@/lib/arena/session-types'
import { PUBLIC_SHARE_BASE } from '@/lib/compare/session-types'
import { BRAND, isSynodProvider } from '@/lib/synod/debaters'
import {
  assembleSynodSession,
  type SynodLoadRound,
  type SynodLoadTurn,
  type SynodResult,
} from '@/lib/synod/share-load'
import { supabaseAdmin } from '@/lib/supabase/server'

type PageProps = {
  params: Promise<{ share_id: string }>
}

type ShareSession = {
  kind:
    | 'compare'
    | 'persona'
    | 'custom'
    | 'panel'
    | 'deep'
    | 'comedy'
    | 'tale'
    | 'oracle'
    | 'suit'
    | 'arena'
    | 'synod'
  question: string
  responses: { ai_name: string; content: string | null }[]
  voted_ai: string | null
  is_public: boolean
  panel_type?: string
  deep_type?: string
  comedy_type?: string
  oracle_type?: string
  turn_number?: number
  arena_rounds?: ArenaShareRoundRow[]
  synod_turns?: SynodLoadTurn[]
  synod_rounds?: SynodLoadRound[]
  synod_result?: SynodResult | null
  consensus_score?: number | null
}

function groupArenaRoundsByNumber(rows: ArenaShareRoundRow[]): [number, ArenaShareRoundRow[]][] {
  const byRound = new Map<number, ArenaShareRoundRow[]>()
  for (const row of rows) {
    const list = byRound.get(row.round_number) ?? []
    list.push(row)
    byRound.set(row.round_number, list)
  }
  return [...byRound.entries()].sort((a, b) => a[0] - b[0])
}

function groupSynodTurnsByNumber(turns: SynodLoadTurn[]): [number, SynodLoadTurn[]][] {
  const byRound = new Map<number, SynodLoadTurn[]>()
  for (const turn of turns) {
    const list = byRound.get(turn.roundNumber) ?? []
    list.push(turn)
    byRound.set(turn.roundNumber, list)
  }
  return [...byRound.entries()].sort((a, b) => a[0] - b[0])
}

function synodBrandName(providerKey: string): string {
  return isSynodProvider(providerKey) ? BRAND[providerKey] : providerKey
}

function synodRoundLabel(roundNumber: number): string {
  return roundNumber === 0 ? 'Opening' : `Round ${roundNumber}`
}

async function loadFromCompare(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('compare_sessions')
    .select('question, responses, voted_ai, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] compare_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'compare',
    question: data.question,
    responses: parseCompareResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromPersona(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('persona_sessions')
    .select('question, responses, voted_ai, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] persona_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'persona',
    question: data.question,
    responses: parsePersonaResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromCustom(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('custom_sessions')
    .select('question, responses, voted_ai, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] custom_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'custom',
    question: data.question,
    responses: parseCustomResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromPanel(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('panel_sessions')
    .select('panel_type, question, responses, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] panel_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'panel',
    panel_type: typeof data.panel_type === 'string' ? data.panel_type : '',
    question: data.question,
    responses: parsePanelResponses(data.responses),
    voted_ai: null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromDeep(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('deep_sessions')
    .select('deep_type, question, responses, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] deep_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'deep',
    deep_type: typeof data.deep_type === 'string' ? data.deep_type : '',
    question: data.question,
    responses: parseDeepResponses(data.responses),
    voted_ai: null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromComedy(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('comedy_sessions')
    .select('comedy_type, question, responses, voted_ai, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] comedy_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'comedy',
    comedy_type: typeof data.comedy_type === 'string' ? data.comedy_type : '',
    question: data.question,
    responses: parseComedyResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromTale(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('tale_sessions')
    .select('question, responses, voted_ai, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] tale_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'tale',
    question: data.question,
    responses: parseTaleResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromOracle(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('oracle_sessions')
    .select('oracle_type, question, responses, voted_ai, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] oracle_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'oracle',
    oracle_type: typeof data.oracle_type === 'string' ? data.oracle_type : '',
    question: data.question,
    responses: parseOracleResponses(data.responses),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromSuit(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('suit_sessions')
    .select('question, responses, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] suit_sessions lookup:', error.message)
    return null
  }

  return {
    kind: 'suit',
    question: data.question,
    responses: parseSuitResponses(data.responses),
    voted_ai: null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromArena(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('arena_sessions')
    .select('topic, turn_number, rounds, is_public')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] arena_sessions lookup:', error.message)
    return null
  }

  const arena_rounds = parseArenaShareRoundRows(data.rounds)
  const turn_number =
    typeof data.turn_number === 'number' && Number.isFinite(data.turn_number)
      ? data.turn_number
      : 1

  return {
    kind: 'arena',
    question: data.topic,
    turn_number,
    arena_rounds,
    responses: arena_rounds.map((r) => ({ ai_name: r.ai_name, content: r.content })),
    voted_ai: null,
    is_public: Boolean(data.is_public),
  }
}

async function loadFromSynod(shareId: string): Promise<ShareSession | null> {
  const { data, error } = await supabaseAdmin
    .from('synod_sessions')
    .select('session_id, question, consensus_score, voted_ai, is_public, share_id')
    .eq('share_id', shareId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[share] synod_sessions lookup:', error.message)
    return null
  }

  const sessionId = String(data.session_id)

  const [turnsRes, roundsRes, resultRes] = await Promise.all([
    supabaseAdmin
      .from('synod_turns')
      .select('round_number, ai_name, action_tag, claim, content, is_red_team, ms, created_at')
      .eq('session_id', sessionId)
      .order('round_number', { ascending: true })
      .order('created_at', { ascending: true }),
    supabaseAdmin
      .from('synod_rounds')
      .select(
        'round_number, consensus_points, open_issues, round_consensus_score, next_directive, challenge_missing'
      )
      .eq('session_id', sessionId)
      .order('round_number', { ascending: true }),
    supabaseAdmin
      .from('synod_session_results')
      .select('verdict, minority_report, final_score')
      .eq('session_id', sessionId)
      .maybeSingle(),
  ])

  const { turns, rounds, result } = assembleSynodSession({
    turnsRows: turnsRes.data,
    roundsRows: roundsRes.data,
    resultRow: resultRes.data,
  })

  return {
    kind: 'synod',
    question: String(data.question ?? ''),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
    consensus_score: typeof data.consensus_score === 'number' ? data.consensus_score : null,
    synod_turns: turns,
    synod_rounds: rounds,
    synod_result: result,
    responses: [],
    is_public: Boolean(data.is_public),
  }
}

async function loadSession(shareId: string): Promise<ShareSession | null> {
  const id = shareId.trim()
  if (!id) return null

  const compare = await loadFromCompare(id)
  if (compare) return compare

  const persona = await loadFromPersona(id)
  if (persona) return persona

  const custom = await loadFromCustom(id)
  if (custom) return custom

  const panel = await loadFromPanel(id)
  if (panel) return panel

  const deep = await loadFromDeep(id)
  if (deep) return deep

  const comedy = await loadFromComedy(id)
  if (comedy) return comedy

  const tale = await loadFromTale(id)
  if (tale) return tale

  const oracle = await loadFromOracle(id)
  if (oracle) return oracle

  const suit = await loadFromSuit(id)
  if (suit) return suit

  const synod = await loadFromSynod(id)
  if (synod) return synod

  return loadFromArena(id)
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { share_id } = await params
  const session = await loadSession(share_id)

  if (!session) {
    return {
      title: 'Session not available — AIMANI',
      robots: { index: false, follow: false },
    }
  }

  const label =
    session.kind === 'persona'
      ? 'AI Persona'
      : session.kind === 'custom'
        ? 'AI Custom'
        : session.kind === 'panel'
          ? `AI Panel (${session.panel_type || 'session'})`
          : session.kind === 'deep'
            ? `AI Deep Research (${session.deep_type || 'session'})`
            : session.kind === 'comedy'
              ? `AI Comedy (${session.comedy_type || 'session'})`
              : session.kind === 'tale'
                ? 'AI Tale'
                : session.kind === 'oracle'
                  ? `AI Oracle (${session.oracle_type || 'session'})`
                  : session.kind === 'suit'
                    ? 'AI SUIT'
                    : session.kind === 'synod'
                      ? 'AI SYNOD Debate'
                      : session.kind === 'arena'
                        ? `AI Arena (Turn ${session.turn_number ?? '?'})`
        : 'AI Compare'
  const title = `${label}: "${session.question.slice(0, 60)}${session.question.length > 60 ? '…' : ''}" — AIMANI`

  const description =
    session.kind === 'persona'
      ? `See how different AI personas answered this question on AIMANI.`
      : session.kind === 'custom'
        ? `See how multiple AIs answered with your custom rules on AIMANI.`
        : session.kind === 'panel'
          ? `See how multiple AIs responded in this AIMANI Panel session.`
          : session.kind === 'deep'
            ? `See this multi-perspective AI deep research session on AIMANI.`
            : session.kind === 'comedy'
              ? `See this AI comedy session on AIMANI.`
              : session.kind === 'tale'
                ? `See these AI-generated stories on AIMANI.`
                : session.kind === 'oracle'
                  ? `See this AI Oracle session on AIMANI.`
                  : session.kind === 'suit'
                    ? `See this AI SUIT legal session on AIMANI.`
                    : session.kind === 'synod'
                      ? `See this multi-AI SYNOD deliberation on AIMANI.`
                      : session.kind === 'arena'
                        ? `See this AI Arena battle turn on AIMANI.`
        : `See how ChatGPT, Claude, Gemini, Grok, DeepSeek and Mistral answered this question on AIMANI.`

  return {
    title,
    description,
    openGraph: {
      title: `${label} — AIMANI`,
      description: session.question.slice(0, 150),
      url: `${PUBLIC_SHARE_BASE}/${share_id}`,
    },
    robots: session.is_public
      ? { index: true, follow: true }
      : { index: false, follow: false },
  }
}

export default async function SharePage({ params }: PageProps) {
  const { share_id } = await params
  const session = await loadSession(share_id)

  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0a0f1e] px-4 text-white">
        <p className="text-center text-slate-400">This session is not available</p>
      </main>
    )
  }

  const heading =
    session.kind === 'persona'
      ? 'AI Persona Session'
      : session.kind === 'custom'
        ? 'AI Custom Session'
        : session.kind === 'panel'
          ? `AI Panel Session — ${session.panel_type || 'panel'}`
          : session.kind === 'deep'
            ? `AI Deep Research Session — ${session.deep_type || 'deep'}`
            : session.kind === 'comedy'
              ? `AI Comedy Session — ${session.comedy_type || 'comedy'}`
              : session.kind === 'tale'
                ? 'AI Tale Session'
                : session.kind === 'oracle'
                  ? `AI Oracle Session — ${session.oracle_type || 'oracle'}`
                  : session.kind === 'suit'
                    ? 'AI SUIT Legal Session'
                    : session.kind === 'synod'
                      ? 'SYNOD'
                      : session.kind === 'arena'
                        ? `AI Arena Battle — Turn ${session.turn_number ?? '?'}`
        : 'AI Compare Session'

  const votedLabel =
    session.kind === 'synod' && session.voted_ai && isSynodProvider(session.voted_ai)
      ? BRAND[session.voted_ai]
      : session.voted_ai

  const synodRoundsByNumber = new Map(
    session.synod_rounds?.map((r) => [r.roundNumber, r]) ?? []
  )

  return (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-12 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-cyan-300/85">
          AIMANI
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{heading}</h1>

        <div className="mt-8 rounded-2xl border border-cyan-400/25 bg-[#131c35] px-5 py-4">
          <p className="text-sm leading-relaxed text-slate-100">{session.question}</p>
        </div>

        <div className="mt-8 flex flex-col gap-5">
          {session.kind === 'synod' && session.synod_turns?.length ? (
            <>
              {groupSynodTurnsByNumber(session.synod_turns).map(([roundNum, turns]) => {
                const facilitator = synodRoundsByNumber.get(roundNum)
                return (
                  <section key={`synod-round-${roundNum}`} className="space-y-3">
                    <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-300/90">
                      {synodRoundLabel(roundNum)}
                    </h2>
                    {turns.map((turn, idx) => (
                      <article
                        key={`${roundNum}-${turn.ai}-${idx}`}
                        className="rounded-2xl border border-white/10 bg-[#131c35]/80 p-5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded-lg bg-white/10 px-2.5 py-0.5 text-sm font-bold text-white">
                            {synodBrandName(turn.ai)}
                          </span>
                          {turn.actionTag ? (
                            <span className="inline-flex rounded-lg bg-violet-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-violet-200">
                              {turn.actionTag}
                            </span>
                          ) : null}
                          {turn.isRedTeam ? (
                            <span className="inline-flex rounded-lg bg-rose-500/20 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-rose-200">
                              Red Team
                            </span>
                          ) : null}
                        </div>
                        {turn.claim ? (
                          <p className="mt-2 text-xs font-medium italic text-slate-400">
                            {turn.claim}
                          </p>
                        ) : null}
                        {turn.content ? (
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                            {turn.content}
                          </p>
                        ) : (
                          <p className="mt-3 text-sm text-slate-500">No response</p>
                        )}
                      </article>
                    ))}
                    {facilitator ? (
                      <article className="rounded-2xl border border-cyan-400/20 bg-cyan-500/5 p-5">
                        <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/90">
                          Facilitator Summary
                        </h3>
                        <p className="mt-2 text-sm text-slate-300">
                          Consensus: {facilitator.summary.roundConsensusScore}%
                        </p>
                        {facilitator.summary.consensusPoints.length ? (
                          <div className="mt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Consensus points
                            </p>
                            <ul className="mt-1.5 list-inside list-disc space-y-1 text-sm text-slate-200">
                              {facilitator.summary.consensusPoints.map((pt, i) => (
                                <li key={i}>{pt.point}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {facilitator.summary.openIssues.length ? (
                          <div className="mt-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                              Open issues
                            </p>
                            <ul className="mt-1.5 space-y-2 text-sm text-slate-200">
                              {facilitator.summary.openIssues.map((issue, i) => (
                                <li key={i}>
                                  <span className="font-medium">{issue.issue}</span>
                                  {issue.positions.length ? (
                                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-slate-300">
                                      {issue.positions.map((pos, j) => (
                                        <li key={j}>
                                          {pos.ai}: {pos.stance}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </article>
                    ) : null}
                  </section>
                )
              })}
              {session.synod_result ? (
                <section className="space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300/90">
                    Final Synthesis
                  </h2>
                  <article className="rounded-2xl border border-white/10 bg-[#131c35]/80 p-5">
                    {session.synod_result.verdict ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                        {session.synod_result.verdict}
                      </p>
                    ) : (
                      <p className="text-sm text-slate-500">No verdict</p>
                    )}
                  </article>
                  {session.synod_result.minorityReport.length ? (
                    <article className="rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-300/90">
                        Minority Report
                      </h3>
                      <ul className="mt-3 space-y-2">
                        {session.synod_result.minorityReport.map((entry, i) => {
                          if (!entry || typeof entry !== 'object') return null
                          const row = entry as Record<string, unknown>
                          const ai = typeof row.ai === 'string' ? row.ai : 'Unknown'
                          const dissent = typeof row.dissent === 'string' ? row.dissent : ''
                          const reason = typeof row.reason === 'string' ? row.reason : ''
                          return (
                            <li
                              key={i}
                              className="text-sm leading-relaxed text-slate-300"
                            >
                              <span className="font-semibold text-amber-200">{ai}</span>
                              {dissent ? `: ${dissent}` : null}
                              {reason ? (
                                <span className="block text-slate-400">{reason}</span>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    </article>
                  ) : null}
                </section>
              ) : null}
            </>
          ) : session.kind === 'arena' && session.arena_rounds?.length ? (
            groupArenaRoundsByNumber(session.arena_rounds).map(([roundNum, rows]) => (
              <section key={`round-${roundNum}`} className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300/90">
                  Round {roundNum}
                </h2>
                {rows.map((r, idx) => (
                  <article
                    key={`${roundNum}-${r.ai_name}-${idx}`}
                    className="rounded-2xl border border-white/10 bg-[#131c35]/80 p-5"
                  >
                    <span className="inline-flex rounded-lg bg-white/10 px-2.5 py-0.5 text-sm font-bold text-white">
                      {r.ai_name}
                    </span>
                    {r.content ? (
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                        {r.content}
                      </p>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500">No response</p>
                    )}
                  </article>
                ))}
              </section>
            ))
          ) : (
            session.responses.map((r, idx) => (
              <article
                key={`${r.ai_name}-${idx}`}
                className="rounded-2xl border border-white/10 bg-[#131c35]/80 p-5"
              >
                <span className="inline-flex rounded-lg bg-white/10 px-2.5 py-0.5 text-sm font-bold text-white">
                  {r.ai_name}
                </span>
                {r.content ? (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                    {r.content}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-slate-500">No response</p>
                )}
              </article>
            ))
          )}
        </div>

        {votedLabel ? (
          <p className="mt-8 text-sm text-slate-300">
            🏆 Community pick: {votedLabel}
          </p>
        ) : null}

        <div className="mt-10">
          <Link
            href="https://aimani.ai"
            className="inline-flex rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            Try it yourself → aimani.ai
          </Link>
        </div>
      </div>
    </main>
  )
}
