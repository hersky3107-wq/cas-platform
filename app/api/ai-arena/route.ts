import type { SupabaseClient } from '@supabase/supabase-js'
import { MODEL_BY_PROVIDER } from '@/lib/ai/router'
import {
  ARENA_TO_PROVIDER,
  arenaBattleApiCallCount,
  resetArenaTurnCounter,
  runArenaRound,
  runArenaRound1,
  type ArenaAI,
  type ArenaResponse,
  type ArenaRound,
  type ArenaTransportContext,
} from '@/lib/ai/arena-engine'
import { createSupabaseWithToken } from '@/lib/supabase/server-client'
import { creditsPerMessage, deductCreditsBalance, getCreditsBalance } from '@/lib/credits'

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const primaryRes = await supabase.from(table).insert([primary])
  if (!primaryRes.error) return { ok: true as const }
  const fallbackRes = await supabase.from(table).insert([fallback])
  if (!fallbackRes.error) return { ok: true as const }
  return {
    ok: false as const,
    primaryError: primaryRes.error.message,
    fallbackError: fallbackRes.error.message,
  }
}

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, role: 'user', message_text: prompt }])
  if (!a.error) return
  const b = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, content: prompt, speaker: 'user' }])
  if (b.error) console.warn('[arena] debate_logs user insert:', b.error.message)
}

const ARENA_AI_LIST: ArenaAI[] = ['grok', 'gpt', 'gemini', 'deepseek', 'mistral', 'claude']

function parseArenaAiList(raw: unknown): ArenaAI[] {
  if (!Array.isArray(raw)) return []
  const out: ArenaAI[] = []
  for (const x of raw) {
    if (typeof x === 'string' && (ARENA_AI_LIST as string[]).includes(x)) {
      out.push(x as ArenaAI)
    }
  }
  return Array.from(new Set(out))
}


