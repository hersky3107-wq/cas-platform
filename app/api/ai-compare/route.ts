import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  iterateCompareProviderResults,
  MODEL_BY_PROVIDER,
  type AiProviderName,
  type CompareConversationMessage,
} from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { COMPARE_SYSTEM_PROMPT, creditsPerMessage, deductCreditsBalance } from '@/lib/credits'

function uniqueProviders(providers: AiProviderName[]) {
  return Array.from(new Set(providers)) as AiProviderName[]
}

const VALID_PROVIDERS = new Set<AiProviderName>([
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'mistral',
])

function parseConversationHistory(raw: unknown): CompareConversationMessage[] {
  if (!Array.isArray(raw)) return []
  const out: CompareConversationMessage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    if (o.role !== 'user') continue
    const content = typeof o.content === 'string' ? o.content.trim() : ''
    if (!content) continue
    const aiResponses: Partial<Record<AiProviderName, string>> = {}
    if (o.aiResponses && typeof o.aiResponses === 'object') {
      for (const [k, v] of Object.entries(o.aiResponses as Record<string, unknown>)) {
        if (VALID_PROVIDERS.has(k as AiProviderName) && typeof v === 'string') {
          aiResponses[k as AiProviderName] = v
        }
      }
    }
    out.push({ role: 'user', content, aiResponses })
  }
  return out.slice(-10)
}

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, role: 'user', message_text: prompt }])
  if (!a.error) return
  const b = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, content: prompt, speaker: 'user' }])
  if (b.error) console.warn('[compare] debate_logs user insert:', b.error.message)
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
  const conversationHistory = parseConversationHistory(body.conversationHistory)

  if (!prompt.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }
  if (providers.length < 1) {
    return NextResponse.json({ error: 'Select at least one AI' }, { status: 400 })
  }

  const { user, error: authErr } = await resolveRouteAuth(req, body)
  const supabase = supabaseAdmin
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
    const ins = await supabase.from('sessions').insert([{ mode: 'compare', prompt }]).select().single()

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
      if (pe) console.warn('[compare] session_participants:', pe.message)
    }
  } else {
    const { data: existing, error: exErr } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionIdIn)
      .maybeSingle()

    if (exErr || !existing || existing.mode !== 'compare') {
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
          systemPrompt: COMPARE_SYSTEM_PROMPT,
          providers,
          sessionId,
          supabaseAccessToken: token,
          saveCompareArtifacts: true,
          temperature: 0.7,
          maxCompletionTokens: 900,
          conversationHistory,
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
