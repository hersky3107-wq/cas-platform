import { randomBytes } from 'crypto'
import {
  runSingleAiProvider,
  type AiProviderName,
  type RouterResult,
} from '@/lib/ai/router'
import {
  APEX_PROVIDERS,
  APEX_MODEL,
  APEX_MODEL_FALLBACK,
  APEX_SYNTHESIS_MODEL,
  BRAND,
} from '@/lib/apex/config'
import { detectPromptLanguage } from '@/lib/synod/prompt-language'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { deductCreditsBalance } from '@/lib/credits-server'

// Inlined to match the SYNOD/Compare/DEEP convention (no shared helper exists).
function newShareId(): string {
  return randomBytes(12).toString('hex')
}

/** Premium flat price — higher than SYNOD expert (25). Deducted once, no refund. */
const APEX_CREDITS = 35

/** Minimum successful debater answers required to produce a synthesis. */
const MIN_SUCCESSES = 2

const VALID_PROVIDERS = new Set<AiProviderName>(APEX_PROVIDERS)

const APEX_DEBATER_PROMPT = `You are one of the world's most advanced AI models, invited to a premium expert panel. Give your strongest, most insightful, well-reasoned answer to the user's question. Be substantive and specific — this is a showcase of frontier capability, not a quick summary. Avoid filler and hedging; commit to your best thinking. Respond in the same language as the question.`

const APEX_SYNTHESIS_PROMPT = `You are the chair of a premium AI panel. Six of the world's most advanced models have each answered the user's question. Your job: synthesize their answers into one superior, authoritative response — capturing the best insights, resolving contradictions, and noting where they strongly agreed or notably diverged. Be the definitive answer the user pays a premium for. Write in the question's language. End with a one-line note summarizing the consensus and any notable divergence.`

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

type ApexDebaterResult = {
  provider: AiProviderName
  modelUsed: string
  text: string | null
  ms: number | null
  error?: string
}

// ──────────────────────────────────────────────────────────────────────────
// Module-level helpers (reused by both 'run' and the new granular actions)
// ──────────────────────────────────────────────────────────────────────────

/** Run one provider with primary model, falling back to APEX_MODEL_FALLBACK on hard failure. */
async function executeDebater(
  provider: AiProviderName,
  question: string,
  debaterSystemPrompt: string,
): Promise<ApexDebaterResult> {
  const primary = APEX_MODEL[provider]
  const call = (modelOverride: string) =>
    runSingleAiProvider({
      supabase: supabaseAdmin,
      sessionId: null,
      userId: null,
      provider,
      prompt: `QUESTION:\n${question}`,
      systemPrompt: debaterSystemPrompt,
      // Raised from 3000 → 8000: reasoning models (gpt-5.x) consume tokens internally
      // before producing visible content; 3000 left message.content empty.
      maxCompletionTokens: 8000,
      // gemini-3.1-pro-preview is reasoning-required and rejects thinkingBudget:0
      // ("only works in thinking mode"). Opt out of the override so it runs in its
      // default thinking mode. Harmless for non-google providers (ignored).
      allowGeminiThinking: true,
      modelOverride,
    })

  let r: RouterResult
  try {
    r = await call(primary)
  } catch (e: unknown) {
    r = {
      provider,
      model: primary,
      text: null,
      responseTimeMs: 0,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      error: e instanceof Error ? e.message : 'AI call failed',
    }
  }

  const failed = Boolean(r.error) || !r.text || !r.text.trim()
  const fallback = APEX_MODEL_FALLBACK[provider]
  if (failed && fallback) {
    try {
      const r2 = await call(fallback)
      if (!r2.error && r2.text && r2.text.trim()) {
        return { provider, modelUsed: fallback, text: r2.text, ms: r2.responseTimeMs }
      }
      return {
        provider,
        modelUsed: fallback,
        text: null,
        ms: r2.responseTimeMs,
        error: r2.error ?? 'Empty response',
      }
    } catch (e: unknown) {
      return {
        provider,
        modelUsed: fallback,
        text: null,
        ms: null,
        error: e instanceof Error ? e.message : 'Fallback call failed',
      }
    }
  }

  return {
    provider,
    modelUsed: primary,
    text: failed ? null : r.text,
    ms: r.responseTimeMs,
    error: failed ? (r.error ?? 'Empty response') : undefined,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Route
// ──────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  console.error('[APEX] action:', body?.action)

  try {
    return await handleApexPost(req, body)
  } catch (err: unknown) {
    console.error('[APEX] TOP-LEVEL ERROR:', err)
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    )
  }
}

