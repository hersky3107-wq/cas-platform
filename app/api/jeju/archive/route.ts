import { supabaseAdmin } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const maxDuration = 30

// ─────────────────────────────────────────────────────────────────────────────
// Read-only(-ish) archive of completed governance sessions (jeju_deep_sessions).
// Serves a showcase list of past 찬반(deliberate) / 진단(diagnostic) /
// 개방(brief) runs. Does NOT write RESULT data to the table — that stays owned
// by app/api/jeju/deliberate|diagnostic|brief/route.ts. The one exception is
// the retention purge below (DELETE only, never INSERT/UPDATE).
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

/** Rows older than this (by created_at) are purged on every archive GET. */
const ARCHIVE_RETENTION_DAYS = 90

/**
 * Deletes jeju_deep_sessions rows whose created_at is older than the retention
 * window (lightweight in-request purge — no cron dependency). `created_at` is
 * the column this table's schema (20260626000001_jeju_deep_sessions.sql) sets
 * on insert and never touches again, and is the same column the GET below
 * already orders/displays by — so "older than 90 days" means "created more
 * than 90 days ago", not "last updated more than 90 days ago" (updated_at).
 *
 * Best-effort only: never throws. A delete failure is logged and swallowed so
 * the archive list below still renders even if the purge itself fails.
 */
async function purgeOldArchiveRows(): Promise<void> {
  try {
    const cutoffIso = new Date(Date.now() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabaseAdmin
      .from('jeju_deep_sessions')
      .delete()
      .lt('created_at', cutoffIso)

    if (error) {
      console.warn('[jeju-archive] retention purge failed:', error.message)
    }
  } catch (e: unknown) {
    console.warn('[jeju-archive] retention purge threw:', e instanceof Error ? e.message : e)
  }
}

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
    dataTrust: string | null
    evidenceLedger: string | null
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
  const dataTrust = verdict ? str(verdict.dataTrust) : null
  const evidenceLedger = verdict ? str(verdict.evidenceLedger) : null
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
      dataTrust,
      evidenceLedger,
      voteSummary,
      statusText,
      issuesText,
      synthesisText,
    },
  }
}

export async function GET(): Promise<Response> {
  // Purge before listing so a freshly-crossed-90-day row never shows up in the
  // response it's about to be deleted from. Failure here must never block the
  // list below (see purgeOldArchiveRows' own try/catch).
  await purgeOldArchiveRows()

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
