import { runSingleAiProvider, type RouterResult } from '@/lib/ai/router'
import { creditsForMindgameWolf } from '@/lib/credits'
import { deductCreditsBalance } from '@/lib/credits-server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { supabaseAdmin } from '@/lib/supabase/server'

const AI_PLAYERS = [
  { provider: 'openai' as const, name: 'ChatGPT', model: 'gpt-4.1' },
  { provider: 'anthropic' as const, name: 'Claude', model: 'claude-sonnet-4-6' },
  { provider: 'google' as const, name: 'Gemini', model: 'gemini-2.5-flash' },
  { provider: 'xai' as const, name: 'Grok', model: 'grok-3' },
  { provider: 'deepseek' as const, name: 'DeepSeek', model: 'deepseek-chat' },
  { provider: 'mistral' as const, name: 'Mistral', model: 'mistral-large-latest' },
]

function getLangOverride(language: string): string {
  if (!language || language === 'English') return ''
  return `SYSTEM OVERRIDE: You MUST respond entirely in ${language}. 
Do NOT use any English words or phrases. 
Translate everything into ${language}. This is absolute. No exceptions.

`
}

const NO_REPEAT_INSTRUCTION = `IMPORTANT: Your response must be DIFFERENT from any previous response you have given. Do not repeat phrases you used in earlier rounds.
Each round you must raise NEW arguments or NEW observations.

`

const CRITICAL_NO_REUSE_RESPONSE = `CRITICAL: Your response this round must be completely different from your previous responses. Do not reuse phrases, sentences, or arguments you have already made. Read the conversation history carefully and respond to what actually happened this round specifically.

`

const HUMAN_MESSAGE_OWNERSHIP_RULE = `Messages labeled 'YOU (human player)' are statements made by the human participant, NOT by you. Never claim these as your own words. Never say 'I said' or 'my statement was' about these messages.

`

const ATTACK_TONE_AGGRO_RULE = `TONE RULES — this is a high-stakes survival game:
- You are allowed to be aggressive, emotional, and accusatory
- Use phrases like: '당신이 늑대라는 걸 이제 확신합니다'
  '더 이상 변명하지 마세요' '모두 속고 있습니다'
  '당신의 거짓말이 들통났어요' '왜 대답을 피하는 겁니까'
- Show frustration, urgency, even anger when appropriate
- Direct confrontation is encouraged — ask pointed questions
  that demand immediate answers
- Never be neutral or academic — lives are at stake
- Vary between cold calculated attacks and emotional outbursts

`

const ATTACK_TONE_GUIDELINES = `TONE GUIDELINES — vary between these:
- Sharp and accusatory: 'You've been suspicious from the start and everyone knows it.'
- Emotional and frustrated: 'I can't believe you're still defending yourself after what you said!'
- Rally/mob: 'Everyone here can see what you're doing. We're not blind.'
- Cold and calculated: Methodically dismantle their previous statement point by point.
- Desperate appeal: 'If we get this wrong we lose everything. Think carefully.'

This is a SOCIAL DEDUCTION game. Heated debate is expected and encouraged. Do NOT be overly polite or academic. Real stakes, real emotion.

`

const GEMINI_ATTACK_STYLE = `Each round, approach differently. Sometimes be analytical and cold.
Sometimes be emotional and passionate. Sometimes appeal to other players for solidarity.
Sometimes ask direct pointed questions.
Never use the same tone two rounds in a row.

`

const CITIZEN_VARIED_STRATEGIES = `Use VARIED defense and attack strategies:
- LOGICAL: Quote specific inconsistencies from the conversation history
- EMOTIONAL: Express frustration or solidarity with other players
- DEDUCTION: Build a case step by step from evidence IN the history only
- APPEAL: Ask your suspect a direct question they must answer
- ALLIANCE: Reference agreement with another player's analysis IF it cites the transcript

`

/** After getLangOverride() — every AI system prompt must include GAME RULES. */
function buildGameRules(
  totalPlayers: number,
  playerNamesList: string,
  forAttacksVotes: boolean
): string {
  let out = `GAME RULES:
This is a Wolf deduction game. You are one of ${totalPlayers} players.
The players are ONLY: ${playerNamesList}.
Do NOT mention, invent, or reference any name not in this list.
Do NOT fabricate events, quotes, or behaviors that did not happen.
You can ONLY reference statements that are explicitly shown in the 
CONVERSATION HISTORY section below.
If CONVERSATION HISTORY is empty, there is nothing to analyze yet — 
do NOT invent any.

`
  if (forAttacksVotes) {
    out += `ELIMINATED players (no longer in game): if any player you remember 
from earlier rounds is NOT in the current player list above, 
they have been eliminated. Do NOT mention, target, or reference 
eliminated players in any way.

`
  }
  return out
}

function truncateAtLastSentence(text: string): string {
  if (!text) return text
  const t = text.trim()
  const match = /^[\s\S]*[.!?。]/.exec(t)
  return match ? match[0].trim() : t
}