async function handleApexPost(req: Request, body: Record<string, unknown>): Promise<Response> {
  const action = typeof body.action === 'string' ? body.action : ''
  const { user, error: authErr } = await resolveRouteAuth(req, body)
  const supabase = supabaseAdmin
  if (authErr || !user) {
    console.error('[APEX] auth step failed:', authErr)
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }

  // ── ACTION: vote ─────────────────────────────────────────────────────────
  if (action === 'vote') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const votedAi = typeof body.voted_ai === 'string' ? body.voted_ai : ''
    if (!sessionId || !votedAi) {
      return Response.json({ error: 'sessionId and voted_ai are required' }, { status: 400 })
    }
    if (!VALID_PROVIDERS.has(votedAi as AiProviderName)) {
      return Response.json({ error: 'Invalid voted_ai' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('apex_sessions')
      .update({ voted_ai: votedAi })
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .select('session_id')
      .maybeSingle()
    if (error) {
      console.error('[APEX vote] update failed:', error)
      return Response.json({ ok: false, error: error.message }, { status: 500 })
    }
    if (!data) {
      return Response.json({ error: 'Session not found' }, { status: 404 })
    }

    return Response.json({ ok: true, voted_ai: votedAi })
  }

  // ── ACTION: load ─────────────────────────────────────────────────────────
  if (action === 'load') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 })
    }

    const { data: sess, error: sessErr } = await supabase
      .from('apex_sessions')
      .select('session_id, user_id, question, status, share_id, voted_ai')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (sessErr || !sess) {
      return Response.json({ error: 'Session not found' }, { status: 404 })
    }
    if (sess.user_id && sess.user_id !== user.id) {
      return Response.json({ error: 'Not your session' }, { status: 403 })
    }

    const [turnsRes, resultRes] = await Promise.all([
      supabase
        .from('apex_turns')
        .select('ai_name, model_id, content, ms, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }),
      supabase
        .from('apex_results')
        .select('synthesis')
        .eq('session_id', sessionId)
        .maybeSingle(),
    ])

    const turns = (turnsRes.data ?? []).map((row) => ({
      ai: String(row.ai_name),
      model: typeof row.model_id === 'string' ? row.model_id : '',
      content: String(row.content ?? ''),
      ms: typeof row.ms === 'number' ? row.ms : null,
    }))

    return Response.json({
      ok: true,
      session: {
        question: String(sess.question ?? ''),
        shareId: String(sess.share_id ?? ''),
        votedAi: typeof sess.voted_ai === 'string' ? sess.voted_ai : null,
        status: String(sess.status ?? 'done'),
      },
      turns,
      synthesis: resultRes.data?.synthesis ? String(resultRes.data.synthesis) : null,
    })
  }

  // ── ACTION: start — auth + deduct credits + create session, NO model calls ─
  if (action === 'start') {
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) {
      return Response.json({ error: 'question is required' }, { status: 400 })
    }

    const deduct = await deductCreditsBalance(supabase, user.id, APEX_CREDITS, 'apex_session')
    if (!deduct.ok) {
      console.error('[APEX start] credit deduct failed:', deduct)
      const insufficient = deduct.reason === 'insufficient'
      return Response.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deduct.balance,
          required: APEX_CREDITS,
        },
        { status: insufficient ? 402 : 500 }
      )
    }

    const ins = await supabase
      .from('apex_sessions')
      .insert([{ user_id: user.id, question, status: 'running', share_id: newShareId() }])
      .select()
      .single()
    if (ins.error || !ins.data?.session_id) {
      console.error('[APEX start] session insert failed:', ins.error)
      return Response.json(
        { error: ins.error?.message ?? 'Could not start session' },
        { status: 500 }
      )
    }

    return Response.json({
      ok: true,
      sessionId: String(ins.data.session_id),
      shareId: typeof ins.data.share_id === 'string' ? ins.data.share_id : undefined,
      creditsRemaining: deduct.balance ?? undefined,
    })
  }

  // ── ACTION: debater — run ONE provider, insert its turn, return turn ──────
  if (action === 'debater') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const provider = typeof body.provider === 'string' ? body.provider : ''
    const uiLocale = typeof body.ui_locale === 'string' ? body.ui_locale : null

    if (!sessionId || !provider) {
      return Response.json({ error: 'sessionId and provider are required' }, { status: 400 })
    }
    if (!VALID_PROVIDERS.has(provider as AiProviderName)) {
      return Response.json({ error: 'Invalid provider' }, { status: 400 })
    }

    // Load session for ownership check + question (don't trust client for question).
    const { data: sess, error: sessErr } = await supabase
      .from('apex_sessions')
      .select('question, user_id, status')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (sessErr || !sess) {
      return Response.json({ error: 'Session not found' }, { status: 404 })
    }
    if (sess.user_id !== user.id) {
      return Response.json({ error: 'Not your session' }, { status: 403 })
    }

    const question = String(sess.question ?? '')
    const lang = detectPromptLanguage(question, uiLocale)
    const debaterSystemPrompt = `${APEX_DEBATER_PROMPT}\n\n${lang.instruction}`

    const result = await executeDebater(provider as AiProviderName, question, debaterSystemPrompt)

    if (!result.text) {
      console.error(`[APEX debater] ${provider} failed:`, result.error)
      return Response.json({ ok: true, turn: null, error: result.error })
    }

    const { error: turnErr } = await supabase.from('apex_turns').insert([
      {
        session_id: sessionId,
        ai_name: result.provider,
        model_id: result.modelUsed,
        content: result.text,
        ms: result.ms,
      },
    ])
    if (turnErr) {
      console.error('[APEX debater] turn insert failed:', turnErr)
      return Response.json({ ok: false, error: turnErr.message }, { status: 500 })
    }

    return Response.json({
      ok: true,
      turn: {
        ai: result.provider,
        model: result.modelUsed,
        content: result.text,
        ms: result.ms,
      },
    })
  }

  // ── ACTION: synthesize — read all turns, run chair synthesis, mark done ───
  if (action === 'synthesize') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const uiLocale = typeof body.ui_locale === 'string' ? body.ui_locale : null
    if (!sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 })
    }

    // Load session for ownership + question.
    const { data: sess, error: sessErr } = await supabase
      .from('apex_sessions')
      .select('question, user_id')
      .eq('session_id', sessionId)
      .maybeSingle()
    if (sessErr || !sess) {
      return Response.json({ error: 'Session not found' }, { status: 404 })
    }
    if (sess.user_id !== user.id) {
      return Response.json({ error: 'Not your session' }, { status: 403 })
    }

    const question = String(sess.question ?? '')

    // Load all successful turns.
    const { data: turnRows, error: turnsErr } = await supabase
      .from('apex_turns')
      .select('ai_name, content')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
    if (turnsErr) {
      return Response.json({ error: turnsErr.message }, { status: 500 })
    }

    const successes = (turnRows ?? []).filter((r) => r.content && String(r.content).trim())

    if (successes.length < MIN_SUCCESSES) {
      await supabase
        .from('apex_sessions')
        .update({ status: 'partial', updated_at: new Date().toISOString() })
        .eq('session_id', sessionId)
      return Response.json({ ok: true, synthesis: null, partial: true })
    }

    const lang = detectPromptLanguage(question, uiLocale)
    const synthesisSystemPrompt = `${APEX_SYNTHESIS_PROMPT}\n\n${lang.instruction}`

    const answersBlock = successes
      .map(
        (d) =>
          `${(BRAND as Record<string, string>)[d.ai_name] ?? d.ai_name} said:\n${String(d.content).trim()}`
      )
      .join('\n\n---\n\n')
    const synthesisInput = `QUESTION:\n${question}\n\nPANEL ANSWERS:\n\n${answersBlock}`

    let synthesis: string | null = null
    try {
      const sr = await runSingleAiProvider({
        supabase,
        sessionId: null,
        userId: null,
        provider: 'anthropic',
        prompt: synthesisInput,
        systemPrompt: synthesisSystemPrompt,
        maxCompletionTokens: 6000,
        modelOverride: APEX_SYNTHESIS_MODEL,
      })
      if (!sr.error && sr.text && sr.text.trim()) {
        synthesis = sr.text
      } else {
        console.error('[APEX synthesize] failed:', sr.error)
      }
    } catch (e: unknown) {
      console.error('[APEX synthesize] CAUGHT ERROR:', e)
    }

    if (synthesis) {
      const { error: resErr } = await supabase
        .from('apex_results')
        .upsert([{ session_id: sessionId, synthesis }], { onConflict: 'session_id' })
      if (resErr) {
        console.error('[APEX synthesize] result upsert failed:', resErr)
        return Response.json({ ok: false, error: resErr.message }, { status: 500 })
      }
    }

    await supabase
      .from('apex_sessions')
      .update({
        status: synthesis ? 'done' : 'partial',
        updated_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId)

    return Response.json({ ok: true, synthesis })
  }

  // ── ACTION: run — legacy all-in-one (kept as fallback, not used by new UI) ─
  if (action === 'run') {
    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) {
      return Response.json({ error: 'question is required' }, { status: 400 })
    }
    const uiLocale = typeof body.ui_locale === 'string' ? body.ui_locale : null
    const lang = detectPromptLanguage(question, uiLocale)

    const deduct = await deductCreditsBalance(supabase, user.id, APEX_CREDITS, 'apex_session')
    if (!deduct.ok) {
      console.error('[APEX run] credit deduct failed:', deduct)
      const insufficient = deduct.reason === 'insufficient'
      return Response.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deduct.balance,
          required: APEX_CREDITS,
        },
        { status: insufficient ? 402 : 500 }
      )
    }
    const creditsRemaining = deduct.balance ?? undefined

    const ins = await supabase
      .from('apex_sessions')
      .insert([{ user_id: user.id, question, status: 'running', share_id: newShareId() }])
      .select()
      .single()
    if (ins.error || !ins.data?.session_id) {
      console.error('[APEX run] session insert failed:', ins.error)
      return Response.json(
        { error: ins.error?.message ?? 'Could not start session' },
        { status: 500 }
      )
    }
    const sessionId = String(ins.data.session_id)
    const shareId = typeof ins.data.share_id === 'string' ? ins.data.share_id : undefined

    const debaterSystemPrompt = `${APEX_DEBATER_PROMPT}\n\n${lang.instruction}`

    const settled = await Promise.allSettled(
      APEX_PROVIDERS.map((p) => executeDebater(p, question, debaterSystemPrompt))
    )
    const debaterResults: ApexDebaterResult[] = settled.map((s, i) =>
      s.status === 'fulfilled'
        ? s.value
        : {
            provider: APEX_PROVIDERS[i]!,
            modelUsed: APEX_MODEL[APEX_PROVIDERS[i]!],
            text: null,
            ms: null,
            error: s.reason ? String(s.reason) : 'Unknown error',
          }
    )

    const successes = debaterResults.filter(
      (d): d is ApexDebaterResult & { text: string } =>
        typeof d.text === 'string' && d.text.trim().length > 0
    )

    if (successes.length) {
      const turnRows = successes.map((d) => ({
        session_id: sessionId,
        ai_name: d.provider,
        model_id: d.modelUsed,
        content: d.text,
        ms: d.ms,
      }))
      const turnIns = await supabase.from('apex_turns').insert(turnRows)
      if (turnIns.error) {
        console.error('[APEX run] turn insert failed:', turnIns.error)
        return Response.json({ ok: false, error: turnIns.error.message }, { status: 500 })
      }
    }

    if (successes.length < MIN_SUCCESSES) {
      await supabase
        .from('apex_sessions')
        .update({ status: 'partial', updated_at: new Date().toISOString() })
        .eq('session_id', sessionId)
      return Response.json({
        ok: true,
        sessionId,
        shareId,
        creditsRemaining,
        turns: successes.map((d) => ({
          ai: d.provider,
          model: d.modelUsed,
          content: d.text,
          ms: d.ms,
        })),
        synthesis: null,
        partial: true,
        error: 'Too few models responded to synthesize.',
      })
    }

    const answersBlock = successes
      .map((d) => `${BRAND[d.provider]} said:\n${d.text.trim()}`)
      .join('\n\n---\n\n')
    const synthesisInput = `QUESTION:\n${question}\n\nPANEL ANSWERS:\n\n${answersBlock}`
    const synthesisSystemPrompt = `${APEX_SYNTHESIS_PROMPT}\n\n${lang.instruction}`

    let synthesis: string | null = null
    try {
      const sr = await runSingleAiProvider({
        supabase,
        sessionId: null,
        userId: null,
        provider: 'anthropic',
        prompt: synthesisInput,
        systemPrompt: synthesisSystemPrompt,
        maxCompletionTokens: 6000,
        modelOverride: APEX_SYNTHESIS_MODEL,
      })
      if (!sr.error && sr.text && sr.text.trim()) {
        synthesis = sr.text
      } else {
        console.error('[APEX run] synthesis failed:', sr.error)
      }
    } catch (e: unknown) {
      console.error('[APEX run] synthesis CAUGHT ERROR:', e)
    }

    if (synthesis) {
      const resIns = await supabase
        .from('apex_results')
        .upsert([{ session_id: sessionId, synthesis }], { onConflict: 'session_id' })
      if (resIns.error) {
        console.error('[APEX run] result insert failed:', resIns.error)
        return Response.json({ ok: false, error: resIns.error.message }, { status: 500 })
      }
    }

    await supabase
      .from('apex_sessions')
      .update({
        status: synthesis ? 'done' : 'partial',
        updated_at: new Date().toISOString(),
      })
      .eq('session_id', sessionId)

    return Response.json({
      ok: true,
      sessionId,
      shareId,
      creditsRemaining,
      turns: successes.map((d) => ({
        ai: d.provider,
        model: d.modelUsed,
        content: d.text,
        ms: d.ms,
      })),
      synthesis,
    })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
