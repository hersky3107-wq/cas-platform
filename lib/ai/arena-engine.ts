import type { SupabaseClient } from '@supabase/supabase-js'
import { runSingleAiProvider, type AiProviderName } from '@/lib/ai/router'
import { buildArenaSystemPrompt } from '@/lib/ai/arena-prompts'
import {
  determineSides,
  parseArenaResponse,
  type ParsedArenaTagBlock,
} from '@/lib/ai/arena-parser'
import type { ArenaAI, ArenaResponse, ArenaRound } from '@/lib/ai/arena-types'

export type { ArenaAI, ArenaResponse, ArenaRound } from '@/lib/ai/arena-types'

export const ARENA_ORDER: ArenaAI[] = [
  'grok',
  'gpt',
  'gemini',
  'deepseek',
  'mistral',
  'claude',
]

export const ARENA_TO_PROVIDER: Record<ArenaAI, AiProviderName> = {
  grok: 'xai',
  gpt: 'openai',
  gemini: 'google',
  deepseek: 'deepseek',
  mistral: 'mistral',
  claude: 'anthropic',
}

export const ARENA_DISPLAY: Record<ArenaAI, string> = {
  grok: 'Grok',
  gpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  claude: 'Claude',
}

export type ArenaTransportContext = {
  supabase: SupabaseClient
  sessionId: string
  userId: string | null
  supabaseAccessToken?: string
}

async function insertWithFallback(
  supabase: SupabaseClient,
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const primaryRes = await supabase.from(table).insert([primary])
  if (!primaryRes.error) return
  const fallbackRes = await supabase.from(table).insert([fallback])
  if (fallbackRes.error) {
    console.warn(`[arena] ${table} insert:`, primaryRes.error.message, fallbackRes.error.message)
  }
}

export function resetArenaTurnCounter() {
  arenaTurnSeq = 0
}

let arenaTurnSeq = 0
function nextArenaTurn() {
  arenaTurnSeq += 1
  return arenaTurnSeq
}

function sortSelectedAIs(selected: ArenaAI[]): ArenaAI[] {
  const uniq = Array.from(new Set(selected))
  return uniq.sort((a, b) => ARENA_ORDER.indexOf(a) - ARENA_ORDER.indexOf(b))
}

function formatPriorOpenings(responses: ArenaResponse[]): string {
  if (responses.length === 0) return ''
  return responses
    .map(
      (r) =>
        `### ${r.ai}\nPOSITION: ${r.position}\nANGLE: ${r.angle}\nCHALLENGE: ${r.challenge ?? 'NONE'}\nSUPPORT: ${r.support ?? 'NONE'}\n\n${r.content}`
    )
    .join('\n\n---\n\n')
}

export function formatArenaHistory(rounds: ArenaRound[]): string {
  let out = ''
  for (const r of rounds) {
    out += `\n======== ROUND ${r.roundNumber} ========\n`
    for (const x of r.responses) {
      out += `\n[${x.ai} | ${x.side} | champion=${x.champion}]\n`
      out += `POSITION: ${x.position}\nANGLE: ${x.angle}\n`
      out += `${x.content}\n`
    }
  }
  return out.trim()
}

function errorArenaResponse(ai: ArenaAI, err: string, ms: number): ArenaResponse {
  return {
    ai,
    champion: false,
    position: 'INDEPENDENT',
    angle: '',
    challenge: null,
    support: null,
    supportComment: null,
    content: `[Call failed] ${err}`,
    responseTimeMs: ms,
    side: 'neutral',
  }
}

function toArenaResponse(
  ai: ArenaAI,
  parsed: ParsedArenaTagBlock,
  ms: number,
  side: ArenaResponse['side'],
  championFlag: boolean
): ArenaResponse {
  return {
    ai,
    champion: championFlag,
    position: parsed.position,
    angle: parsed.angle,
    challenge: parsed.challenge,
    support: parsed.support,
    supportComment: parsed.supportComment,
    content: parsed.content,
    responseTimeMs: ms,
    side,
  }
}

