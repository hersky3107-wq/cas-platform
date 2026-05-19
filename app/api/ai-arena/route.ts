import type { SupabaseClient } from '@supabase/supabase-js'
import { MODEL_BY_PROVIDER } from '@/lib/ai/router'
import {
  ARENA_TO_PROVIDER,
  resetArenaTurnCounter,
  runArenaRound,
  runArenaRound1,
  type ArenaAI,
  type ArenaFightMode,
  type ArenaMemoryEntry,
  type ArenaResponse,
  type ArenaRound,
  type ArenaTransportContext,
} from '@/lib/ai/arena-engine'
import {
  arenaExtendedBundleCreditCost,
  arenaFinalBundleCreditCost,
  signArenaExtendedBundleToken,
  signArenaFinalBundleToken,
  verifyArenaExtendedBundleToken,
  verifyArenaFinalBundleToken,
} from '@/lib/ai/arena-bundle'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { creditsForArenaRound } from '@/lib/credits'
import { deductCreditsBalance, getCreditsBalance } from '@/lib/credits-server'

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


function parseFightMode(raw: unknown): ArenaFightMode {
  return raw === 'street' ? 'street' : 'logic'
}

function parseArenaMemory(raw: unknown): ArenaMemoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: ArenaMemoryEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const round = typeof o.round === 'number' ? o.round : Number(o.round)
    const fighter = typeof o.fighter === 'string' ? o.fighter.trim() : ''
    const role = o.role
    const content = typeof o.content === 'string' ? o.content : ''
    if (
      !Number.isFinite(round) ||
      !fighter ||
      (role !== 'champion' && role !== 'challenger' && role !== 'co-fighter') ||
      !content.trim()
    ) {
      continue
    }
    out.push({ round: Math.floor(round), fighter, role, content })
  }
  return out
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
  const { user, error: authErr, accessToken: token } = await resolveRouteAuth(req, body)
  const supabase = supabaseAdmin
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

  if (action === 'arena_buy_final_bundle') {
    const buySessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!buySessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 })
    }
    const { data: buySess, error: buyErr } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', buySessionId)
      .maybeSingle()
    if (buyErr || !buySess || buySess.mode !== 'arena') {
      return Response.json({ error: 'Invalid session' }, { status: 400 })
    }
    const amount = arenaFinalBundleCreditCost()
    const deduct = await deductCreditsBalance(supabase, user.id, amount)
    if (!deduct.ok) {
      const insufficient = deduct.reason === 'insufficient'
      return Response.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deduct.balance,
          required: amount,
        },
        { status: insufficient ? 402 : 500 }
      )
    }
    const arenaFinalBundleToken = signArenaFinalBundleToken({
      sessionId: buySess.id,
      userId: user.id,
    })
    const creditsRemaining = deduct.balance
    return Response.json({ ok: true, creditsRemaining, arenaFinalBundleToken })
  }

  if (action === 'arena_buy_extended_bundle') {
    const buySessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    if (!buySessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 })
    }
    const { data: buySess, error: buyErr2 } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', buySessionId)
      .maybeSingle()
    if (buyErr2 || !buySess || buySess.mode !== 'arena') {
      return Response.json({ error: 'Invalid session' }, { status: 400 })
    }
    const amount = arenaExtendedBundleCreditCost()
    const deductEx = await deductCreditsBalance(supabase, user.id, amount)
    if (!deductEx.ok) {
      const insufficient = deductEx.reason === 'insufficient'
      return Response.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deductEx.balance,
          required: amount,
        },
        { status: insufficient ? 402 : 500 }
      )
    }
    const arenaExtendedBundleToken = signArenaExtendedBundleToken({
      sessionId: buySess.id,
      userId: user.id,
    })
    const creditsRemainingEx = deductEx.balance
    return Response.json({ ok: true, creditsRemaining: creditsRemainingEx, arenaExtendedBundleToken })
  }

  if (action === 'arena_log_memory') {
    const logSessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
    const mem = parseArenaMemory(body.arenaMemory)
    if (!logSessionId || mem.length === 0) {
      return Response.json({ ok: true })
    }
    const { data: logSess, error: logErr } = await supabase
      .from('sessions')
      .select('id, mode')
      .eq('id', logSessionId)
      .maybeSingle()
    if (logErr || !logSess || logSess.mode !== 'arena') {
      return Response.json({ error: 'Invalid session' }, { status: 400 })
    }
    const payload = JSON.stringify({
      kind: 'arena_memory_archive',
      sessionId: logSessionId,
      userId: user.id,
      entries: mem,
    })
    const insMem = await insertWithFallback(supabase, 'debate_logs', {
      session_id: logSessionId,
      role: 'assistant',
      message_text: payload,
    }, {
      session_id: logSessionId,
      content: payload,
      speaker: 'arena_memory',
    })
    if (!insMem.ok) {
      console.warn('[arena] debate_logs memory:', insMem.primaryError, insMem.fallbackError)
    }
    return Response.json({ ok: true })
  }

  if (action !== 'start' && action !== 'battle') {
    return Response.json({ error: 'Unknown action' }, { status: 400 })
  }

  const fightModeForArena = parseFightMode(body.fightMode)
  const arenaMemoryForRequest = parseArenaMemory(body.arenaMemory)

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

    const arenaCost = creditsForArenaRound(1)
    const deductStart = await deductCreditsBalance(supabase, user.id, arenaCost)
    if (!deductStart.ok) {
      const insufficient = deductStart.reason === 'insufficient'
      return Response.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deductStart.balance,
          required: arenaCost,
        },
        { status: insufficient ? 402 : 500 }
      )
    }
    const creditsRemaining = deductStart.balance

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
            cost: arenaCost,
            action: 'start',
          })

          const ctx: ArenaTransportContext = {
            supabase,
            sessionId,
            userId: user.id,
            supabaseAccessToken: token ?? undefined,
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
            },
            { fightMode: fightModeForArena, arenaMemory: arenaMemoryForRequest }
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

  if (roundNumber > 9) {
    return Response.json({ error: 'Arena is capped at round 9.' }, { status: 400 })
  }

  const arenaFinalBundleTok =
    typeof body.arenaFinalBundleToken === 'string' ? body.arenaFinalBundleToken : ''
  const arenaExtendedBundleTok =
    typeof body.arenaExtendedBundleToken === 'string' ? body.arenaExtendedBundleToken : ''

  if (roundNumber >= 4) {
    const okTok = verifyArenaFinalBundleToken(arenaFinalBundleTok, sessionId, user.id)
    if (!okTok) {
      return Response.json(
        { error: 'Final rounds require purchasing rounds 4–6 (Continue to Final Rounds).' },
        { status: 402 }
      )
    }
  }

  if (roundNumber >= 7) {
    const okEarly = verifyArenaFinalBundleToken(arenaFinalBundleTok, sessionId, user.id)
    if (!okEarly) {
      return Response.json(
        { error: 'Rounds 7–9 require the rounds 4–6 credit package first.' },
        { status: 402 }
      )
    }
    const okExt = verifyArenaExtendedBundleToken(arenaExtendedBundleTok, sessionId, user.id)
    if (!okExt) {
      return Response.json(
        { error: 'Rounds 7–9 require purchasing the extension (Continue ▶).' },
        { status: 402 }
      )
    }
  }

  let creditsRemaining: number | null = null
  let arenaBattleCost = 0
  if (roundNumber <= 3) {
    arenaBattleCost = creditsForArenaRound(roundNumber)
    const deductBattle = await deductCreditsBalance(supabase, user.id, arenaBattleCost)
    if (!deductBattle.ok) {
      const insufficient = deductBattle.reason === 'insufficient'
      return Response.json(
        {
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deductBattle.balance,
          required: arenaBattleCost,
        },
        { status: insufficient ? 402 : 500 }
      )
    }
    creditsRemaining = deductBattle.balance
  } else {
    creditsRemaining = await getCreditsBalance(supabase, user.id)
  }

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
          cost: arenaBattleCost,
          action: 'battle',
          roundNumber,
        })

        const ctx: ArenaTransportContext = {
          supabase,
          sessionId,
          userId: user.id,
          supabaseAccessToken: token ?? undefined,
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
          },
          { fightMode: fightModeForArena, arenaMemory: arenaMemoryForRequest }
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