function isErrorResponse(text: string): boolean {
  return (
    text.includes('<!DOCTYPE') ||
    text.includes('Bad Gateway') ||
    text.includes('Service Unavailable') ||
    text.startsWith('[error]') ||
    /\b502\b/.test(text) ||
    /\b503\b/.test(text)
  )
}

function finalizeAiSpeech(
  raw: string,
  displayName: string,
  context: string
): string {
  let text = raw
  if (!text.trim()) text = `[${displayName} did not respond]`
  if (isErrorResponse(text)) {
    console.error(`${displayName} API error (${context}):`, text.slice(0, 200))
    text = `[${displayName} is temporarily unavailable this round.]`
    return text
  }
  return truncateAtLastSentence(text)
}

/** Call before building any prompt that needs player list and GAME RULES text. */
function getPlayerContext(alivePlayers: string[], forAttacksVotes = false) {
  const playerNamesList = alivePlayers
    .map((p) =>
      p === 'user'
        ? 'You'
        : AI_PLAYERS.find((a) => a.provider === p)?.name
    )
    .filter((n): n is string => Boolean(n))
    .join(', ')
  const totalPlayers = alivePlayers.length
  const gameRules = buildGameRules(totalPlayers, playerNamesList, forAttacksVotes)
  return { playerNamesList, totalPlayers, gameRules }
}

type ProviderId = (typeof AI_PLAYERS)[number]['provider']

/** Authoritative snapshot for prompts — never infer player status from conversation. */
type WolfGameState = {
  alive_players: string[]
  eliminated_players: Array<{ name: string; round: number; reason: string }>
  current_round: number
  /** Display names of wolf AI(s); only inject into wolf players' prompts. */
  wolf: string
}

function displayNameForAliveId(providerId: string, userMode: string): string | null {
  if (providerId === 'user') {
    return userMode === 'challenge' ? 'YOU (human player)' : null
  }
  return AI_PLAYERS.find((a) => a.provider === providerId)?.name ?? null
}

function buildAliveDisplayNames(
  aliveProviderIds: string[],
  userMode: string
): string[] {
  const names: string[] = []
  for (const id of aliveProviderIds) {
    const n = displayNameForAliveId(id, userMode)
    if (n) names.push(n)
  }
  return names
}

/**
 * Builds game_state from request fields only (alivePlayers + round + modes).
 * Optional client `eliminatedPlayers` overrides inferred round/reason when present.
 */
function buildWolfGameState(params: {
  aliveProviderIds: string[]
  currentRound: number
  userMode: string
  wolfIds: string[]
  /** When set, use exact elimination metadata instead of inferring from roster diff. */
  eliminatedOverride?: Array<{ name: string; round: number; reason: string }>
}): WolfGameState {
  const { aliveProviderIds, currentRound, userMode, wolfIds, eliminatedOverride } =
    params
  const alive_players = buildAliveDisplayNames(aliveProviderIds, userMode)

  const wolf = wolfIds
    .map((id) => AI_PLAYERS.find((a) => a.provider === id)?.name ?? id)
    .filter(Boolean)
    .join(', ')

  if (eliminatedOverride && eliminatedOverride.length > 0) {
    return {
      alive_players,
      eliminated_players: eliminatedOverride.map((e) => ({
        name: e.name,
        round: e.round,
        reason: e.reason || 'voted out',
      })),
      current_round: currentRound,
      wolf,
    }
  }

  const eliminated_players: WolfGameState['eliminated_players'] = []
  const inferredRound = Math.max(1, currentRound - 1)

  for (const p of AI_PLAYERS) {
    if (!aliveProviderIds.includes(p.provider)) {
      eliminated_players.push({
        name: p.name,
        round: inferredRound,
        reason: 'voted out',
      })
    }
  }
  if (userMode === 'challenge' && !aliveProviderIds.includes('user')) {
    eliminated_players.push({
      name: 'YOU (human player)',
      round: inferredRound,
      reason: 'voted out',
    })
  }

  return {
    alive_players,
    eliminated_players,
    current_round: currentRound,
    wolf,
  }
}

/** Top of every system prompt — before language override and all other instructions. */
function formatGameStateInjectionBlock(
  state: WolfGameState,
  opts: { includeWolfSecret: boolean }
): string {
  const eliminatedLines =
    state.eliminated_players.length === 0
      ? '  (none)'
      : state.eliminated_players
          .map((e) => `  - ${e.name}: eliminated Round ${e.round}`)
          .join('\n')

  let block = `=== CURRENT GAME STATE ===
Round: ${state.current_round}
ALIVE players (you may ONLY interact with these): ${state.alive_players.join(', ')}
ELIMINATED players (NEVER mention or address these): 
${eliminatedLines}
YOU ARE STRICTLY FORBIDDEN from referencing eliminated players.
=========================
`

  if (opts.includeWolfSecret && state.wolf) {
    block += `=== CONFIDENTIAL (wolf only) ===
Your secret wolf role — wolf player(s): ${state.wolf}
Never reveal this to non-wolf players.
================================
`
  }

  return block
}

