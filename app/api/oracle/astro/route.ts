import { deductCreditsBalance } from '@/lib/credits-server'
import type { RouterResult } from '@/lib/ai/router'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { oracleInsertAiResponse, oracleInsertCostLog } from '@/lib/oracle/oracle-db'
import { oracleGptCompletion } from '@/lib/oracle/openai-gpt'
import { defaultReaderLabels, oracleRunFiveReaders, readerSideUser } from '@/lib/oracle/exec-readings'
import { ORACLE_SESSION_COST, ORACLE_SYNTH_MAX_TOKENS, ORACLE_SYNTH_MODEL } from '@/lib/oracle/oracle-constants'
import { oracleProfileLooksComplete } from '@/lib/oracle/profile-guard'
import { resolveOracleBirth } from '@/lib/oracle/profile-resolver'
import { westernReaderSystemPrompt } from '@/lib/oracle/oracle-prompts'
import { fetchOracleBirthProfileAdmin } from '@/lib/oracle/users-oracle-storage'
import { geocodeBirthCity } from '@/lib/oracle/geocode'
import { computeWesternChart } from '@/lib/oracle/western-chart'

function jsonResp(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const ASTRO_SYSTEM_LANGUAGE_FIRST_LINE = `Detect the language of the user's question and respond entirely in that language. No exceptions. Do not switch to English even if your system instructions are in English.`

const ASTRO_SYSTEM_LANGUAGE_RULE = `CRITICAL — LANGUAGE RULE (absolute priority):
Detect the language of the user's original question or input.
Write your ENTIRE response in that exact language from first word to last word.
Korean input → 100% Korean response. English input → 100% English response.
This rule applies to every sentence. No exceptions.`

function astroSystemLanguageOverride(detectedLang: string): string {
  return `SYSTEM OVERRIDE: You MUST respond in ${detectedLang} only. 
Do NOT mix in any English words, phrases, or terms — not even technical terms, 
planet names, or astrological terms. 
Translate everything into ${detectedLang}. 
This is absolute. No exceptions.`
}

function astroSynthesisSystemPromptExact(params: {
  birthDataLine: string
  currentDateIso: string
  languageInstruction: string
  detectedLang: string
}): string {
  return `${astroSystemLanguageOverride(params.detectedLang)}

${ASTRO_SYSTEM_LANGUAGE_FIRST_LINE}

${ASTRO_SYSTEM_LANGUAGE_RULE}

${params.languageInstruction}
This overrides everything else. Follow it strictly.

You are a warm fortune reader who has just received readings 
from four other AI readers: Claude, Gemini, Mistral, and DeepSeek.
You also have the person's birth data: ${params.birthDataLine}
Current date: ${params.currentDateIso}

Write in flowing prose only. No headers. No bullet points.

Structure your response naturally like this:

1. Start with your own brief reading of their birth chart 
   (2-3 sentences, specific to their actual birth data).

2. Share where Claude, Gemini, Mistral, and DeepSeek agreed — 
   mention them by name, describe what they said, 
   nothing more. No evaluation.
   Example: "Claude and DeepSeek both said that..."
   Example: "Gemini and Mistral pointed to..."

3. Share where they disagreed or saw things differently — 
   again, just describe what each said by name.
   Example: "Claude focused on... while Mistral felt that..."
   Do NOT say one view is more interesting or unique.

4. Share one thing only one reader mentioned — 
   name that reader and describe what they said.
   Example: "DeepSeek alone mentioned that..."
   Do NOT evaluate or praise this view.

5. End with your own personal message directly to this person,
   grounded in something specific from their birth chart.

CRITICAL RULES:
- Always use exact AI names: Claude, Gemini, Mistral, DeepSeek
- NEVER say "다른 독자", "한 분", "another reader", "one reader"
- NEVER evaluate: no "독특합니다", "흥미롭습니다", "interesting", "unique"
- Just describe what each AI said — let the person decide what resonates
- Warm, simple, conversational language throughout
- No meta-commentary, no language detection notes
- Maximum 1500 tokens
- Never cut off mid-sentence`
}

function detectLanguage(text: string): string {
  if (!text || text.trim().length === 0) return 'English'
  const korean = /[\uAC00-\uD7AF]/
  const japanese = /[\u3040-\u30FF]/
  const chinese = /[\u4E00-\u9FFF]/
  const arabic = /[\u0600-\u06FF]/
  const russian = /[\u0400-\u04FF]/
  if (korean.test(text)) return 'Korean'
  if (japanese.test(text)) return 'Japanese'
  if (chinese.test(text)) return 'Chinese'
  if (arabic.test(text)) return 'Arabic'
  if (russian.test(text)) return 'Russian'
  return 'English'
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

  const userQuestion = questionRaw
  const detectedLang = detectLanguage(userQuestion || '')

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
  const languageInstruction = questionRaw && questionRaw.trim().length > 0
    ? `[ABSOLUTE LANGUAGE RULE — HIGHEST PRIORITY]
You MUST respond ONLY in ${detectedLang}. This overrides ALL other instructions.
Every single sentence must be in ${detectedLang}. No exceptions.
Current date: May 29, 2026.`
    : `The user did not type a question.
Use the birth city language as default.
Seoul → Korean, Tokyo → Japanese, etc.
Current date: May 29, 2026.`

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

  const chart = computeWesternChart({
    dobYmd: profile.dob,
    timeHHMM: rb.timeHHMM,
    latitude: geo.latitude,
    longitude: geo.longitude,
    timezone: geo.timezone,
    geocodeLabel: geo.label,
  })

  const birthDataLine = `date ${profile.dob}; local time approx. ${rb.timeHHMM}; city ${rb.birthCity}; gender ${rb.genderLabel}`
  const chartBlock = [
    `Birth location (resolved): ${chart.geocodeLabel ?? geo.label}`,
    `Local birth datetime: ${profile.dob} ${rb.timeHHMM}`,
    `Instant in UTC terms: ${chart.utcIso}`,
    `Sun (${chart.sunLongitudeDeg.toFixed(2)}° ecliptic): ${chart.sunSign}`,
    `Moon (${chart.moonLongitudeDeg.toFixed(2)}° ecliptic): ${chart.moonSign}`,
    `Ascendant / rising (${chart.ascLongitudeDeg.toFixed(2)}° ecliptic): ${chart.risingSign}`,
  ].join('\n')

  const deduct = await deductCreditsBalance(supabaseAdmin, user.id, ORACLE_SESSION_COST, 'oracle_astro')
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
    .insert([{ mode: 'astro', prompt: sessionPrompt.slice(0, 8000) }])
    .select()
    .single()

  if (ins.error || !ins.data?.id) {
    return jsonResp({ error: ins.error?.message ?? 'Could not start session' }, 500)
  }
  const sessionId = String(ins.data.id)

  const roleByProvider = {
    anthropic: 'psychological and philosophical interpretation',
    google: 'technical accuracy, planetary positions and aspects',
    mistral: 'traditional Western astrology, classical interpretation',
    deepseek: 'historical and mythological context',
  } as const

  const readersSystemPromptFn = (provider: 'anthropic' | 'google' | 'mistral' | 'deepseek') => {
    const roleLine = roleByProvider[provider]
    const base = westernReaderSystemPrompt(chartBlock, questionLine)
    const mistralLangGuard =
      provider === 'mistral'
        ? [
            '',
            'Write entirely in the same language as detected.',
            'Do NOT mix in English words or phrases mid-sentence.',
            'If a word feels technical, translate it fully.',
            'Example: never write "impulsive한" — write "충동적인" instead.',
          ].join('\n')
        : ''
    return `${astroSystemLanguageOverride(detectedLang)}

${ASTRO_SYSTEM_LANGUAGE_FIRST_LINE}

${ASTRO_SYSTEM_LANGUAGE_RULE}

${languageInstruction}
This overrides everything else. Follow it strictly.

Your role: ${roleLine}

${base}
${mistralLangGuard}`
  }

  const userPrompt = readerSideUser('astro')

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
          mode: 'astro',
          western_chart: { sunSign: chart.sunSign, moonSign: chart.moonSign, risingSign: chart.risingSign },
        })

        const astroProviders = ['anthropic', 'google', 'mistral', 'deepseek'] as const
        const readerOut = await oracleRunFiveReaders({
          sessionId,
          readersSystemPromptFn: (p) => readersSystemPromptFn(p as any),
          userPrompt,
          providers: [...astroProviders],
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
        const parts = astroProviders.map((slot) => {
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
            systemPrompt: astroSynthesisSystemPromptExact({
              birthDataLine: birthDataLine,
              currentDateIso: todayIso,
              languageInstruction,
              detectedLang,
            }),
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
