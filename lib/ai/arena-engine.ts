import type { SupabaseClient } from '@supabase/supabase-js'
import { runSingleAiProvider, type AiProviderName } from '@/lib/ai/router'
import { buildArenaSystemPrompt } from '@/lib/ai/arena-prompts'
import {
  determineSides,
  finalizeArenaVisibleBody,
  parseArenaResponse,
  stripArenaMarkdown,
  stripInternalTargetingBlock,
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
    if (!r || typeof r.roundNumber !== 'number') continue
    const responses = Array.isArray(r.responses) ? r.responses : []
    out += `\n======== ROUND ${r.roundNumber} ========\n`
    for (const x of responses) {
      if (!x?.ai) continue
      out += `\n[${x.ai} | ${x.side ?? 'neutral'} | champion=${x.champion}]\n`
      out += `POSITION: ${x.position ?? ''}\nANGLE: ${x.angle ?? ''}\n`
      out += `${x.content ?? ''}\n`
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
    content: stripArenaMarkdown(`[Call failed] ${err}`),
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
    content: finalizeArenaVisibleBody(parsed.content),
    responseTimeMs: ms,
    side,
  }
}

/** Billable model calls per battle round: two champions only. */
export function arenaBattleApiCallCount(_r1?: ArenaRound | undefined | null): number {
  return 2
}

function round1AngleSnippet(r1: ArenaRound, ai: ArenaAI): string {
  const list = Array.isArray(r1.responses) ? r1.responses : []
  const row = list.find((x) => x?.ai === ai)
  const raw = row?.angle?.trim() || row?.content?.trim() || '…'
  return stripArenaMarkdown(stripInternalTargetingBlock(raw)).trim() || '…'
}