function normalizeArenaRounds(raw: unknown): ArenaRound[] {
  if (!Array.isArray(raw)) return []
  const out: ArenaRound[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const rn = typeof r.roundNumber === 'number' ? r.roundNumber : Number(r.roundNumber)
    if (!Number.isFinite(rn)) continue
    const responses = Array.isArray(r.responses) ? (r.responses as ArenaResponse[]) : []
    const sides = r.sides as Record<string, unknown> | undefined
    const left = Array.isArray(sides?.left) ? (sides!.left as ArenaAI[]) : []
    const right = Array.isArray(sides?.right) ? (sides!.right as ArenaAI[]) : []
    const champ = r.champion as Record<string, unknown> | undefined
    out.push({
      roundNumber: rn,
      responses,
      sides: { left, right },
      champion: {
        left: (champ?.left as ArenaAI | null) ?? null,
        right: (champ?.right as ArenaAI | null) ?? null,
      },
    })
  }
  return out
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const token = typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

  if (!token) {
    return Response.json({ error: 'Authentication required' }, { status: 401 })
  }

  const supabase = createSupabaseWithToken(token)
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) {
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }

  if (action === 'vote') {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const chosen = typeof body.chosenAi === 'string' ? body.chosenAi : ''
    if (!sessionId || !(ARENA_AI_LIST as string[]).includes(chosen)) {
      return Response.json({ error: 'sessionId and chosenAi are required' }, { status: 400 })
    }

    const { data: existing, error: exErr } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', sessionId)
      .maybeSingle()

    if (exErr || !existing || existing.mode !== 'arena') {
      return Response.json({ error: 'Invalid session' }, { status: 400 })
    }

    const primary: Record<string, unknown> = {
      session_id: sessionId,
      user_id: user.id,
      category: 'arena_user_pick',
      vote_choice: chosen,
    }
    const fallback: Record<string, unknown> = {
      session_id: sessionId,
      user_id: user.id,
      category: 'arena_user_pick',
      choice: chosen,
    }
    const r = await insertWithFallback(supabase, 'votes', primary, fallback)
    if (!r.ok) {
      console.warn('[arena] votes insert:', r.primaryError, r.fallbackError)
    }

    await supabase.from('user_selections').insert([
      {
        session_id: sessionId,
        user_id: user.id,
        category: 'arena_complete',
        reason: `picked:${chosen}`,
      },
    ])

    return Response.json({ ok: true })
  }

  if (action !== 'start' && action !== 'battle') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
  const sessionIdIn = typeof body.sessionId === 'string' ? body.sessionId : null
  const selectedAIs = parseArenaAiList(body.selectedAIs)

  if (!topic) {
    return Response.json({ error: 'topic is required' }, { status: 400 })
  }

  if (action === 'start') {
    if (selectedAIs.length < 3 || selectedAIs.length > 6) {
      return Response.json({ error: 'Select between 3 and 6 AIs' }, { status: 400 })
    }
  }

  const battleRoundNumber =
    action === 'battle' && typeof body.roundNumber === 'number' && body.roundNumber >= 2
      ? Math.floor(body.roundNumber)
      : 2

  let cost = 0
  try {
    if (action === 'start') {
      cost = 0
    } else if (battleRoundNumber <= 3) {
      cost = 0
    } else {
      const roundsForCost = normalizeArenaRounds(body.rounds)
      const r1 = roundsForCost.find((x) => x.roundNumber === 1)
      cost = creditsPerMessage(arenaBattleApiCallCount(r1))
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid AI count'
    return Response.json({ error: msg }, { status: 400 })
  }

  let creditsRemaining: number | null = null
  if (cost > 0) {
    const deduct = await deductCreditsBalance(supabase, user.id, cost)
    if (!deduct.ok) {
      const insufficient = deduct.reason === 'insufficient'
      return Response.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deduct.balance,
          required: cost,
        },
        { status: insufficient ? 402 : 500 }
      )
    }
    creditsRemaining = deduct.balance
  } else {
    creditsRemaining = await getCreditsBalance(supabase, user.id)
  }

  let sessionId: string

  if (action === 'start') {
    if (!sessionIdIn) {
      const ins = await supabase
        .from('sessions')
        .insert([{ mode: 'arena', prompt: topic }])
        .select()
        .single()

      if (ins.error || !ins.data?.id) {
        return Response.json(
          { error: ins.error?.message ?? 'Could not start session' },
          { status: 500 }
        )
      }
      sessionId = ins.data.id

      for (const ai of selectedAIs) {
        const p = ARENA_TO_PROVIDER[ai]
        const { error: pe } = await supabase.from('session_participants').insert([
          {
            session_id: sessionId,
            ai_name: p,
            model_name: MODEL_BY_PROVIDER[p],
          },
        ])
        if (pe) console.warn('[arena] session_participants:', pe.message)
      }
    } else {
      const { data: existing, error: exErr } = await supabase
        .from('sessions')
        .select('id, mode')
        .eq('id', sessionIdIn)
        .maybeSingle()

      if (exErr || !existing || existing.mode !== 'arena') {
        return Response.json({ error: 'Invalid session' }, { status: 400 })
      }
      sessionId = existing.id
    }

    await insertUserDebateEntry(supabase, sessionId, topic)

    const enc = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const writeJson = (obj: unknown) => {
          controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
        }

        try {
          resetArenaTurnCounter()
          writeJson({
            type: 'meta',
            sessionId,
            creditsRemaining,
            cost,
            action: 'start',
          })

          const ctx: ArenaTransportContext = {
            supabase,
            sessionId,
            userId: user.id,
            supabaseAccessToken: token,
          }

          const round1 = await runArenaRound1(
            topic,
            selectedAIs,
            ctx,
            (response) => {
              writeJson({ type: 'arena_response', roundNumber: 1, response })
            },
            (ai) => {
              writeJson({ type: 'arena_thinking', roundNumber: 1, ai })
            }
          )

          writeJson({ type: 'arena_round', round: round1 })
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

  const battleSessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!battleSessionId) {
    return Response.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const { data: existing, error: exErr } = await supabase
    .from('sessions')
    .select('id, mode')
    .eq('id', battleSessionId)
    .maybeSingle()

  if (exErr || !existing || existing.mode !== 'arena') {
    return Response.json({ error: 'Invalid session' }, { status: 400 })
  }
  sessionId = existing.id

  const roundNumber = battleRoundNumber

  const rounds = normalizeArenaRounds(body.rounds)
  if (rounds.length === 0) {
    return Response.json({ error: 'rounds payload is required' }, { status: 400 })
  }

  const leftRaw = typeof body.championLeft === 'string' ? body.championLeft : ''
  const rightRaw = typeof body.championRight === 'string' ? body.championRight : ''
  if (!(ARENA_AI_LIST as string[]).includes(leftRaw) || !(ARENA_AI_LIST as string[]).includes(rightRaw)) {
    return Response.json({ error: 'championLeft and championRight must be valid arena AIs' }, { status: 400 })
  }

  const currentSides = { left: leftRaw as ArenaAI, right: rightRaw as ArenaAI }

  await insertUserDebateEntry(supabase, sessionId, `[arena round ${roundNumber}] ${topic}`)

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const writeJson = (obj: unknown) => {
        controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
      }

      try {
        resetArenaTurnCounter()
        writeJson({
          type: 'meta',
          sessionId,
          creditsRemaining,
          cost,
          action: 'battle',
          roundNumber,
        })

        const ctx: ArenaTransportContext = {
          supabase,
          sessionId,
          userId: user.id,
          supabaseAccessToken: token,
        }

        const round = await runArenaRound(
          roundNumber,
          topic,
          rounds,
          currentSides,
          ctx,
          (response) => {
            writeJson({ type: 'arena_response', roundNumber, response })
          },
          (ai) => {
            writeJson({ type: 'arena_thinking', roundNumber, ai })
          }
        )

        writeJson({ type: 'arena_round', round })
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
