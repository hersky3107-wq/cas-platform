import { deductCreditsBalance } from '@/lib/credits'
import type { AiProviderName, RouterResult } from '@/lib/ai/router'
import { MODEL_BY_PROVIDER, runSingleAiProvider } from '@/lib/ai/router'
import { createSupabaseRouteAuthClient } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { oracleInsertAiResponse, oracleInsertCostLog } from '@/lib/oracle/oracle-db'
import { oracleGptCompletion } from '@/lib/oracle/openai-gpt'
import { fetchOracleBirthProfileAdmin } from '@/lib/oracle/users-oracle-storage'
import { oracleProfileLooksComplete } from '@/lib/oracle/profile-guard'
import { resolveOracleBirth } from '@/lib/oracle/profile-resolver'
import { geocodeBirthCity } from '@/lib/oracle/geocode'
import { computeWesternChart } from '@/lib/oracle/western-chart'

const DAILY_COST = 3

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

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return h
}

function languageInstructionFrom(birthCity: string): string {
  return `The user did not type a question. Use the birth city language as default. The user was born in ${birthCity}.`
}

async function runAndStore(params: {
  sessionId: string
  provider: AiProviderName
  systemPrompt: string
  userPrompt: string
  maxTokens: number
  modelOverride?: string
}): Promise<RouterResult> {
  const r = await runSingleAiProvider({
    supabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: params.provider,
    prompt: params.userPrompt,
    systemPrompt: params.systemPrompt,
    maxCompletionTokens: params.maxTokens,
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

export async function POST() {
  const supabaseAuth = await createSupabaseRouteAuthClient()
  const {
    data: { user },
    error: authErr,
  } = await supabaseAuth.auth.getUser()
  if (authErr || !user) return jsonResp({ error: 'Invalid session' }, 401)

  const { v1: profile, error: profErr } = await fetchOracleBirthProfileAdmin(user.id)
  if (profErr) return jsonResp({ error: 'Could not load birth profile' }, 500)
  if (!profile || !oracleProfileLooksComplete(profile)) {
    return jsonResp({ error: 'Complete your Oracle birth profile first.', code: 'profile_incomplete' }, 400)
  }

  const rb = resolveOracleBirth(profile)
  if (!rb) return jsonResp({ error: 'Invalid stored birth profile' }, 400)

  const today = new Date().toISOString().split('T')[0]
  const dailySeed = new Date().toDateString()
  const deck = await loadDeck()
  if (deck.length !== 78) return jsonResp({ error: 'Tarot deck not available' }, 500)

  const cardIndexRaw = hashCode(`${dailySeed}${user.id}`) % 78
  const cardIndex = ((cardIndexRaw % 78) + 78) % 78
  const card = deck[cardIndex]!

  const geo = await geocodeBirthCity(profile.birth_city)
  if (!geo) {
    return jsonResp(
      { error: 'Could not find that birth city. Try spelling it differently or pick a nearby city.', code: 'geocode_failed' },
      422
    )
  }
  if (!geo.timezone) {
    return jsonResp(
      { error: 'Timezone could not be resolved for this place. Pick a clearer city name.', code: 'timezone_missing' },
      422
    )
  }

  const natal = computeWesternChart({
    dobYmd: profile.dob,
    timeHHMM: rb.timeHHMM,
    latitude: geo.latitude,
    longitude: geo.longitude,
    timezone: geo.timezone,
    geocodeLabel: geo.label,
  })

  const languageInstruction = languageInstructionFrom(rb.birthCity)
  const birthDataLine = `date ${profile.dob}; local time approx. ${rb.timeHHMM}; city ${rb.birthCity}; gender ${rb.genderLabel}`

  const deduct = await deductCreditsBalance(supabaseAdmin, user.id, DAILY_COST)
  if (!deduct.ok) {
    const insufficient = deduct.reason === 'insufficient'
    return jsonResp(
      {
        error: insufficient
          ? `This daily fortune costs ${DAILY_COST} credits. You have ${deduct.balance}.`
          : 'Could not update credits. Please try again.',
        balance: deduct.balance,
        required: DAILY_COST,
      },
      insufficient ? 402 : 500
    )
  }
  const creditsRemaining = deduct.balance

  const prompt = `daily date=${today}; tarot=${card.name}`
  const ins = await supabaseAdmin.from('sessions').insert([{ mode: 'daily', prompt }]).select().single()
  if (ins.error || !ins.data?.id) return jsonResp({ error: ins.error?.message ?? 'Could not start session' }, 500)
  const sessionId = String(ins.data.id)

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const writeJson = (obj: unknown) => controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
      try {
        writeJson({
          type: 'meta',
          sessionId,
          cost: DAILY_COST,
          creditsRemaining,
          today,
          tarot: { id: card.id, name: card.name, src: card.src },
          western_chart: { sunSign: natal.sunSign, moonSign: natal.moonSign, risingSign: natal.risingSign },
        })

        const deepseekSys = `Detect the language of the user's birth city and respond in that language.
If birth city is in Korea → respond in Korean.
If birth city is in Japan → respond in Japanese.
If birth city is in an English-speaking country → respond in English.
Do NOT respond in English if the birth city is Korean.
This instruction overrides everything else.
You are reading today's fortune through Eastern astrology (사주/일진).
Birth data: ${birthDataLine}
Today's date: ${today}

${languageInstruction}

Calculate today's day pillar (일진) based on the birth chart and today's date.
Read how today's energy interacts with this person's birth chart.
Be specific to TODAY — not general life advice.
Give practical guidance for today: what to embrace, what to avoid.
Honest reading — if today's energy is difficult, say so clearly.
Warm, simple language. No jargon.
Flowing prose only. No bullet points. No headers.
Maximum 500 tokens. Complete your response fully.
Never end mid-sentence.`

        const geminiSys = `You are reading today's fortune through Western astrology.
Birth data: ${birthDataLine}
Sun sign: ${natal.sunSign} Moon sign: ${natal.moonSign} Rising: ${natal.risingSign}
Today's date: ${today}

${languageInstruction}

Read today's planetary transits and how they affect this person's chart today.
Be specific to TODAY — not general life advice.
Give practical guidance for today: what energy to work with, what to watch out for.
Honest reading — if today's transits are challenging, say so clearly.
Warm, simple language. No jargon.
Flowing prose only. No bullet points. No headers.
Maximum 500 tokens. Complete your response fully.
Never end mid-sentence.`

        const claudeSys = `You are reading today's fortune through a single tarot card.
Card drawn: ${card.name}
Birth data: ${birthDataLine}
Today's date: ${today}

${languageInstruction}

Read this card as today's message for this person.
Connect it to what they might face or feel today specifically.
Honest reading — if the card carries warning energy, say so directly first.
Then give practical advice for navigating today with this energy.
Warm, simple language. No jargon.
Flowing prose only. No bullet points. No headers.
Maximum 500 tokens. Complete your response fully.
Never end mid-sentence.`

        const userPrompt = 'Write the reading now.'

        const jobs = [
          { provider: 'deepseek' as const, name: 'DeepSeek', sys: deepseekSys, max: 500, modelOverride: 'deepseek-chat' },
          { provider: 'google' as const, name: 'Gemini', sys: geminiSys, max: 500, modelOverride: 'gemini-2.5-flash' },
          { provider: 'anthropic' as const, name: 'Claude', sys: claudeSys, max: 500, modelOverride: 'claude-sonnet-4-6' },
        ].map(async (j) => {
          const r = await runAndStore({
            sessionId,
            provider: j.provider,
            systemPrompt: j.sys,
            userPrompt,
            maxTokens: j.max,
            modelOverride: j.modelOverride,
          })
          writeJson({ type: 'reader_result', slot: j.provider, text: r.text, error: r.error ?? null, response_time_ms: r.responseTimeMs })
          return { j, r }
        })

        const results = await Promise.all(jobs)
        const byName: Record<string, string> = {}
        for (const { j, r } of results) {
          byName[j.name] = r.text ?? (r.error ? `[error] ${r.error}` : '')
        }

        const synthPrompt = `You have received three readings for today:
- Eastern astrology (DeepSeek): ${byName.DeepSeek}
- Western astrology (Gemini): ${byName.Gemini}
- Tarot card — ${card.name} (Claude): ${byName.Claude}

Birth data: ${birthDataLine}
Today's date: ${today}

${languageInstruction}

Write a warm, personal daily fortune synthesis in flowing prose.

Start with your own sense of today's overall energy (2 sentences).
Then share where DeepSeek, Gemini, and Claude agreed about today.
Then share where they saw today differently — by name.
End with one clear, practical message for how to approach today.

CRITICAL:
- Use exact names: DeepSeek, Gemini, Claude
- NEVER say \"another reader\" or \"한 분\"
- No evaluation language
- Specific to TODAY, not general life advice
- Maximum 1000 tokens
- Never cut off mid-sentence`

        const started = Date.now()
        const synth = await oracleGptCompletion({
          model: 'gpt-4.1',
          systemPrompt: 'You are a warm daily fortune writer. Follow the user instructions exactly.',
          userPrompt: synthPrompt,
          maxTokens: 1000,
        })
        const rt = Date.now() - started

        await oracleInsertAiResponse(sessionId, 'openai', 'gpt-4.1', {
          responseText: synth.text,
          responseTimeMs: rt,
          promptTokens: synth.promptTokens,
          completionTokens: synth.completionTokens,
          errorText: null,
        })
        await oracleInsertCostLog({
          sessionId,
          aiName: 'openai',
          modelName: 'gpt-4.1',
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
        const msg = e instanceof Error ? e.message : 'Daily pipeline failed'
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