async function saveArenaDebateLog(
  supabase: SupabaseClient,
  sessionId: string,
  payload: {
    round: number
    turn: number
    arenaAi: ArenaAI
    provider: AiProviderName
    content: string
    tags: ParsedArenaTagBlock
    rawSnippet?: string | null
  }
) {
  const body = {
    mode: 'arena',
    round: payload.round,
    turn: payload.turn,
    ai: payload.arenaAi,
    provider: payload.provider,
    content: payload.content,
    tags: {
      champion: payload.tags.champion,
      position: payload.tags.position,
      angle: payload.tags.angle,
      challenge: payload.tags.challenge,
      support: payload.tags.support,
      supportComment: payload.tags.supportComment,
    },
    rawSnippet: payload.rawSnippet?.slice(0, 4000) ?? null,
  }
  const json = JSON.stringify(body)
  await insertWithFallback(
    supabase,
    'debate_logs',
    {
      session_id: sessionId,
      role: 'assistant',
      message_text: json,
      ai_name: payload.provider,
    },
    {
      session_id: sessionId,
      content: json,
      speaker: payload.arenaAi,
    }
  )
}

async function invokeArenaModel(params: {
  ai: ArenaAI
  userPrompt: string
  ctx: ArenaTransportContext
  roundNumber: number
  persistTurn: number
  maxTokens: number
  temperature?: number
}): Promise<{ parsed: ParsedArenaTagBlock; raw: string; ms: number; error?: string }> {
  const { ai, userPrompt, ctx, roundNumber, persistTurn, maxTokens, temperature } = params
  const provider = ARENA_TO_PROVIDER[ai]
  const systemPrompt = buildArenaSystemPrompt(ai)

  const res = await runSingleAiProvider({
    supabase: ctx.supabase,
    sessionId: ctx.sessionId,
    userId: ctx.userId,
    provider,
    prompt: userPrompt,
    systemPrompt,
    supabaseAccessToken: ctx.supabaseAccessToken,
    saveCompareArtifacts: false,
    temperature: temperature ?? 0.75,
    maxCompletionTokens: maxTokens,
    transformPersist: (raw) => {
      const parsed = parseArenaResponse(raw)
      const stored = parsed.content.trim() || raw.trim()
      return {
        storedResponseText: stored,
        aiResponseExtras: {
          round: roundNumber,
          arena_turn: persistTurn,
          arena_tags: JSON.stringify({
            ai,
            champion: parsed.champion,
            position: parsed.position,
            angle: parsed.angle,
            challenge: parsed.challenge,
            support: parsed.support,
            supportComment: parsed.supportComment,
          }),
        },
      }
    },
  })

  if (res.error || res.text == null) {
    return {
      parsed: parseArenaResponse(''),
      raw: res.text ?? '',
      ms: res.responseTimeMs,
      error: res.error ?? 'Empty response',
    }
  }

  const parsed = parseArenaResponse(res.text)
  return { parsed, raw: res.text, ms: res.responseTimeMs }
}

function openingSnippet(round1: ArenaRound | undefined, ai: ArenaAI): string {
  const r = round1?.responses.find((x) => x.ai === ai)
  return r?.content?.slice(0, 2000) ?? '(no prior opening recorded)'
}

export async function runArenaRound1(
  userPrompt: string,
  selectedAIs: ArenaAI[],
  ctx: ArenaTransportContext,
  onResponse: (response: ArenaResponse) => void
): Promise<ArenaRound> {
  const ordered = sortSelectedAIs(selectedAIs)
  const collected: ArenaResponse[] = []
  let prior = ''

  for (const ai of ordered) {
    const block =
      prior.length === 0
        ? userPrompt
        : `${userPrompt}\n\n=== PRIOR OPENING STATEMENTS (same arena; respond in sequence) ===\n${prior}`

    const persistTurn = nextArenaTurn()
    const { parsed, raw, ms, error } = await invokeArenaModel({
      ai,
      userPrompt: block,
      ctx,
      roundNumber: 1,
      persistTurn,
      maxTokens: 1400,
    })

    let ar: ArenaResponse
    if (error) {
      ar = errorArenaResponse(ai, error, ms)
      await saveArenaDebateLog(ctx.supabase, ctx.sessionId, {
        round: 1,
        turn: persistTurn,
        arenaAi: ai,
        provider: ARENA_TO_PROVIDER[ai],
        content: ar.content,
        tags: parseArenaResponse(''),
        rawSnippet: error,
      })
    } else {
      ar = toArenaResponse(ai, parsed, ms, 'neutral', parsed.champion)
      await saveArenaDebateLog(ctx.supabase, ctx.sessionId, {
        round: 1,
        turn: persistTurn,
        arenaAi: ai,
        provider: ARENA_TO_PROVIDER[ai],
        content: ar.content,
        tags: parsed,
        rawSnippet: raw,
      })
    }

    collected.push(ar)
    onResponse(ar)
    if (!error) {
      prior += `\n\n### ${ai}\n${ar.content}`
    }
  }

  const { left, right, championLeft, championRight } = determineSides(collected)
  return {
    roundNumber: 1,
    responses: collected,
    sides: { left, right },
    champion: { left: championLeft, right: championRight },
  }
}

