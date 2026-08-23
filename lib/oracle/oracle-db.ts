import { supabaseAdmin } from '@/lib/supabase/server'

/**
 * public.ai_responses — LIVE schema confirmed via the same PostgREST
 * introspection method as model_cost_logs below (no migration file defines
 * this table either): id, session_id (FK -> sessions.id, nullable),
 * participant_id (FK -> session_participants.id, nullable), ai_name
 * (NOT NULL), model_name (NOT NULL), response_text (NOT NULL),
 * response_time_ms, token_input, token_output, created_at, tale_language.
 *
 * There is no target_ai_name, error_text, prompt_tokens, or
 * completion_tokens column — the previous payloads used those names by
 * mistake, so both inserts always failed here too.
 */
export async function oracleInsertAiResponse(
  sessionId: string,
  aiName: string,
  modelName: string,
  payload: {
    responseText: string | null
    responseTimeMs: number
    promptTokens: number | null
    completionTokens: number | null
    errorText?: string | null
  }
) {
  const primary = {
    session_id: sessionId,
    ai_name: aiName,
    model_name: modelName,
    response_text: payload.responseText,
    response_time_ms: payload.responseTimeMs,
    token_input: payload.promptTokens,
    token_output: payload.completionTokens,
  }
  // ai_name/model_name/response_text are NOT NULL with no default, so the
  // fallback keeps them. session_id is the only FK'd field here, so it is
  // the one dropped rather than retried (same reasoning as model_cost_logs).
  const fallback = {
    ai_name: aiName,
    model_name: modelName,
    response_text: payload.responseText,
    response_time_ms: payload.responseTimeMs,
    token_input: payload.promptTokens,
    token_output: payload.completionTokens,
  }
  let r = await supabaseAdmin.from('ai_responses').insert([primary as never])
  if (!r.error) return
  r = await supabaseAdmin.from('ai_responses').insert([fallback as never])
  if (r.error) console.warn('[oracle] ai_responses insert:', r.error.message)
}

/**
 * public.model_cost_logs has no defining migration (it predates migration
 * tracking) — this column list is the LIVE schema, confirmed via PostgREST
 * introspection (GET {supabase_url}/rest/v1/), not guessed from TypeScript
 * call sites elsewhere in the repo:
 *
 *   id                 uuid            PK, not null
 *   session_id         uuid            nullable, FK -> public.sessions(id)
 *   ai_name            text            NOT NULL, no default
 *   model_name         text            NOT NULL, no default
 *   input_tokens       integer         nullable
 *   output_tokens      integer         nullable
 *   cost_usd           numeric         nullable
 *   response_time_ms   integer         nullable
 *   created_at         timestamptz     nullable / has default
 *   oracle_session_id  uuid            nullable, NO FK (added by
 *                                      20260823000001_model_cost_logs_oracle_session_id.sql)
 *
 * There is no total_tokens or error_text column, and the token columns are
 * input_tokens/output_tokens — NOT prompt_tokens/completion_tokens (those
 * names belong to the ai_responses table, not this one).
 */
export async function oracleInsertCostLog(opts: {
  /**
   * Pass null when the caller's id is not a row in public.sessions (e.g. the
   * layer-1 rebuild's oracle_job_sessions id) — session_id has a live FK to
   * sessions(id), so a foreign, non-matching id fails the insert outright.
   */
  sessionId: string | null
  /**
   * public.oracle_job_sessions id for the layer-1 rebuild path. Unconstrained
   * (no FK), so it is safe to set even though session_id must stay null for
   * these rows. Legacy callers (fate/astro/tarot/daily/exec-readings) leave
   * this unset — they already have a real session_id.
   */
  oracleSessionId?: string | null
  aiName: string
  modelName: string
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  responseTimeMs: number
  costUsd?: number | null
  /** True when cost_usd was token×price estimated; false when provider-reported. */
  isEstimated?: boolean | null
  httpAttempts?: number | null
  finalAttemptMs?: number | null
  errorText?: string | null
}) {
  const primary = {
    ...(opts.sessionId != null ? { session_id: opts.sessionId } : {}),
    ...(opts.oracleSessionId != null ? { oracle_session_id: opts.oracleSessionId } : {}),
    ai_name: opts.aiName,
    model_name: opts.modelName,
    input_tokens: opts.promptTokens,
    output_tokens: opts.completionTokens,
    response_time_ms: opts.responseTimeMs,
    cost_usd: opts.costUsd ?? null,
    ...(opts.isEstimated != null ? { is_estimated: opts.isEstimated } : {}),
    ...(opts.httpAttempts != null ? { http_attempts: opts.httpAttempts } : {}),
    ...(opts.finalAttemptMs != null ? { final_attempt_ms: opts.finalAttemptMs } : {}),
  }
  const legacyPrimary = {
    ...(opts.sessionId != null ? { session_id: opts.sessionId } : {}),
    ...(opts.oracleSessionId != null ? { oracle_session_id: opts.oracleSessionId } : {}),
    ai_name: opts.aiName,
    model_name: opts.modelName,
    input_tokens: opts.promptTokens,
    output_tokens: opts.completionTokens,
    response_time_ms: opts.responseTimeMs,
    cost_usd: opts.costUsd ?? null,
  }
  // ai_name/model_name are NOT NULL with no default, so the fallback must
  // always carry them too. session_id is intentionally dropped here (rather
  // than retried) since a FK violation on it is the most likely reason the
  // primary insert — which already uses only real columns — would fail.
  // oracle_session_id has no FK, so it is kept in the fallback too — there is
  // no schema reason it would ever cause a failure.
  const fallback = {
    ai_name: opts.aiName,
    model_name: opts.modelName,
    ...(opts.oracleSessionId != null ? { oracle_session_id: opts.oracleSessionId } : {}),
  }
  let r = await supabaseAdmin.from('model_cost_logs').insert([primary as never])
  if (!r.error) return
  r = await supabaseAdmin.from('model_cost_logs').insert([legacyPrimary as never])
  if (!r.error) return
  r = await supabaseAdmin.from('model_cost_logs').insert([fallback as never])
  if (r.error) console.warn('[oracle] model_cost_logs insert:', r.error.message)
}
