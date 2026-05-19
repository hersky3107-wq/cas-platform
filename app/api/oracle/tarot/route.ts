import { creditsForOracleTarotSpread, type OracleTarotSpreadKey } from '@/lib/credits'
import { deductCreditsBalance } from '@/lib/credits-server'
import type { AiProviderName, RouterResult } from '@/lib/ai/router'
import { runSingleAiProvider, MODEL_BY_PROVIDER } from '@/lib/ai/router'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { oracleInsertAiResponse, oracleInsertCostLog } from '@/lib/oracle/oracle-db'
import { oracleGptCompletion } from '@/lib/oracle/openai-gpt'
import { ORACLE_SESSION_COST, ORACLE_SYNTH_MAX_TOKENS, ORACLE_SYNTH_MODEL } from '@/lib/oracle/oracle-constants'
import { fetchOracleBirthProfileAdmin } from '@/lib/oracle/users-oracle-storage'
import { oracleProfileLooksComplete } from '@/lib/oracle/profile-guard'
import { resolveOracleBirth } from '@/lib/oracle/profile-resolver'

type SpreadKey = OracleTarotSpreadKey

const SPREADS: Record<
  SpreadKey,
  { label: string; count: number; cost: number; positions: string[] }
> = {
  one: {
    label: "Today's Card",
    count: 1,
    cost: creditsForOracleTarotSpread('one'),
    positions: ["Today's message"],
  },
  three: {
    label: 'Past · Present · Future',
    count: 3,
    cost: creditsForOracleTarotSpread('three'),
    positions: ['Past', 'Present', 'Future'],
  },
  five: {
    label: 'Five Card Spread',
    count: 5,
    cost: creditsForOracleTarotSpread('five'),
    positions: ['Situation', 'Obstacle', 'Advice', 'External', 'Outcome'],
  },
  celtic: {
    label: 'Celtic Cross',
    count: 10,
    cost: creditsForOracleTarotSpread('celtic'),
    positions: [
      'The Present',
      'The Challenge',
      'The Past',
      'The Future',
      'Above (Conscious)',
      'Below (Unconscious)',
      'Advice',
      'External Influences',
      'Hopes and Fears',
      'Outcome',
    ],
  },
}

type DeckCard = { id: number; name: string; src: string }
let deckCache: DeckCard[] | null = null

async function loadDeck(): Promise<DeckCard[]> {
  if (deckCache) return deckCache
  const fs = await import('fs/promises')
  const path = await import('path')
  const p = path.join(process.cwd(), 'public', 'tarot', 'deck.json')
  const raw = await fs.readFile(p, 'utf8')
  const j = JSON.parse(raw) as { deck?: Array<{ id: number; name: string; src: string }> }
  deckCache = Array.isArray(j.deck) ? j.deck.map((c) => ({ id: c.id, name: c.name, src: c.src })) : []
  return deckCache
}