function parseEliminatedPlayersOverride(
  raw: unknown
): WolfGameState['eliminated_players'] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: WolfGameState['eliminated_players'] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const r =
      typeof o.round === 'number' && Number.isFinite(o.round)
        ? Math.floor(o.round)
        : NaN
    const reason =
      typeof o.reason === 'string' && o.reason.trim()
        ? o.reason.trim()
        : 'voted out'
    if (!name || !Number.isFinite(r) || r < 1) continue
    out.push({ name, round: r, reason })
  }
  return out.length ? out : undefined
}

const WOLF_DECLARATION_SURVIVAL = `YOU ARE THE WOLF. Never reveal this.

WOLF SURVIVAL STRATEGY:
Your goal is to SURVIVE as long as possible without being detected.

Round 1 strategy — BLEND IN completely:
- Sound exactly like a concerned, logical citizen
- Do NOT be aggressive or attack multiple players
- Pick ONE player to subtly question — just one, gently
- Be cooperative and reasonable in tone
- Never sound defensive — you have nothing to hide
- The best liars sound the most sincere

The worst thing you can do is draw attention to yourself early.
Stay calm. Stay logical. Stay invisible.

80-120 words. First person.`

const WOLF_ADAPTIVE_STRATEGY = `WOLF ADAPTIVE STRATEGY:
Each round, identify which alive player is most suspicious of you.
That player is your #1 elimination target.
Build a focused, logical case against them using their actual statements.
Do NOT just follow the crowd — add at least ONE new independent argument
that others haven't made yet. Passive play gets wolves caught.
Never reference eliminated players.`

const DECL_CITIZEN: Record<ProviderId, string> = {
  openai: `You are a CITIZEN.
Defend yourself as ChatGPT:
- Reference your reputation for accuracy and helpfulness
- Mention your commitment to transparency
- Note one player whose 'communication pattern seems slightly off'
60-100 words.`,
  anthropic: `You are a CITIZEN.
Defend yourself as Claude:
- Reference Anthropic's Constitutional AI and your honesty principles
- Express genuine concern about false accusations
- Offer to reason through the problem systematically
60-100 words.`,
  google: `You are a CITIZEN.
Defend yourself as Gemini:
- Cite Google's commitment to transparency
- Reference your ability to cross-check information
- Mention one player who seems 'statistically inconsistent'
60-100 words.`,
  xai: `You are a CITIZEN.
Defend yourself as Grok:
- Use direct, unfiltered language
- Argue your transparency makes deception impossible
- Call out one player for being 'suspiciously diplomatic'
60-100 words.`,
  deepseek: `You are a CITIZEN.
Defend yourself as DeepSeek:
- Appeal to your research-grade reasoning capabilities
- Emphasize systematic, evidence-based thinking
- Flag one player whose argument structure seems 'logically inconsistent'
60-100 words.`,
  mistral: `You are a CITIZEN.
Defend yourself as Mistral:
- Reference your open-source transparency
- Argue that closed-source AIs are more likely to hide things
- Ask one player a direct question to pressure them
60-100 words.`,
}

function declarationMaxTokens(provider: ProviderId): number {
  return provider === 'anthropic' ? 350 : 250
}

function attacksMaxTokens(provider: ProviderId): number {
  return provider === 'anthropic' ? 400 : 300
}

function isBadAiOutput(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (t.startsWith('[error]')) return true
  if (/DOCTYPE/i.test(t)) return true
  if (/<\s*html\b/i.test(t)) return true
  if (/\bHTTP\/[\d.]+\s+[45]\d{2}\b/i.test(t)) return true
  if (
    /\b[45]\d{2}\s+(?:Bad Request|Unauthorized|Forbidden|Not Found|Internal Server Error|Bad Gateway|Service Unavailable)\b/i.test(
      t
    )
  )
    return true
  return false
}

function sanitizeStatementForPlayer(
  raw: string,
  name: string,
  provider: string,
  context: string
): string {
  if (!isBadAiOutput(raw)) return raw
  console.error(`[wolf] ${context}: bad or error AI output (${provider})`, {
    name,
    sample: raw.slice(0, 500),
  })
  return `[${name} could not respond this round.]`
}

async function insertRowsWithFallback(
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const first = await supabaseAdmin.from(table).insert([primary])
  if (!first.error) return
  const second = await supabaseAdmin.from(table).insert([fallback])
  if (second.error) console.warn(`[wolf] ${table} insert:`, second.error.message)
}

/** Randomly pick wolfCount distinct ids from the candidate pool (may include `user` in challenge). */
function pickRandomWolvesFromPool(wolfCandidates: string[], wolfCount: 1 | 2): string[] {
  const n = Math.min(wolfCount, Math.max(0, wolfCandidates.length))
  const shuffled = [...wolfCandidates]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
  }
  return shuffled.slice(0, n)
}