export async function runArenaRound(
  roundNumber: number,
  userPrompt: string,
  allPreviousRounds: ArenaRound[],
  currentSides: { left: ArenaAI; right: ArenaAI },
  ctx: ArenaTransportContext,
  onResponse: (response: ArenaResponse) => void
): Promise<ArenaRound> {
  const r1 = allPreviousRounds.find((r) => r.roundNumber === 1)
  const leftChamp = currentSides.left
  const rightChamp = currentSides.right
  const leftSupport = (r1?.sides.left ?? []).filter((a) => a !== leftChamp)
  const rightSupport = (r1?.sides.right ?? []).filter((a) => a !== rightChamp)

  const history = formatArenaHistory(allPreviousRounds)
  const out: ArenaResponse[] = []

  const championPrompt = (
    ai: ArenaAI,
    side: 'left' | 'right',
    role: string
  ) => `${history}

User topic:
${userPrompt}

Your opening statement from ROUND 1 (stay consistent; cite yourself if needed):
${openingSnippet(r1, ai)}

You are the ${side.toUpperCase()} camp champion (${ai}). ${role}
Use the mandatory tag block first, then your argument.`

  const supportPrompt = (ai: ArenaAI, side: 'left' | 'right', champ: ArenaAI) => `${history}

User topic:
${userPrompt}

Your round 1 opening:
${openingSnippet(r1, ai)}

You are ${ai} on the ${side.toUpperCase()} side supporting champion ${champ}.
Add a short supporting strike (2–5 sentences) after the tags. CHAMPION must be NO. CHALLENGE: NONE unless essential.`

  const push = async (
    ai: ArenaAI,
    side: ArenaResponse['side'],
    isChampion: boolean,
    prompt: string,
    maxTok: number
  ) => {
    const persistTurn = nextArenaTurn()
    const { parsed, raw, ms, error } = await invokeArenaModel({
      ai,
      userPrompt: prompt,
      ctx,
      roundNumber,
      persistTurn,
      maxTokens: maxTok,
    })
    let ar: ArenaResponse
    if (error) {
      ar = errorArenaResponse(ai, error, ms)
      await saveArenaDebateLog(ctx.supabase, ctx.sessionId, {
        round: roundNumber,
        turn: persistTurn,
        arenaAi: ai,
        provider: ARENA_TO_PROVIDER[ai],
        content: ar.content,
        tags: parseArenaResponse(''),
        rawSnippet: error,
      })
    } else {
      ar = toArenaResponse(ai, parsed, ms, side, isChampion ? parsed.champion : false)
      await saveArenaDebateLog(ctx.supabase, ctx.sessionId, {
        round: roundNumber,
        turn: persistTurn,
        arenaAi: ai,
        provider: ARENA_TO_PROVIDER[ai],
        content: ar.content,
        tags: parsed,
        rawSnippet: raw,
      })
    }
    out.push(ar)
    onResponse(ar)
  }

  await push(
    leftChamp,
    'left',
    true,
    championPrompt(leftChamp, 'left', 'Open with your attack for this battle round.'),
    1600
  )
  for (const s of leftSupport) {
    await push(s, 'left', false, supportPrompt(s, 'left', leftChamp), 700)
  }

  await push(
    rightChamp,
    'right',
    true,
    championPrompt(rightChamp, 'right', 'Rebut the opposing champion and their allies.'),
    1600
  )
  for (const s of rightSupport) {
    await push(s, 'right', false, supportPrompt(s, 'right', rightChamp), 700)
  }

  await push(
    leftChamp,
    'left',
    true,
    championPrompt(leftChamp, 'left', 'Second strike: press the advantage against the right camp.'),
    1600
  )

  return {
    roundNumber,
    responses: out,
    sides: { left: r1?.sides.left ?? [leftChamp], right: r1?.sides.right ?? [rightChamp] },
    champion: {
      left: r1?.champion.left ?? leftChamp,
      right: r1?.champion.right ?? rightChamp,
    },
  }
}
