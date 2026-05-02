import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  iterateCompareProviderResults,
  MODEL_BY_PROVIDER,
  type AiProviderName,
} from '@/lib/ai/router'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'
import { COMPARE_SYSTEM_PROMPT, creditsPerMessage, deductCreditsBalance } from '@/lib/credits'

function uniqueProviders(providers: AiProviderName[]) {
  return Array.from(new Set(providers)) as AiProviderName[]
}

function buildCustomModeSystemPrompt(optionalUserText: string): string {
  const t = optionalUserText.trim().slice(0, 500)
  if (!t) return COMPARE_SYSTEM_PROMPT
  return `${COMPARE_SYSTEM_PROMPT}\n\nAdditional instructions:\n${t}`
}

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, role: 'user', message_text: prompt }])
  if (!a.error) return
  const b = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, content: prompt, speaker: 'user' }])
  if (b.error) console.warn('[custom] debate_logs user insert:', b.error.message)
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt : ''
  const sessionIdIn = typeof body.sessionId === 'string' ? body.sessionId : null
  const providersRaw = Array.isArray(body.providers) ? body.providers : []
  const providers = uniqueProviders(providersRaw as AiProviderName[])
  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

  const rawTemp = body.temperature
  let temperature = 0.5
  if (typeof rawTemp === 'number' && !Number.isNaN(rawTemp)) {
    temperature = Math.min(1, Math.max(0.1, rawTemp))
  }

  const customRaw =
    typeof body.customSystemPrompt === 'string' ? body.customSystemPrompt.slice(0, 500) : ''

  const systemPrompt = buildCustomModeSystemPrompt(customRaw)

  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!prompt.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }
  if (providers.length < 1) {
    return NextResponse.json({ error: 'Select at least one AI' }, { status: 400 })
  }

  const supabase = createSupabaseWithToken(token)
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  let cost: number
  try {
    cost = creditsPerMessage(providers.length)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid AI count'
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  const deduct = await deductCreditsBalance(supabase, user.id, cost)
  if (!deduct.ok) {
    const insufficient = deduct.reason === 'insufficient'
    return NextResponse.json(
      {
        error: insufficient ? 'Insufficient credits' : 'Could not update credits',
        balance: deduct.balance,
        required: cost,
      },
      { status: insufficient ? 402 : 500 }
    )
  }
  const creditsRemaining = deduct.balance

  let sessionId: string

  if (!sessionIdIn) {
    const ins = await supabase.from('sessions').insert([{ mode: 'custom', prompt }]).select().single()

    if (ins.error || !ins.data?.id) {
      return NextResponse.json(
        { error: ins.error?.message ?? 'Could not start session' },
        { status: 500 }
      )
    }
    sessionId = ins.data.id

    for (const p of providers) {
      const { error: pe } = await supabase.from('session_participants').insert([
        {
          session_id: sessionId,
          ai_name: p,
          model_name: MODEL_BY_PROVIDER[p],
        },
      ])
      if (pe) console.warn('[custom] session_participants:', pe.message)
    }
  } else {
    const { data: existing, error: exErr } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionIdIn)
      .maybeSingle()

    if (exErr || !existing || existing.mode !== 'custom') {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
    }
    sessionId = existing.id
  }

  await insertUserDebateEntry(supabase, sessionId, prompt)

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
          cost,
        })

        const gen = iterateCompareProviderResults({
          prompt,
          systemPrompt,
          providers,
          sessionId,
          supabaseAccessToken: token,
          saveCompareArtifacts: true,
          temperature,
        })

        for await (const result of gen) {
          writeJson({ type: 'result', result })
        }

        writeJson({ type: 'done' })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error'
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
