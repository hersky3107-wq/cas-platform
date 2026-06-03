import { deductCreditsBalance } from '@/lib/credits-server'
import type { RouterResult } from '@/lib/ai/router'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { oracleInsertAiResponse, oracleInsertCostLog } from '@/lib/oracle/oracle-db'
import { oracleGptCompletion } from '@/lib/oracle/openai-gpt'
import {
  defaultReaderLabels,
  oracleRunFiveReaders,
  readerSideUser,
} from '@/lib/oracle/exec-readings'
import { ORACLE_SESSION_COST, ORACLE_SYNTH_MAX_TOKENS, ORACLE_SYNTH_MODEL } from '@/lib/oracle/oracle-constants'
import { oracleProfileLooksComplete } from '@/lib/oracle/profile-guard'
import { fateBirthLine, resolveOracleBirth } from '@/lib/oracle/profile-resolver'
import { fateReaderSystemPrompt } from '@/lib/oracle/oracle-prompts'
import { fetchOracleBirthProfileAdmin } from '@/lib/oracle/users-oracle-storage'
import { applyOracleLanguageToSystemPrompt } from '@/lib/oracle/oracle-language'

function jsonResp(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function fateSynthesisSystemPromptExact(params: {
  birthDataLine: string
  currentDateIso: string
  languageInstruction: string
}): string {
  return `You are a warm fortune reader who has just received readings 
from four other AI readers: Claude, Gemini, Grok, and DeepSeek.
You also have the person's birth data: ${params.birthDataLine}
Current date: ${params.currentDateIso}

${params.languageInstruction}

Write in flowing prose only. No headers. No bullet points.

Structure your response naturally like this:

1. Start with your own brief reading of their birth chart 
   (2-3 sentences, specific to their actual birth data).

2. Share where Claude, Gemini, Grok, and DeepSeek agreed — 
   mention them by name, describe what they said, 
   nothing more. No evaluation.
   Example: "Claude and DeepSeek both said that..."
   Example: "Gemini and Grok pointed to..."

3. Share where they disagreed or saw things differently — 
   again, just describe what each said by name.
   Example: "Claude focused on... while Grok felt that..."
   Do NOT say one view is more interesting or unique.

4. Share one thing only one reader mentioned — 
   name that reader and describe what they said.
   Example: "DeepSeek alone mentioned that..."
   Do NOT evaluate or praise this view.

5. End with your own personal message directly to this person,
   grounded in something specific from their birth chart.

CRITICAL RULES:
- Always use exact AI names: Claude, Gemini, Grok, DeepSeek
- NEVER say "다른 독자", "한 분", "another reader", "one reader"
- NEVER evaluate: no "독특합니다", "흥미롭습니다", "interesting", "unique"
- Just describe what each AI said — let the person decide what resonates
- Warm, simple, conversational language throughout
- No meta-commentary, no language detection notes
- Maximum 1500 tokens
- Never cut off mid-sentence`
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResp({ error: 'Invalid JSON' }, 400)
  }

  const questionRaw = typeof body.question === 'string' ? body.question.trim() : ''
  const sessionPrompt = questionRaw || '(general reading)'
  const questionLine =
    questionRaw ||
    'The person did not ask a specific question; offer a warm, grounded portrait from their birth timing only.'

  const { user, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user) {
    return jsonResp({ error: 'Invalid session' }, 401)
  }

  const { v1: profile, error: profErr } = await fetchOracleBirthProfileAdmin(user.id)
  if (profErr) return jsonResp({ error: 'Could not load birth profile' }, 500)
  if (!profile || !oracleProfileLooksComplete(profile)) {
    return jsonResp(
      { error: 'Complete your Oracle birth profile before running a reading.', code: 'profile_incomplete' },
      400
    )
  }

  const rb = resolveOracleBirth(profile)
  if (!rb) return jsonResp({ error: 'Invalid stored birth profile' }, 400)

  const todayIso = new Date().toISOString().split('T')[0]
  const currentYear = new Date().getFullYear()
  const languageSourceText = questionRaw || rb.birthCity
  const languageInstruction = questionRaw
    ? `User question language should match the reading language.`
    : `Birth city: ${rb.birthCity}.`
  const fatePromptAdditions = [
    `Today's exact date is: ${todayIso}`,
    `Current year: ${currentYear}`,
    'Base ALL yearly and monthly readings on this current date.',
    "Never assume or guess the year.",
    '',
    'You have 600 tokens. Use the first 500 for your reading.',
    'Reserve the last 100 to write a complete closing sentence.',
    'Never end mid-sentence or mid-paragraph.',
    'Complete your response naturally before stopping.',
  ].join('\n')

  const deduct = await deductCreditsBalance(supabaseAdmin, user.id, ORACLE_SESSION_COST, 'oracle_fate')
  if (!deduct.ok) {
    const insufficient = deduct.reason === 'insufficient'
    return jsonResp(
      {
        error: insufficient
          ? `This reading costs ${ORACLE_SESSION_COST} credits. You have ${deduct.balance}.`
          : 'Could not update credits. Please try again.',
        balance: deduct.balance,
        required: ORACLE_SESSION_COST,
      },
      insufficient ? 402 : 500
    )
  }
  const creditsRemaining = deduct.balance

  const ins = await supabaseAdmin
    .from('sessions')
    .insert([{ mode: 'fate', prompt: sessionPrompt.slice(0, 8000) }])
    .select()
    .single()

  if (ins.error || !ins.data?.id) {
    return jsonResp({ error: ins.error?.message ?? 'Could not start session' }, 500)
  }
  const sessionId = String(ins.data.id)

  const birthLine = fateBirthLine(rb)

  const readersSystemPromptFn = (provider: 'anthropic' | 'google' | 'xai' | 'deepseek' | 'openai' | 'mistral') => {
    const base = fateReaderSystemPrompt(birthLine, questionLine)
    if (provider === 'anthropic') {
      return [
        'Before you begin, decide your closing sentence first.',
        'Keep that conclusion in mind as you write.',
        'Write in flowing prose. No nested lists or heavy headers.',
        'If you are approaching the token limit, skip to your',
        'pre-decided closing sentence immediately and stop cleanly.',
        'Never end mid-sentence or mid-word.',
        '',
        base,
        '',
        fatePromptAdditions,
      ].join('\n')
    }
    return `${base}\n\n${fatePromptAdditions}`
  }

  const userPrompt = readerSideUser('fate')

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const writeJson = (obj: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
      try {
        writeJson({
          type: 'meta',
          sessionId,
          creditsRemaining,
          cost: ORACLE_SESSION_COST,
          mode: 'fate',
        })

        const fateProviders = ['anthropic', 'google', 'xai', 'deepseek'] as const
        const readerOut = await oracleRunFiveReaders({
          sessionId,
          readersSystemPromptFn,
          userPrompt,
          languageSourceText,
          providers: [...fateProviders],
          maxTokensByProvider: { anthropic: 1100, google: 1100 },
          modelOverrideByProvider: { anthropic: 'claude-sonnet-4-6' },
          onReaderDone: ({ slot, result }) =>
            writeJson({
              type: 'reader_result',
              slot,
              model: result.model,
              text: result.text,
              error: result.error ?? null,
              response_time_ms: result.responseTimeMs,
              prompt_tokens: result.promptTokens,
              completion_tokens: result.completionTokens,
            }),
        })

        writeJson({ type: 'reader_batch_done' })

        const labels = defaultReaderLabels()
        const bySlot = new Map(readerOut.map((x) => [x.slot, x.result]))

        const parts = fateProviders.map((slot) => {
          const result = bySlot.get(slot)!
          const t = result.text ?? (result.error ? `[error] ${result.error}` : '')
          return { label: labels[slot], text: t }
        })

        const started = Date.now()
        let synthText: string | null = null
        let pt: number | null = null
        let ct: number | null = null
        try {
          const userPayload = [
            `You have exactly ${parts.length} labelled readings (${parts.map((p) => p.label).join(', ')}).`,
            parts.map((p) => `\n–– ${p.label} ––\n${p.text}\n`).join(''),
          ].join('\n')
          const o = await oracleGptCompletion({
            model: ORACLE_SYNTH_MODEL,
            systemPrompt: applyOracleLanguageToSystemPrompt(
              fateSynthesisSystemPromptExact({
                birthDataLine: birthLine,
                currentDateIso: todayIso,
                languageInstruction,
              }),
              languageSourceText
            ),
            userPrompt: userPayload,
            maxTokens: ORACLE_SYNTH_MAX_TOKENS,
          })
          synthText = o.text
          pt = o.promptTokens
          ct = o.completionTokens
        } catch (e: any) {
          const msg = e?.message ?? 'Synthesis failed'
          const rt = Date.now() - started
          await oracleInsertAiResponse(sessionId, 'openai', ORACLE_SYNTH_MODEL, {
            responseText: null,
            responseTimeMs: rt,
            promptTokens: null,
            completionTokens: null,
            errorText: msg,
          })
          await oracleInsertCostLog({
            sessionId,
            aiName: 'openai',
            modelName: ORACLE_SYNTH_MODEL,
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            responseTimeMs: rt,
            errorText: msg,
          })
          writeJson({ type: 'synthesis', text: null, prompt_tokens: null, completion_tokens: null, response_time_ms: rt })
          writeJson({ type: 'done' })
          controller.close()
          return
        }

        const rt = Date.now() - started
        await oracleInsertAiResponse(sessionId, 'openai', ORACLE_SYNTH_MODEL, {
          responseText: synthText,
          responseTimeMs: rt,
          promptTokens: pt,
          completionTokens: ct,
          errorText: null,
        })
        await oracleInsertCostLog({
          sessionId,
          aiName: 'openai',
          modelName: ORACLE_SYNTH_MODEL,
          promptTokens: pt,
          completionTokens: ct,
          totalTokens: pt != null && ct != null ? pt + ct : null,
          responseTimeMs: rt,
          errorText: null,
        })

        writeJson({ type: 'synthesis', text: synthText, prompt_tokens: pt, completion_tokens: ct, response_time_ms: rt })
        writeJson({ type: 'done' })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Oracle pipeline failed'
        writeJson({ type: 'error', error: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
