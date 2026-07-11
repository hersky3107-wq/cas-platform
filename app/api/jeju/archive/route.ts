import { supabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// Read-only archive of completed governance sessions (jeju_deep_sessions).
// Serves a showcase list of past 찬반(deliberate) / 진단(diagnostic) /
// 개방(brief) runs. Does NOT write to the table — that stays owned by
// app/api/jeju/deliberate|diagnostic|brief/route.ts.
//
// `state` is an opaque JSONB blob whose shape differs per mode (there is no
// stored `mode` column), so the mode is inferred here from which
// mode-specific field is present:
//   - diagnostic  → state.status / state.issues   (DiagnosticPart)
//   - brief       → state.synthesis                (JejuOpenBriefSynthesis)
//   - deliberate  → state.verdict / state.vote      (JejuVerdict / JejuVoteResult)
// (app/api/jeju/deep/route.ts shares the same verdict+vote shape as
// deliberate, so those rows are also labeled 찬반 — they're the same family
// of chair-verdict deliberation.)
// ─────────────────────────────────────────────────────────────────────────────

export type JejuArchiveMode = 'deliberate' | 'diagnostic' | 'brief' | 'other'

export type JejuArchiveEntry = {
  id: string
  question: string
  mode: JejuArchiveMode
  createdAt: string
  summary: string
  detail: {
    keyIssues: string | null
    judgment: string | null
    minorityReport: string | null
    mediaRisk: string | null
    voteSummary: string | null
    statusText: string | null
    issuesText: string | null
    synthesisText: string | null
  }
}

type RawRow = {
  id: string
  question: string | null
  status: string | null
  state: unknown
  created_at: string
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function firstLine(text: string | null, maxLen = 160): string | null {
  if (!text) return null
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  const picked = line ?? text.trim()
  if (!picked) return null
  return picked.length > maxLen ? `${picked.slice(0, maxLen - 1)}…` : picked
}

function rowToEntry(row: RawRow): JejuArchiveEntry | null {
  const question = str(row.question)
  if (!question) return null

  const state = asRecord(row.state)
  if (!state) return null

  const verdict = asRecord(state.verdict)
  const vote = asRecord(state.vote)
  const status = asRecord(state.status)
  const issues = asRecord(state.issues)
  const synthesis = asRecord(state.synthesis)

  const keyIssues = verdict ? str(verdict.keyIssues) : null
  const judgment = verdict ? str(verdict.judgment) : null
  const minorityReport = verdict ? str(verdict.minorityReport) : null
  const mediaRisk = verdict ? str(verdict.mediaRisk) : null
  const voteSummary = vote ? str(vote.summary) : null

  const statusText = status ? str(status.text) : null
  const issuesText = issues ? str(issues.text) : null
  const synthesisText = synthesis ? str(synthesis.synthesis) : null

  let mode: JejuArchiveMode
  let summary: string | null

  if (issuesText || statusText) {
    mode = 'diagnostic'
    summary = firstLine(issuesText ?? statusText)
  } else if (synthesisText) {
    mode = 'brief'
    summary = firstLine(synthesisText)
  } else if (judgment || keyIssues) {
    mode = 'deliberate'
    summary = firstLine(voteSummary ?? judgment ?? keyIssues)
  } else {
    // Result-less / unrecognized shape (e.g. an error or half-run test) — skip
    // rather than mislabel it in the showcase.
    return null
  }

  return {
    id: row.id,
    question,
    mode,
    createdAt: row.created_at,
    summary: summary ?? '—',
    detail: {
      keyIssues,
      judgment,
      minorityReport,
      mediaRisk,
      voteSummary,
      statusText,
      issuesText,
      synthesisText,
    },
  }
}

export async function GET(): Promise<Response> {
  try {
    const { data, error } = await supabaseAdmin
      .from('jeju_deep_sessions')
      .select('id, question, status, state, created_at')
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) {
      return Response.json({ ok: false, error: error.message, entries: [] }, { status: 500 })
    }

    const entries = ((data ?? []) as RawRow[])
      .map(rowToEntry)
      .filter((e): e is JejuArchiveEntry => e !== null)

    return Response.json({ ok: true, entries })
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : 'Internal error'
    return Response.json({ ok: false, error, entries: [] }, { status: 500 })
  }
}