/** Zero API — Round 2 only; Korean static line + Round 1 ANGLE. */
function syntheticSupporterAngleLine(
  ai: ArenaAI,
  champ: ArenaAI,
  side: 'left' | 'right',
  r1: ArenaRound
): ArenaResponse {
  const snippet = round1AngleSnippet(r1, ai)
  const aiName = ARENA_DISPLAY[ai]
  const champName = ARENA_DISPLAY[champ]
  const content = `${aiName}은 ${champName}의 주장에 동의한다.\n${snippet}`
  return {
    ai,
    champion: false,
    position: `AGREE_WITH_${champ}`,
    angle: '',
    challenge: null,
    support: champ,
    supportComment: null,
    content,
    responseTimeMs: 0,
    side,
    synthetic: true,
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

  try {
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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return {
      parsed: parseArenaResponse(''),
      raw: '',
      ms: 0,
      error: msg,
    }
  }
}

function openingSnippet(round1: ArenaRound | undefined, ai: ArenaAI): string {
  const list = round1?.responses
  if (!Array.isArray(list)) return '(no prior opening recorded)'
  const r = list.find((x) => x?.ai === ai)
  return r?.content?.slice(0, 2000) ?? '(no prior opening recorded)'
}

export async function runArenaRound1(
  userPrompt: string,
  selectedAIs: ArenaAI[],
  ctx: ArenaTransportContext,
  onResponse: (response: ArenaResponse) => void,
  onThinking?: (ai: ArenaAI) => void
): Promise<ArenaRound> {
  const ordered = sortSelectedAIs(selectedAIs)
  const collected: ArenaResponse[] = []
  let prior = ''

  for (const ai of ordered) {
    onThinking?.(ai)
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
      maxTokens: 600,
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
  onResponse: (response: ArenaResponse) => void,
  onThinking?: (ai: ArenaAI) => void
): Promise<ArenaRound> {
  const r1 = allPreviousRounds.find((r) => r.roundNumber === 1)
  if (!r1 || !Array.isArray(r1.responses) || r1.responses.length === 0) {
    throw new Error('Arena battle requires a completed round 1 with responses.')
  }

  const leftChamp = currentSides.left
  const rightChamp = currentSides.right
  if (!leftChamp || !rightChamp) {
    throw new Error('Arena battle requires both left and right champions.')
  }

  const leftSideList = Array.isArray(r1.sides?.left) ? r1.sides.left : []
  const rightSideList = Array.isArray(r1.sides?.right) ? r1.sides.right : []
  const leftSupport = leftSideList.filter((a) => a !== leftChamp)
  const rightSupport = rightSideList.filter((a) => a !== rightChamp)

  const history = formatArenaHistory(allPreviousRounds)
  const out: ArenaResponse[] = []

  const championUserPrompt = (
    ai: ArenaAI,
    side: 'left' | 'right',
    opposingChampionLatest: string,
    role: string
  ) => {
    const showOpposing = opposingChampionLatest.trim().length > 0 && side === 'right'
    const oppBlock = showOpposing
      ? `\nOpposing champion's latest argument in THIS battle round:\n"""\n${opposingChampionLatest.slice(0, 3500)}\n"""\n`
      : ''
    return `${history}

User topic:
${userPrompt}
${oppBlock}
Your opening statement from ROUND 1 (stay consistent; cite yourself if needed):
${openingSnippet(r1, ai)}

You are the ${side.toUpperCase()} camp champion (${ai}). ${role}
Use the mandatory tag block first, then your argument.`
  }

  const emitSupporterAngle = async (ai: ArenaAI, champ: ArenaAI, side: 'left' | 'right') => {
    const ar = syntheticSupporterAngleLine(ai, champ, side, r1)
    out.push(ar)
    onResponse(ar)
    const persistTurn = nextArenaTurn()
    const tags: ParsedArenaTagBlock = {
      champion: false,
      position: ar.position,
      angle: '',
      challenge: null,
      support: champ,
      supportComment: null,
      content: ar.content,
    }
    await saveArenaDebateLog(ctx.supabase, ctx.sessionId, {
      round: roundNumber,
      turn: persistTurn,
      arenaAi: ai,
      provider: ARENA_TO_PROVIDER[ai],
      content: ar.content,
      tags,
      rawSnippet: '[synthetic supporter angle]',
    })
  }

  const push = async (
    ai: ArenaAI,
    side: ArenaResponse['side'],
    isChampion: boolean,
    prompt: string,
    maxTok: number
  ) => {
    onThinking?.(ai)
    const persistTurn = nextArenaTurn()
    let parsed: ParsedArenaTagBlock
    let raw: string
    let ms: number
    let error: string | undefined
    try {
      const result = await invokeArenaModel({
        ai,
        userPrompt: prompt,
        ctx,
        roundNumber,
        persistTurn,
        maxTokens: maxTok,
      })
      parsed = result.parsed
      raw = result.raw
      ms = result.ms
      error = result.error
    } catch (e: unknown) {
      parsed = parseArenaResponse('')
      raw = ''
      ms = 0
      error = e instanceof Error ? e.message : 'Unknown error'
    }
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

  const leftRole = 'Press your camp case against the opposing champion.'
  await push(
    leftChamp,
    'left',
    true,
    championUserPrompt(leftChamp, 'left', '', leftRole),
    650
  )
  const lastLeftChampTurn = out[out.length - 1]!.content

  const rightRole = 'Rebut the left champion directly.'
  await push(
    rightChamp,
    'right',
    true,
    championUserPrompt(rightChamp, 'right', lastLeftChampTurn, rightRole),
    650
  )

  if (roundNumber === 2) {
    for (const s of leftSupport) {
      await emitSupporterAngle(s, leftChamp, 'left')
    }
    for (const s of rightSupport) {
      await emitSupporterAngle(s, rightChamp, 'right')
    }
  }

  return {
    roundNumber,
    responses: out,
    sides: {
      left: leftSideList.length ? leftSideList : [leftChamp],
      right: rightSideList.length ? rightSideList : [rightChamp],
    },
    champion: {
      left: r1.champion?.left ?? leftChamp,
      right: r1.champion?.right ?? rightChamp,
    },
  }
}