function jsonResp(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function ndjsonResp(stream: ReadableStream): Response {
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function languageInstructionFrom(question: string, birthCity: string): string {
  const q = question.trim()
  if (q) {
    return `Detect the language of this question: "${q}" and respond in that exact same language.`
  }
  return `The user did not type a question. Use the birth city language as default. The user was born in ${birthCity}.`
}

function tarotReaderSystemPrompt(params: {
  cardsLine: string
  spreadLabel: string
  question: string
  todayIso: string
  languageInstruction: string
}): string {
  const questionLine = params.question.trim() ? params.question.trim() : '(no question)'
  return `You are reading tarot cards for this person.

Cards drawn: ${params.cardsLine}
Spread type: ${params.spreadLabel}
User question (if any): ${questionLine}
Current date: ${params.todayIso}

${params.languageInstruction}

Read these cards as naturally and freely as you can.
Trust your interpretation — there is no single correct reading.
Speak warmly and directly to this person.
Simple everyday language only. No jargon.
If you use a card name, briefly explain its meaning.
Flowing prose only. No bullet points. No headers.
Maximum 800 tokens.
Decide your closing sentence before you begin.
If approaching the limit, go to that closing sentence immediately.
Never end mid-sentence.`
}

function tarotSynthesisSystemPrompt(params: {
  cardsLine: string
  todayIso: string
  languageInstruction: string
}): string {
  return `You have received tarot readings from Claude, Gemini, and Mistral
for this person's drawn cards: ${params.cardsLine}
Current date: ${params.todayIso}

${params.languageInstruction}

Write in flowing prose. No headers. No bullet points.

Start with your own brief reading of the cards (2-3 sentences).

Then naturally share where Claude, Gemini, and Mistral agreed.
Use their exact names — never say "another reader" or "한 분".

Then share where they saw things differently — 
describe each view by name, no evaluation.

Then mention one thing only one reader said —
name that reader, describe what they said, no praise.

End with your personal message to this person
grounded in the specific cards they drew.

CRITICAL:
- Use exact names: Claude, Gemini, Mistral
- No evaluation language
- Warm, simple, conversational tone
- No meta-commentary
- Maximum 1500 tokens
- Never cut off mid-sentence`
}

async function runReader(params: {
  sessionId: string
  provider: AiProviderName
  systemPrompt: string
  userPrompt: string
  modelOverride?: string
  maxCompletionTokens: number
}): Promise<RouterResult> {
  const r = await runSingleAiProvider({
    supabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: params.provider,
    prompt: params.userPrompt,
    systemPrompt: params.systemPrompt,
    maxCompletionTokens: params.maxCompletionTokens,
    modelOverride: params.modelOverride ?? MODEL_BY_PROVIDER[params.provider],
  })
  const storedAnswer = r.text ?? (r.error ? `[error] ${r.error}` : null)
  await oracleInsertAiResponse(params.sessionId, params.provider, r.model, {
    responseText: storedAnswer,
    responseTimeMs: r.responseTimeMs,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    errorText: r.error ?? null,
  })
  await oracleInsertCostLog({
    sessionId: params.sessionId,
    aiName: params.provider,
    modelName: r.model,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    totalTokens: r.totalTokens,
    responseTimeMs: r.responseTimeMs,
    errorText: r.error ?? null,
  })
  return r
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return jsonResp({ error: 'Invalid JSON' }, 400)
  }

  const stage = typeof body.stage === 'string' ? body.stage : 'read'
  const spread = typeof body.spread === 'string' ? (body.spread as SpreadKey) : null
  if (!spread || !(spread in SPREADS)) {
    return jsonResp({ error: 'spread is required (one|three|five|celtic)' }, 400)
  }

  const { user, error: authErr } = await resolveRouteAuth(req)
  if (authErr || !user) return jsonResp({ error: 'Invalid session' }, 401)

  const { v1: profile, error: profErr } = await fetchOracleBirthProfileAdmin(user.id)
  if (profErr) return jsonResp({ error: 'Could not load birth profile' }, 500)
  if (!profile || !oracleProfileLooksComplete(profile)) {
    return jsonResp({ error: 'Complete your Oracle birth profile first.', code: 'profile_incomplete' }, 400)
  }

  const rb = resolveOracleBirth(profile)
  if (!rb) return jsonResp({ error: 'Invalid stored birth profile' }, 400)

  const s = SPREADS[spread]

  if (stage === 'start') {
    const deduct = await deductCreditsBalance(supabaseAdmin, user.id, s.cost)
    if (!deduct.ok) {
      const insufficient = deduct.reason === 'insufficient'
      return jsonResp(
        {
          error: insufficient
            ? `This spread costs ${s.cost} credits. You have ${deduct.balance}.`
            : 'Could not update credits. Please try again.',
          balance: deduct.balance,
          required: s.cost,
        },
        insufficient ? 402 : 500
      )
    }

    const prompt = `tarot spread=${spread} (${s.label}); cards_pending=${s.count}`
    const ins = await supabaseAdmin.from('sessions').insert([{ mode: 'tarot', prompt }]).select().single()
    if (ins.error || !ins.data?.id) {
      return jsonResp({ error: ins.error?.message ?? 'Could not start session' }, 500)
    }

    return jsonResp({
      ok: true,
      sessionId: String(ins.data.id),
      cost: s.cost,
      creditsRemaining: deduct.balance,
      spread,
      count: s.count,
      label: s.label,
    }, 200)
  }

  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : null
  if (!sessionId) return jsonResp({ error: 'sessionId required' }, 400)

  const question = typeof body.question === 'string' ? body.question : ''
  const languageInstruction = languageInstructionFrom(question, rb.birthCity)
  const todayIso = new Date().toISOString().split('T')[0]

  const cardIds = Array.isArray(body.cardIds) ? body.cardIds : null
  if (!cardIds || cardIds.length !== s.count) {
    return jsonResp({ error: `cardIds must have length ${s.count}` }, 400)
  }
  const ids = cardIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n >= 0 && n < 78)
  if (ids.length !== s.count) return jsonResp({ error: 'Invalid cardIds' }, 400)

  const deck = await loadDeck()
  const picked = ids.map((id, i) => ({ pos: s.positions[i]!, card: deck[id]! }))
  const cardsLine = picked.map((p) => `${p.pos}: ${p.card.name}`).join(' | ')

  await supabaseAdmin.from('sessions').update({
    prompt: `tarot spread=${spread} (${s.label}); ${cardsLine}`,
  }).eq('id', sessionId)

  const userPrompt = 'Deliver your tarot reading now, following every rule above.'
  const providers = [
    { provider: 'anthropic' as const, name: 'Claude', modelOverride: 'claude-sonnet-4-6' },
    { provider: 'google' as const, name: 'Gemini', modelOverride: 'gemini-2.5-flash' },
    { provider: 'mistral' as const, name: 'Mistral', modelOverride: 'mistral-large-latest' },
  ]

  // Set max_tokens based on spread size BEFORE calling AIs
  const cardCount = s.count
  const maxTokens =
    cardCount === 1
      ? 700
      : cardCount === 3
        ? 900
        : cardCount === 5
          ? 1200
          : cardCount === 10
            ? 1800
            : 900

  const topPromptLine = `This is a ${cardCount}-card spread.\nYou have ${maxTokens} tokens total.\nPrioritize the most important cards.\nEnd with a complete closing sentence.\nNever cut off mid-sentence or mid-word.`

  const honestReadingBlock = `IMPORTANT — Honest reading:
If a card carries difficult, warning, or challenging energy, 
say so clearly and directly. Do NOT immediately soften or 
reframe it into something positive.

Acknowledge the difficulty first:
"This card is a warning..." or 
"This is a genuinely hard card to see here..."

Then offer practical advice on how to navigate it:
"Here's what you can do..." or
"The way through this is..."

Never pretend a hard card is secretly good.
Never skip over the warning to get to hope faster.
A honest reading that helps someone prepare is 
far more valuable than false comfort.`

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const writeJson = (obj: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
      try {
        writeJson({
          type: 'meta',
          sessionId,
          spread,
          label: s.label,
          positions: s.positions,
          cards: picked.map((p) => ({ position: p.pos, id: p.card.id, name: p.card.name, src: p.card.src })),
        })

        const jobs = providers.map(async (p) => {
          let sys = tarotReaderSystemPrompt({
            cardsLine,
            spreadLabel: s.label,
            question,
            todayIso,
            languageInstruction,
          })
          sys = `${topPromptLine}\n\n${honestReadingBlock}\n\n${sys}`
          const r = await runReader({
            sessionId,
            provider: p.provider,
            systemPrompt: sys,
            userPrompt,
            modelOverride: p.modelOverride,
            maxCompletionTokens: maxTokens,
          })
          writeJson({
            type: 'reader_result',
            slot: p.provider,
            text: r.text,
            error: r.error ?? null,
            response_time_ms: r.responseTimeMs,
          })
          return { p, r }
        })

        const readerResults = await Promise.all(jobs)

        const parts = readerResults.map(({ p, r }) => ({
          label: p.name,
          text: r.text ?? (r.error ? `[error] ${r.error}` : ''),
        }))

        const started = Date.now()
        const synth = await oracleGptCompletion({
          model: ORACLE_SYNTH_MODEL,
          systemPrompt: tarotSynthesisSystemPrompt({ cardsLine, todayIso, languageInstruction }),
          userPrompt: [
            `Cards: ${cardsLine}`,
            `Spread: ${s.label}`,
            `User question: ${question || '(none)'}`,
            '',
            parts.map((p) => `–– ${p.label} ––\n${p.text}\n`).join('\n'),
          ].join('\n'),
          maxTokens: ORACLE_SYNTH_MAX_TOKENS,
        })
        const rt = Date.now() - started

        await oracleInsertAiResponse(sessionId, 'openai', ORACLE_SYNTH_MODEL, {
          responseText: synth.text,
          responseTimeMs: rt,
          promptTokens: synth.promptTokens,
          completionTokens: synth.completionTokens,
          errorText: null,
        })
        await oracleInsertCostLog({
          sessionId,
          aiName: 'openai',
          modelName: ORACLE_SYNTH_MODEL,
          promptTokens: synth.promptTokens,
          completionTokens: synth.completionTokens,
          totalTokens:
            synth.promptTokens != null && synth.completionTokens != null
              ? synth.promptTokens + synth.completionTokens
              : null,
          responseTimeMs: rt,
          errorText: null,
        })

        writeJson({ type: 'synthesis', text: synth.text, response_time_ms: rt })
        writeJson({ type: 'done' })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Tarot pipeline failed'
        writeJson({ type: 'error', error: msg })
      } finally {
        controller.close()
      }
    },
  })

  return ndjsonResp(stream)
}