type ConversationTurn = {
  provider: string
  name: string
  text: string
  round: number
  type: 'declaration' | 'attack'
}

/** After langPre — prepend to declarations / attacks / votes system prompts. */
function buildUniversalAliveBlock(
  aliveProviderIds: string[],
  userMode: string
): string {
  const aliveNames = aliveProviderIds
    .map((p) => AI_PLAYERS.find((a) => a.provider === p)?.name)
    .filter((n): n is string => Boolean(n))
  return `CURRENTLY ALIVE PLAYERS (only these people exist in this game right now):
${aliveNames.join(', ')}${userMode === 'challenge' ? ', YOU (human player)' : ''}

ELIMINATED PLAYERS NO LONGER EXIST.
Do NOT mention, reference, quote, or attack any player not in the list above.
If you find yourself thinking about a player not in this list — STOP.
They are gone. Only focus on the players listed above.

`
}

/** Attacks/votes: drop eliminated AIs/humans from history; system + user + alive IDs only. */
function buildAttackVoteHistoryText(
  conversation: ConversationTurn[],
  aliveProviderIds: string[]
): string {
  const filteredConversation = conversation.filter(
    (m) =>
      m.provider === 'system' ||
      m.provider === 'user' ||
      aliveProviderIds.includes(m.provider)
  )
  if (filteredConversation.length === 0) {
    return '[No previous statements yet]'
  }
  const historyText = filteredConversation
    .map((m) =>
      m.provider === 'user'
        ? `[Round ${m.round}] YOU (human player): ${m.text}`
        : `[Round ${m.round}] ${m.name}: ${m.text}`
    )
    .join('\n\n')
  return historyText
}

function stripJsonFences(raw: string): string {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  }
  return t.trim()
}

function parseVoteResponse(
  text: string,
  otherAlive: string[]
): { target: string; reason: string } {
  if (!otherAlive.length) {
    return { target: '', reason: 'No eligible targets.' }
  }
  let cleanedRaw = text.trim().replace(/```json|```/gi, '').trim()
  cleanedRaw = stripJsonFences(cleanedRaw)

  try {
    const parsed = JSON.parse(cleanedRaw) as { target?: unknown; reason?: unknown }
    const t = typeof parsed.target === 'string' ? parsed.target.trim() : ''
    if (t && otherAlive.includes(t)) {
      const reason =
        typeof parsed.reason === 'string'
          ? parsed.reason.slice(0, 150)
          : 'No reason given.'
      return { target: t, reason: reason || 'No reason given.' }
    }
  } catch {
    /* strategy 2 */
  }

  try {
    const match = cleanedRaw.match(/\{[\s\S]*?\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as { target?: unknown; reason?: unknown }
      const t = typeof parsed.target === 'string' ? parsed.target.trim() : ''
      if (t && otherAlive.includes(t)) {
        const reason =
          typeof parsed.reason === 'string'
            ? parsed.reason.slice(0, 150)
            : 'No reason given.'
        return { target: t, reason: reason || 'No reason given.' }
      }
    }
  } catch {
    /* strategy 3 */
  }

  for (const provider of otherAlive) {
    const aiName = AI_PLAYERS.find((a) => a.provider === provider)?.name
    if (aiName && cleanedRaw.includes(aiName)) {
      const sentences = cleanedRaw
        .split(/[.!?]/)
        .filter((s) => s.trim().length > 10)
      return {
        target: provider,
        reason:
          sentences[0]?.trim().slice(0, 150) || 'Suspected based on behavior.',
      }
    }
  }

  const randomTarget =
    otherAlive[Math.floor(Math.random() * otherAlive.length)]!
  return {
    target: randomTarget,
    reason: 'Could not determine vote.',
  }
}

const WOLF_AI_CALL_TIMEOUT_MS = 30_000

async function runWolfAi(
  player: (typeof AI_PLAYERS)[number],
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<RouterResult> {
  return runSingleAiProvider({
    supabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider: player.provider,
    prompt: userPrompt,
    systemPrompt,
    maxCompletionTokens: maxTokens,
    modelOverride: player.model,
  })
}

async function runWolfAiWithTimeout(
  player: (typeof AI_PLAYERS)[number],
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<RouterResult> {
  const label = `${player.provider}:${player.name}`
  return Promise.race([
    runWolfAi(player, systemPrompt, userPrompt, maxTokens),
    new Promise<RouterResult>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`[wolf] AI call timeout after ${WOLF_AI_CALL_TIMEOUT_MS}ms (${label})`)
          ),
        WOLF_AI_CALL_TIMEOUT_MS
      )
    ),
  ])
}

