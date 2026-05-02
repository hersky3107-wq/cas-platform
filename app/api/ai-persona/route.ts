import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  iterateCompareProviderResults,
  MODEL_BY_PROVIDER,
  type AiProviderName,
} from '@/lib/ai/router'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'
import { creditsPerMessage, deductCreditsBalance } from '@/lib/credits'

const MAX_ROLE_CHARS = 200

const AI_DISPLAY_NAME: Record<AiProviderName, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
}

const VALID_PROVIDERS = new Set<AiProviderName>([
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'mistral',
])

function uniqueProviders(providers: AiProviderName[]) {
  return Array.from(new Set(providers)) as AiProviderName[]
}

function normalizeRole(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_ROLE_CHARS)
}

function buildPersonaSystemPrompt(aiDisplayName: string, role: string): string {
  const r = normalizeRole(role)
  return (
    `You are ${aiDisplayName} playing the role of a ${r}. ` +
    `Answer ONLY from this role's perspective. ` +
    `Do NOT be neutral. Do NOT say 'as an AI' or break character. ` +
    `Respond with the biases, priorities, and worldview of a ${r}. ` +
    `Stay in character completely. ` +
    `STRICT LIMIT: Maximum 150 words. Stop writing after 150 words. Be direct and stay in character. ` +
    `Answer in the same language as the user's question.`
  )
}

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, role: 'user', message_text: prompt }])
  if (!a.error) return
  const b = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, content: prompt, speaker: 'user' }])
  if (b.error) console.warn('[persona] debate_logs user insert:', b.error.message)
}

type Assignment = { provider: AiProviderName; role: string }

function parseAssignments(raw: unknown): Assignment[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 6) return null
  const out: Assignment[] = []
  const seen = new Set<AiProviderName>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const rec = item as Record<string, unknown>
    const provider = rec.provider
    const roleRaw = rec.role
    if (typeof provider !== 'string' || !VALID_PROVIDERS.has(provider as AiProviderName)) {
      return null
    }
    if (typeof roleRaw !== 'string') return null
    const role = normalizeRole(roleRaw)
    if (!role) return null
    const p = provider as AiProviderName
    if (seen.has(p)) return null
    seen.add(p)
    out.push({ provider: p, role })
  }
  return out.length ? out : null
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
  const assignments = parseAssignments(body.assignments)
  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  if (!assignments) {
    return NextResponse.json({
      error: 'assignments requires 2–6 unique providers with roles',
    }, { status: 400 })
  }
  if (!prompt.trim()) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const providers = uniqueProviders(assignments.map((a) => a.provider))
  if (providers.length !== assignments.length) {
    return NextResponse.json({ error: 'duplicate provider in assignments' }, { status: 400 })
  }

  const roleByProvider = Object.fromEntries(
    assignments.map((a) => [a.provider, a.role])
  ) as Record<AiProviderName, string>

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
    const ins = await supabase.from('sessions').insert([{ mode: 'persona', prompt }]).select().single()

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
      if (pe) console.warn('[persona] session_participants:', pe.message)
    }
  } else {
    const { data: existing, error: exErr } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionIdIn)
      .maybeSingle()

    if (exErr || !existing || existing.mode !== 'persona') {
      return NextResponse.json({ error: 'Invalid session' }, { status: 400 })
    }
    sessionId = existing.id
  }

  await insertUserDebateEntry(supabase, sessionId, prompt)

  const getSystemPrompt = (provider: AiProviderName) => {
    const name = AI_DISPLAY_NAME[provider]
    const role = roleByProvider[provider]
    return buildPersonaSystemPrompt(name, role)
  }

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
          getSystemPrompt,
          providers,
          sessionId,
          supabaseAccessToken: token,
          saveCompareArtifacts: true,
          maxCompletionTokens: 300,
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
