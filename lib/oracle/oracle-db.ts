import { supabaseAdmin } from '@/lib/supabase/server'

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
    target_ai_name: aiName,
    model_name: modelName,
    response_text: payload.responseText,
    response_time_ms: payload.responseTimeMs,
    token_input: payload.promptTokens,
    token_output: payload.completionTokens,
    ...(payload.errorText != null ? { error_text: payload.errorText } : {}),
  }
  const fallback = {
    session_id: sessionId,
    ai_name: aiName,
    target_ai_name: aiName,
    model_name: modelName,
    response_text: payload.responseText,
    response_time_ms: payload.responseTimeMs,
    prompt_tokens: payload.promptTokens,
    completion_tokens: payload.completionTokens,
  }
  let r = await supabaseAdmin.from('ai_responses').insert([primary as never])
  if (!r.error) return
  r = await supabaseAdmin.from('ai_responses').insert([fallback as never])
  if (r.error) console.warn('[oracle] ai_responses insert:', r.error.message)
}

export async function oracleInsertCostLog(opts: {
  sessionId: string
  aiName: string
  modelName: string
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  responseTimeMs: number
  errorText?: string | null
}) {
  const primary = {
    session_id: opts.sessionId,
    ai_name: opts.aiName,
    model_name: opts.modelName,
    prompt_tokens: opts.promptTokens,
    completion_tokens: opts.completionTokens,
    total_tokens: opts.totalTokens,
    response_time_ms: opts.responseTimeMs,
    cost_usd: 0,
    error_text: opts.errorText ?? null,
  }
  const fallback = { session_id: opts.sessionId, model_name: opts.modelName }
  let r = await supabaseAdmin.from('model_cost_logs').insert([primary as never])
  if (!r.error) return
  r = await supabaseAdmin.from('model_cost_logs').insert([fallback as never])
  if (r.error) console.warn('[oracle] model_cost_logs insert:', r.error.message)
}