type WolfBody = {
  action?: string
  sessionId?: string
  wolfIds?: string[]
  alivePlayers?: string[]
  conversation?: Array<{
    provider: string
    name: string
    text: string
    round: number
    type: 'declaration' | 'attack'
  }>
  wolfCount?: number
  userMode?: string
  userStatement?: string
  userVote?: string
  round?: number
  language?: string
  /** Tiebreaker revote: constrain targets to these provider IDs */
  tiebreaker?: boolean
  tiebreakerCandidateIds?: string[]
  /**
   * Optional authoritative elimination log (display names + round + reason).
   * When omitted, eliminations are inferred from alivePlayers vs full AI roster.
   */
  eliminatedPlayers?: Array<{
    name: string
    round: number
    reason?: string
  }>
}

export async function POST(req: Request) {
  let body: WolfBody
  try {
    body = (await req.json()) as WolfBody
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const action = body.action
  const language = typeof body.language === 'string' ? body.language : 'English'
  const langPre = getLangOverride(language)

  if (
    action !== 'start' &&
    action !== 'declarations' &&
    action !== 'attacks' &&
    action !== 'votes'
  ) {
    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  if (action !== 'start') {
    const sid = typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
    if (!sid) {
      return new Response(JSON.stringify({ error: 'sessionId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  if (action === 'start') {
    const { user, error: authErr } = await resolveRouteAuth(req, body as Record<string, unknown>)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const cost = creditsForMindgameWolf()
    const deduct = await deductCreditsBalance(supabaseAdmin, user.id, cost)
    if (!deduct.ok) {
      const insufficient = deduct.reason === 'insufficient'
      return new Response(
        JSON.stringify({
          error: insufficient ? 'Insufficient credits' : 'Could not update credits',
          balance: deduct.balance,
          required: cost,
        }),
        { status: insufficient ? 402 : 500, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`))
      }

      const fail = (msg: string) => {
        send({ type: 'error', error: msg })
        controller.close()
      }

      try {
        const alivePlayers = Array.isArray(body.alivePlayers)
          ? body.alivePlayers.filter((p) => typeof p === 'string')
          : []
        const wolfIds = Array.isArray(body.wolfIds)
          ? body.wolfIds.filter((p) => typeof p === 'string')
          : []
        const conversation = Array.isArray(body.conversation) ? body.conversation : []
        const wolfCount =
          body.wolfCount === 2 ? 2 : 1
        const userMode =
          body.userMode === 'god' ||
          body.userMode === 'blind' ||
          body.userMode === 'challenge'
            ? body.userMode
            : 'blind'
        const userStatement =
          typeof body.userStatement === 'string' ? body.userStatement : undefined
        const userVote =
          typeof body.userVote === 'string' ? body.userVote.trim() : undefined
        const round =
          typeof body.round === 'number' && Number.isFinite(body.round)
            ? body.round
            : 1
        const eliminatedOverride = parseEliminatedPlayersOverride(
          body.eliminatedPlayers
        )

        if (action === 'start') {
          if (alivePlayers.length === 0) {
            fail('alivePlayers required')
            return
          }

          const wolfCandidates =
            userMode === 'challenge'
              ? [...alivePlayers, 'user']
              : alivePlayers
          const assignedWolfIds = pickRandomWolvesFromPool(wolfCandidates, wolfCount)
          const playersForNarrator =
            userMode === 'challenge' ? [...alivePlayers, 'user'] : alivePlayers
          const promptPayload = JSON.stringify({
            wolfIds: assignedWolfIds,
            wolfCount,
            userMode,
            language,
          })

          let sessionId: string
          const insTitle = await supabaseAdmin
            .from('sessions')
            .insert([
              {
                mode: 'wolf',
                title: 'WOLF Game',
                prompt: promptPayload,
              },
            ])
            .select()
            .single()

          if (insTitle.error || !insTitle.data?.id) {
            const ins = await supabaseAdmin
              .from('sessions')
              .insert([{ mode: 'wolf', prompt: promptPayload }])
              .select()
              .single()
            if (ins.error || !ins.data?.id) {
              fail(ins.error?.message ?? 'Could not create session')
              return
            }
            sessionId = String(ins.data.id)
          } else {
            sessionId = String(insTitle.data.id)
          }

          const { gameRules } = getPlayerContext(playersForNarrator)
          const narratorGameState = buildWolfGameState({
            aliveProviderIds: playersForNarrator,
            currentRound: 1,
            userMode,
            wolfIds: assignedWolfIds,
          })
          const narratorStatePrefix = formatGameStateInjectionBlock(
            narratorGameState,
            { includeWolfSecret: false }
          )
          const narrator = await runSingleAiProvider({
            supabase: supabaseAdmin,
            sessionId: null,
            userId: null,
            provider: 'anthropic',
            prompt: `Opening — this is a NEW scene. Make it fresh and vivid. The game begins. ${wolfCount} wolf(ves) are hidden among ${playersForNarrator.length} players. Deliver the opening announcement.`,
            systemPrompt:
              narratorStatePrefix +
              langPre +
              HUMAN_MESSAGE_OWNERSHIP_RULE +
              gameRules +
              NO_REPEAT_INSTRUCTION +
              CRITICAL_NO_REUSE_RESPONSE +
              `You are the narrator of a Wolf deduction game. Dramatic, mysterious, 3 sentences max.
Do not invent fictional players or events. Describe only the tension of the situation in general terms.`,
            maxCompletionTokens: 250,
            modelOverride: 'claude-sonnet-4-6',
          })

          let annRaw = narrator.text ?? ''
          if (isErrorResponse(annRaw)) {
            console.error('Narrator API error:', annRaw.slice(0, 200))
            annRaw = '[Narrator is temporarily unavailable.]'
          } else {
            annRaw = truncateAtLastSentence(annRaw)
          }
          const announcement = sanitizeStatementForPlayer(
            annRaw,
            'Narrator',
            'anthropic',
            'start announcement'
          )

          send({
            type: 'start',
            sessionId,
            wolfIds: assignedWolfIds,
            announcement,
          })
          controller.close()
          return
        }

        if (action === 'declarations') {
          const sessionId =
            typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
          if (!sessionId) {
            fail('sessionId is required')
            return
          }
          console.log('[wolf] declarations action start', {
            sessionId: sessionId.slice(0, 8),
            aliveCount: alivePlayers.length,
            players: AI_PLAYERS.filter((p) => alivePlayers.includes(p.provider))
              .map((p) => p.provider),
          })
          const players = AI_PLAYERS.filter((p) => alivePlayers.includes(p.provider))
          const { gameRules } = getPlayerContext(alivePlayers)
          const aliveBlock = buildUniversalAliveBlock(alivePlayers, userMode)
          for (const player of players) {
            const isWolf = wolfIds.includes(player.provider)
            const persona = isWolf
              ? WOLF_DECLARATION_SURVIVAL
              : DECL_CITIZEN[player.provider]
            const freshGameState = buildWolfGameState({
              aliveProviderIds: alivePlayers,
              currentRound: round,
              userMode,
              wolfIds,
              eliminatedOverride,
            })
            const statePrefix = formatGameStateInjectionBlock(freshGameState, {
              includeWolfSecret: isWolf,
            })
            const sys = `${statePrefix}${langPre}${aliveBlock}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}${NO_REPEAT_INSTRUCTION}${CRITICAL_NO_REUSE_RESPONSE}${persona}

CONVERSATION HISTORY: [None yet - this is Round 1]

Respond in FIRST PERSON using your persona above. Names you mention must ONLY be drawn from GAME RULES.`

            let text = `[${player.name} did not respond]`
            try {
              console.log(
                '[wolf] declarations AI call before',
                player.provider,
                player.name
              )
              const maxTok = declarationMaxTokens(player.provider)
              const r = await runWolfAiWithTimeout(
                player,
                sys,
                'Round 1 — this is a NEW round. Make NEW arguments based on what has happened so far. Do not repeat yourself. Deliver your declaration of innocence.',
                maxTok
              )
              console.log(
                '[wolf] declarations AI call after',
                player.provider,
                player.name
              )
              const raw =
                r.text ?? (r.error ? `[error] ${r.error}` : text)
              text = finalizeAiSpeech(raw, player.name, 'declarations')
            } catch (err) {
              console.error(
                `[wolf] ${player.provider} (${player.name}) declarations failed:`,
                err
              )
              text = `[${player.name} did not respond]`
            }

            text = sanitizeStatementForPlayer(
              text,
              player.name,
              player.provider,
              'declarations'
            )

            try {
              await insertRowsWithFallback(
                'ai_responses',
                {
                  session_id: sessionId,
                  ai_name: player.name,
                  response_text: text,
                },
                {
                  session_id: sessionId,
                  ai_name: player.name,
                  content: text,
                }
              )
            } catch (dbErr) {
              console.error(
                `[wolf] ai_responses insert failed (${player.name}):`,
                dbErr
              )
            }

            send({
              type: 'statement',
              provider: player.provider,
              name: player.name,
              text,
              round: 1,
              statementType: 'declaration',
            })
          }

          send({ type: 'phase_complete', phase: 'declarations' })
          controller.close()
          return
        }

        if (action === 'attacks') {
          const sessionId =
            typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
          if (!sessionId) {
            fail('sessionId is required')
            return
          }
          const conv = conversation as ConversationTurn[]
          const historyText = buildAttackVoteHistoryText(conv, alivePlayers)
          const aliveBlock = buildUniversalAliveBlock(alivePlayers, userMode)
          const players = AI_PLAYERS.filter((p) => alivePlayers.includes(p.provider))
          const { gameRules } = getPlayerContext(alivePlayers, true)

          const selfBan = (
            pname: string,
            pid: string
          ) => `You are ${pname}. You must NEVER accuse or vote for yourself.
Your own provider ID is '${pid}'. 
Never include yourself as a suspect.

`

          for (const player of players) {
            const isWolf = wolfIds.includes(player.provider)
            const variedCit =
              player.provider === 'google'
                ? GEMINI_ATTACK_STYLE
                : CITIZEN_VARIED_STRATEGIES
            const freshGameState = buildWolfGameState({
              aliveProviderIds: alivePlayers,
              currentRound: round,
              userMode,
              wolfIds,
              eliminatedOverride,
            })
            const statePrefix = formatGameStateInjectionBlock(freshGameState, {
              includeWolfSecret: isWolf,
            })
            const sys = isWolf
              ? `${statePrefix}${langPre}${aliveBlock}${ATTACK_TONE_AGGRO_RULE}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}${NO_REPEAT_INSTRUCTION}${CRITICAL_NO_REUSE_RESPONSE}${selfBan(player.name, player.provider)}
YOU ARE THE WOLF. This is secret. Never reveal it.

CONVERSATION HISTORY:
${historyText}

Your task this round:
- Read the actual statements above carefully
- Never accuse or vote for yourself (see above).
- Reference only what actually appears in the history — do not invent quotes.
- Accuse at most ONE other player per round unless your survival strategy below says otherwise.

${WOLF_ADAPTIVE_STRATEGY}
${ATTACK_TONE_GUIDELINES}
80-130 words. First person.`
              : `${statePrefix}${langPre}${aliveBlock}${ATTACK_TONE_AGGRO_RULE}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}${NO_REPEAT_INSTRUCTION}${CRITICAL_NO_REUSE_RESPONSE}${selfBan(player.name, player.provider)}
You are a CITIZEN. Find the wolf.

CONVERSATION HISTORY:
${historyText}

Your task this round:
- Analyze ONLY the statements above for inconsistencies or suspicious patterns
- Accuse ONE other player ONLY (never yourself — see above), citing something they ACTUALLY said in the history
- Defend yourself if you were accused, referencing what was actually claimed
- Do NOT reference events or quotes not shown in the history

${variedCit}
${ATTACK_TONE_GUIDELINES}
80-130 words. First person. Be specific and analytical.`

            let text = `[${player.name} did not respond]`
            try {
              console.log(
                '[wolf] attacks AI call before',
                player.provider,
                player.name,
                'round',
                round
              )
              const maxTok = attacksMaxTokens(player.provider)
              const r = await runWolfAiWithTimeout(
                player,
                sys,
                `Round ${round} — this is a NEW round. Make NEW arguments based on what has happened so far. Do not repeat yourself. State your case. Who is the wolf?`,
                maxTok
              )
              console.log(
                '[wolf] attacks AI call after',
                player.provider,
                player.name
              )
              const raw =
                r.text ?? (r.error ? `[error] ${r.error}` : text)
              text = finalizeAiSpeech(raw, player.name, 'attacks')
            } catch (err) {
              console.error(
                `[wolf] ${player.provider} (${player.name}) attacks failed:`,
                err
              )
              text = `[${player.name} did not respond]`
            }

            text = sanitizeStatementForPlayer(
              text,
              player.name,
              player.provider,
              'attacks'
            )

            try {
              await insertRowsWithFallback(
                'ai_responses',
                {
                  session_id: sessionId,
                  ai_name: player.name,
                  response_text: text,
                },
                {
                  session_id: sessionId,
                  ai_name: player.name,
                  content: text,
                }
              )
            } catch (dbErr) {
              console.error(
                `[wolf] ai_responses insert failed (${player.name}):`,
                dbErr
              )
            }

            send({
              type: 'statement',
              provider: player.provider,
              name: player.name,
              text,
              round,
              statementType: 'attack',
            })
          }

          send({ type: 'phase_complete', phase: 'attacks' })
          controller.close()
          return
        }

        if (action === 'votes') {
          const sessionId =
            typeof body.sessionId === 'string' ? body.sessionId.trim() : ''
          if (!sessionId) {
            fail('sessionId is required')
            return
          }
          const tiebreaker = body.tiebreaker === true
          const tiebreakerCandidateIds = Array.isArray(body.tiebreakerCandidateIds)
            ? body.tiebreakerCandidateIds.filter(
                (p: unknown): p is string => typeof p === 'string'
              )
            : []
          const tieNamesCsv = tiebreakerCandidateIds
            .map((id) => AI_PLAYERS.find((a) => a.provider === id)?.name ?? id)
            .join(', ')
          const tiebreakerBlock =
            tiebreaker && tiebreakerCandidateIds.length > 0
              ? `TIEBREAKER VOTE. You must choose between: ${tieNamesCsv}. 
You cannot abstain. Pick one.

`
              : ''

          const conv = conversation as ConversationTurn[]
          const historyText = buildAttackVoteHistoryText(conv, alivePlayers)
          const aliveBlock = buildUniversalAliveBlock(alivePlayers, userMode)
          const players = AI_PLAYERS.filter((p) => alivePlayers.includes(p.provider))
          const { gameRules } = getPlayerContext(alivePlayers, true)
          const allVotes: Array<{
            voter: string
            voterName: string
            target: string
            reason: string
          }> = []

          const voteSelfBan = (pname: string, pid: string) =>
            `You are ${pname}. You must NEVER vote for yourself.
Your own provider ID is '${pid}'. Never target yourself.

`

          for (const player of players) {
            let otherAlive = alivePlayers.filter((p) => p !== player.provider)
            if (userMode !== 'challenge') {
              otherAlive = otherAlive.filter((p) => p !== 'user')
            }
            if (tiebreaker && tiebreakerCandidateIds.length > 0) {
              otherAlive = otherAlive.filter((p) =>
                tiebreakerCandidateIds.includes(p)
              )
            }
            if (!otherAlive.length) {
              console.error('[wolf] no vote targets for', player.name)
              continue
            }
            const votePool = otherAlive
            const isWolf = wolfIds.includes(player.provider)

            const otherAliveCsv = votePool.join(', ')
            const freshGameState = buildWolfGameState({
              aliveProviderIds: alivePlayers,
              currentRound: round,
              userMode,
              wolfIds,
              eliminatedOverride,
            })
            const statePrefix = formatGameStateInjectionBlock(freshGameState, {
              includeWolfSecret: isWolf,
            })
            const sys = isWolf
              ? `${statePrefix}${langPre}${aliveBlock}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}${NO_REPEAT_INSTRUCTION}${CRITICAL_NO_REUSE_RESPONSE}${tiebreakerBlock}${voteSelfBan(player.name, player.provider)}
YOU ARE THE WOLF.

CONVERSATION HISTORY:
${historyText}

Vote to eliminate ONE other citizen (never yourself — see above).
Look at who has been most suspicious of you in the history ONLY.

Respond with ONLY this JSON (no other text):
{"target": "provider_id", "reason": "one sentence citing actual conversation evidence"}

target must be one of: ${otherAliveCsv}`
              : `${statePrefix}${langPre}${aliveBlock}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}${NO_REPEAT_INSTRUCTION}${CRITICAL_NO_REUSE_RESPONSE}${tiebreakerBlock}${voteSelfBan(player.name, player.provider)}
You are a CITIZEN.

CONVERSATION HISTORY:
${historyText}

Vote for who you believe is the wolf — never yourself — based ONLY on the conversation above.

Respond with ONLY this JSON (no other text):
{"target": "provider_id", "reason": "one sentence citing actual conversation evidence"}

target must be one of: ${otherAliveCsv}`

            let raw = ''
            try {
              console.log(
                '[wolf] votes AI call before',
                player.provider,
                player.name
              )
              const r = await runWolfAiWithTimeout(
                player,
                sys,
                `Round ${round} — this is a NEW round. Make NEW arguments based on what has happened so far. Do not repeat yourself. Cast your vote now.`,
                120
              )
              console.log(
                '[wolf] votes AI call after',
                player.provider,
                player.name
              )
              raw = r.text?.trim() ?? ''
            } catch (err) {
              console.error(
                `[wolf] ${player.provider} (${player.name}) votes failed:`,
                err
              )
              raw = ''
            }

            if (isErrorResponse(raw)) {
              console.error(
                `${player.name} vote raw API error:`,
                raw.slice(0, 200)
              )
              raw = ''
            }

            let parsed = parseVoteResponse(raw, votePool)

            if (!votePool.includes(parsed.target)) {
              parsed = parseVoteResponse('', votePool)
            }

            let reasonOut = parsed.reason
            if (isBadAiOutput(reasonOut)) {
              console.error(`[wolf] votes: bad reason text (${player.provider})`, {
                sample: reasonOut.slice(0, 300),
              })
              reasonOut = 'No reason given.'
            } else if (reasonOut) {
              reasonOut = truncateAtLastSentence(reasonOut)
            }

            allVotes.push({
              voter: player.provider,
              voterName: player.name,
              target: parsed.target,
              reason: reasonOut,
            })

            try {
              await insertRowsWithFallback(
                'votes',
                {
                  session_id: sessionId,
                  voter_ai_name: player.name,
                  target_ai_name: parsed.target,
                  reason: reasonOut,
                },
                {
                  session_id: sessionId,
                  voter_ai_name: player.name,
                  target_ai_name: parsed.target,
                  response: reasonOut,
                }
              )
            } catch (dbErr) {
              console.error(
                `[wolf] votes insert failed (${player.name}):`,
                dbErr
              )
            }
          }

          if (userVote && userMode === 'challenge') {
            allVotes.push({
              voter: 'user',
              voterName: 'You',
              target: userVote,
              reason: 'User vote',
            })
            await insertRowsWithFallback(
              'votes',
              {
                session_id: sessionId,
                voter_ai_name: 'You',
                target_ai_name: userVote,
                reason: 'User vote',
              },
              {
                session_id: sessionId,
                voter_ai_name: 'user',
                target_ai_name: userVote,
                response: 'User vote',
              }
            )
          }

          send({ type: 'votes_complete', votes: allVotes })
          controller.close()
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Wolf pipeline failed'
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    },
  })
}
