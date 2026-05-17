import { deductCreditsBalance } from '@/lib/credits'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import type { RouterResult } from '@/lib/ai/router'
import {
  oracleRunFiveReaders,
  oracleRunSynth,
  defaultReaderLabels,
  readerSideUser,
} from '@/lib/oracle/exec-readings'
import { fateReaderSystemPrompt, westernReaderSystemPrompt } from '@/lib/oracle/oracle-prompts'
import { ORACLE_READER_ORDER, ORACLE_SESSION_COST } from '@/lib/oracle/oracle-constants'
import type { OracleBirthProfileV1 } from '@/lib/oracle/types'
import { oracleProfileLooksComplete } from '@/lib/oracle/profile-guard'
import { fateBirthLine, resolveOracleBirth } from '@/lib/oracle/profile-resolver'
import { fetchOracleBirthProfileAdmin } from '@/lib/oracle/users-oracle-storage'
import { geocodeBirthCity } from '@/lib/oracle/geocode'
import { computeWesternChart } from '@/lib/oracle/western-chart'

function jsonResp(obj: unknown, status: number): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function handleOracleNdjson(req: Request, mode: 'fate' | 'astro'): Promise<Response> {
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

  if (profErr) {
    return jsonResp({ error: 'Could not load birth profile' }, 500)
  }

  if (!profile || !oracleProfileLooksComplete(profile)) {
    return jsonResp(
      {
        error: 'Complete your Oracle birth profile before running a reading.',
        code: 'profile_incomplete',
      },
      400
    )
  }

  const rb = resolveOracleBirth(profile)
  if (!rb) return jsonResp({ error: 'Invalid stored birth profile' }, 400)

  const todayIso = new Date().toISOString().split('T')[0]
  const currentYear = new Date().getFullYear()
  const languageInstruction = questionRaw
    ? `Detect the language of this question: "${questionRaw}" and respond in that exact same language.`
    : `The user was born in ${rb.birthCity}. Respond in the most appropriate language for that region. For example: Seoul/Korea → Korean, Tokyo/Japan → Japanese, Paris/France → French, anywhere English-speaking → English. Use your judgment based on the city.`
  const fatePromptAdditions = [
    languageInstruction,
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

  let westernBlock: string | null = null
  let astroPlacements: { sunSign: string; moonSign: string; risingSign: string } | null =
    null

  if (mode === 'astro') {
    const geo = await geocodeBirthCity(profile.birth_city)
    if (!geo) {
      return jsonResp(
        {
          error: 'Could not find that birth city. Try spelling it differently or pick a nearby city.',
          code: 'geocode_failed',
        },
        422
      )
    }
    if (!geo.timezone) {
      return jsonResp(
        {
          error: 'Timezone could not be resolved for this place. Pick a clearer city name.',
          code: 'timezone_missing',
        },
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

    westernBlock = [
      `Birth location (resolved): ${chart.geocodeLabel ?? geo.label}`,
      `Local birth datetime: ${profile.dob} ${rb.timeHHMM}`,
      `Instant in UTC terms: ${chart.utcIso}`,
      `Sun (${chart.sunLongitudeDeg.toFixed(2)}° ecliptic): ${chart.sunSign}`,
      `Moon (${chart.moonLongitudeDeg.toFixed(2)}° ecliptic): ${chart.moonSign}`,
      `Ascendant / rising (${chart.ascLongitudeDeg.toFixed(2)}° ecliptic): ${chart.risingSign}`,
    ].join('\n')

    astroPlacements = {
      sunSign: chart.sunSign,
      moonSign: chart.moonSign,
      risingSign: chart.risingSign,
    }
  }

  const deduct = await deductCreditsBalance(supabaseAdmin, user.id, ORACLE_SESSION_COST)
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
    .insert([
      {
        mode,
        prompt: sessionPrompt.slice(0, 8000),
      },
    ])
    .select()
    .single()

  if (ins.error || !ins.data?.id) {
    return jsonResp({ error: ins.error?.message ?? 'Could not start session' }, 500)
  }

  const sessionId = String(ins.data.id)

  const birthLine = fateBirthLine(rb)
  const readersPromptFn = (provider: 'anthropic' | 'google' | 'xai' | 'deepseek' | 'mistral' | 'openai') => {
    const base =
      mode === 'fate'
        ? fateReaderSystemPrompt(birthLine, questionLine)
        : westernReaderSystemPrompt(westernBlock!, questionLine)
    if (mode !== 'fate') return base

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

  const userPrompt = readerSideUser(mode)

  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const writeJson = (obj: unknown) => {
        controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
      }

      try {
        writeJson({
          type: 'meta',
          sessionId,
          creditsRemaining,
          cost: ORACLE_SESSION_COST,
          mode,
          ...(astroPlacements
            ? { western_chart: astroPlacements }
            : {}),
        })

        const fateProviders = ['anthropic', 'google', 'xai', 'deepseek'] as const
        const readerOut = await oracleRunFiveReaders({
          sessionId,
          readersSystemPromptFn: (provider) => readersPromptFn(provider),
          userPrompt,
          ...(mode === 'fate'
            ? {
                providers: [...fateProviders],
                maxTokensByProvider: { anthropic: 900 },
                modelOverrideByProvider: { anthropic: 'claude-sonnet-4-6' },
              }
            : {}),
          onReaderDone: ({
            slot,
            result,
          }: {
            slot: (typeof ORACLE_READER_ORDER)[number]
            result: RouterResult
          }) =>
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

        const slots = mode === 'fate' ? [...fateProviders] : ORACLE_READER_ORDER
        const parts = slots.map((slot) => {
          const result = bySlot.get(slot)!
          const t = result.text ?? (result.error ? `[error] ${result.error}` : '')
          return {
            label: labels[slot],
            text: t,
          }
        })

        const synth = await oracleRunSynth({
          sessionId,
          parts,
          birthDataLine: birthLine,
          currentDateIso: todayIso,
          languageInstruction,
        })

        writeJson({
          type: 'synthesis',
          text: synth.text,
          prompt_tokens: synth.promptTokens,
          completion_tokens: synth.completionTokens,
          response_time_ms: synth.rt,
        })

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
