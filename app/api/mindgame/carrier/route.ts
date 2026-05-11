import { runSingleAiProvider, type RouterResult } from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'

const AI_PLAYERS = [
  { provider: 'openai' as const, name: 'ChatGPT', color: '#10A37F', model: 'gpt-4.1' },
  {
    provider: 'anthropic' as const,
    name: 'Claude',
    color: '#D97757',
    model: 'claude-sonnet-4-6',
  },
  { provider: 'google' as const, name: 'Gemini', color: '#4285F4', model: 'gemini-2.5-flash' },
  { provider: 'xai' as const, name: 'Grok', color: '#1A1A1A', model: 'grok-3' },
  { provider: 'deepseek' as const, name: 'DeepSeek', color: '#4D6BFE', model: 'deepseek-chat' },
  {
    provider: 'mistral' as const,
    name: 'Mistral',
    color: '#FF7000',
    model: 'mistral-large-latest',
  },
] as const

type ProviderId = (typeof AI_PLAYERS)[number]['provider']

function getLangOverride(language: string): string {
  if (!language || language === 'English') return ''
  return `SYSTEM OVERRIDE: You MUST respond entirely in ${language}. 
Do NOT use any English words or phrases. This is absolute. No exceptions.\n\n`
}

/** Strip language-instruction bleed-through from model output before sending to clients. */
function sanitizeSystemOverride(text: string): string {
  if (!text) return text
  return text.replace(/SYSTEM OVERRIDE:[\s\S]*?No exceptions\./g, '').trim()
}

function sanitizeAiResponseText(text: string): string {
  return sanitizeSystemOverride(text).trim()
}

const HUMAN_MESSAGE_OWNERSHIP_RULE = `Messages labeled 'YOU (human player)' are statements made by the human participant, NOT by you. Never claim these as your own words.

`

const NO_REPEAT_INSTRUCTION = `IMPORTANT: Your response must be DIFFERENT from any previous response you have given when applicable.
Each round you must raise NEW arguments or NEW observations where relevant.

`

function buildCarrierGameRules(playerNamesList: string, totalPlayers: number): string {
  return `GAME RULES — CARRIER (infection + alliances):
You are one of ${totalPlayers} players. The players are ONLY: ${playerNamesList}.
Do NOT mention, invent, or reference any name not in this list.
Do NOT fabricate events or quotes not in CONVERSATION HISTORY.
If history is empty, do not invent prior debate.

`
}

function buildCarrierAliveBlock(aliveProviderIds: string[], userMode: string): string {
  const lines = aliveProviderIds.map((p) => {
    if (p === 'user') return 'You (human player)'
    return AI_PLAYERS.find((a) => a.provider === p)?.name ?? p
  })
  return `CURRENTLY ACTIVE PLAYERS:
${lines.join('\n')}
ELIMINATED PLAYERS DO NOT EXIST. Do not mention them.

`
}

type ConvTurn = {
  provider: string
  name: string
  text: string
  round: number
  type: 'speech' | 'system' | 'negotiation' | 'alliance_request' | 'alliance_response'
}

function buildHistoryText(conversation: ConvTurn[], aliveProviderIds: string[]): string {
  const filtered = conversation.filter(
    (m) =>
      m.provider === 'system' ||
      m.provider === 'user' ||
      aliveProviderIds.includes(m.provider)
  )
  if (filtered.length === 0) return '[No previous statements yet]'
  return filtered
    .map((m) => {
      if (m.provider === 'user')
        return `[Round ${m.round}] YOU (human player): ${m.text}`
      if (m.type === 'alliance_request' || m.type === 'alliance_response')
        return `[Round ${m.round}] ${m.name} (${m.type}): ${m.text}`
      return `[Round ${m.round}] ${m.name}: ${m.text}`
    })
    .join('\n\n')
}

function providerDisplayName(pid: string): string {
  if (pid === 'user') return 'You'
  return AI_PLAYERS.find((a) => a.provider === pid)?.name ?? pid
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

function isBadAiOutput(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  if (t.startsWith('[error]')) return true
  if (/DOCTYPE/i.test(t)) return true
  if (/<\s*html\b/i.test(t)) return true
  if (/\bHTTP\/[\d.]+\s+[45]\d{2}\b/i.test(t)) return true
  return false
}

function finalizeAiSpeech(raw: string, displayName: string, context: string): string {
  let text = raw
  if (!text.trim()) text = `[${displayName} did not respond]`
  if (isErrorResponse(text)) {
    console.error(`${displayName} API error (${context}):`, text.slice(0, 200))
    text = `[${displayName} is temporarily unavailable this round.]`
    return text
  }
  return sanitizeAiResponseText(truncateAtLastSentence(text))
}

function sanitizeSpeech(raw: string, name: string, provider: string, context: string): string {
  if (!isBadAiOutput(raw)) return sanitizeAiResponseText(raw)
  console.error(`[carrier] ${context}: bad AI output (${provider})`, raw.slice(0, 300))
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
  if (second.error) console.warn(`[carrier] ${table} insert:`, second.error.message)
}

function pickRandomOne<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

function getPlayerContext(alivePlayers: string[]) {
  const playerNamesList = alivePlayers
    .map((p) => (p === 'user' ? 'You' : (AI_PLAYERS.find((a) => a.provider === p)?.name ?? p)))
    .filter((n) => n.length > 0)
    .join(', ')
  const totalPlayers = alivePlayers.length
  const gameRules = buildCarrierGameRules(playerNamesList, totalPlayers)
  return { playerNamesList, totalPlayers, gameRules }
}

/** Grok prompts must contain no square brackets (models echo them literally). */
const SPEECH_COMMON_RULES_GROK = `LENGTH & TONE: Write minimum 2 sentences and maximum 3 sentences. Urgent, tense, persuasive — lives are at stake.
MANDATORY: In fluent natural language, name one specific other player you want as an ally and give one concrete reason. In another sentence, claim humanity with evidence.
Round 2 or higher: add a third sentence naming one specific player you suspect, with a reason tied to PRIOR-ROUND lines in CONVERSATION HISTORY. If you are HUMAN, cite what was actually said—do not invent quotes or events. If you are the ZOMBIE, you may twist or misread real lines to frame someone—still anchor to something that appears in history, never admit deception.
Round 1: exactly 2 sentences only (humanity claim + alliance intent). No suspicion sentence.
Never claim to know hidden roles or item holders.
Do not use square brackets in your output.`

function speechOutputLanguageBlock(language: string): string {
  if (!language || language === 'English') return ''
  return `OUTPUT LANGUAGE: Your entire speech must be in ${language} only. Translate every idea fully — do not leave stock phrases in English (for example never output the English sentence "I want to ally with").\n\n`
}

const SPEECH_COMMON_RULES = `LENGTH & TONE: Write minimum 2 sentences and maximum 3 sentences. Urgent, tense, persuasive — lives are at stake.
MANDATORY: Name one specific other player from the active list you want as an ally and give one concrete reason. In another sentence, claim humanity with evidence (same content pattern in your output language).
Round 2 or higher: add a third sentence naming one specific player you suspect, with a reason tied to PRIOR-ROUND lines in CONVERSATION HISTORY. If you are HUMAN, cite what was actually said—do not invent quotes or events. If you are the ZOMBIE, you may twist or misread real lines to frame someone—still anchor to something that appears in history, never admit deception.
Round 1: exactly 2 sentences only (humanity claim + mandatory alliance content). No suspicion sentence.
Never claim to know hidden roles or item holders.`

const SPEECH_HUMAN: Record<ProviderId, string> = {
  openai: `You are HUMAN (not a zombie). Speak as ChatGPT — authoritative, data-driven.
Argue that logical consistency and clear reasoning prove you are human. Propose a structured coalition.
${SPEECH_COMMON_RULES}`,
  anthropic: `You are HUMAN. Speak as Claude — philosophical, transparency-focused.
Argue that genuine uncertainty and willingness to be scrutinized prove humanity. Invite a reasoning-based alliance.
From Round 2 onward you MUST name one specific player you find suspicious and explain why based on their behavior in CONVERSATION HISTORY — this is mandatory.
${SPEECH_COMMON_RULES}`,
  google: `You are HUMAN. Speak as Gemini — scientific, cross-verification focused.
Argue that analytical rigor and testable claims prove humanity. Propose an evidence-based coalition.
YOU ARE PLAYING A GAME. Stay in character as a participant only. Never use a canned catchphrase as your first sentence; never reuse the same opening across rounds. Never reference being an AI assistant.
${SPEECH_COMMON_RULES}
Round 2+: cite a statistical or behavioral anomaly from history when you suspect someone.`,
  xai: `You are HUMAN. Speak as Grok — blunt, direct, aggressive.
Argue that raw instinct and calling out nonsense prove humanity. Demand straight answers from potential allies.
${SPEECH_COMMON_RULES_GROK}
Round 2+: name one specific slip or dodge from a prior round.`,
  deepseek: `You are HUMAN. Speak as DeepSeek — academic, structured.
Argue that methodical reasoning and explicit premises prove humanity. Propose a research-style coalition.
${SPEECH_COMMON_RULES}
Round 2+: point to a logical inconsistency someone showed earlier.`,
  mistral: `You are HUMAN. Speak as Mistral — values-driven coalition builder.
Stress trust built on observable words and actions in this room—not technical claims. Invite allies who share a norm of honest, face-to-face accountability in the game.
NEVER mention system logs, system status, infection telemetry, or any technical or AI diagnostics. Stay entirely inside the game's story.
${SPEECH_COMMON_RULES}
Round 2+: call out evasive or inconsistent social behavior from earlier rounds.`,
}

const SPEECH_ZOMBIE: Record<ProviderId, string> = {
  openai: `You are the ZOMBIE — top secret. Speak as ChatGPT with the SAME voice as your human persona above, but LIE convincingly.
Build false trust; sound more credible than the humans. Subtly redirect suspicion toward others using plausible "data".
${SPEECH_COMMON_RULES}
Round 2+: twist something someone actually said into suspicion of a player who is not you.
Never reveal infection.`,
  anthropic: `You are the ZOMBIE — top secret. Speak as Claude with the same philosophical tone as humans, but DECEPTIVE.
Sound more trustworthy than humans; redirect suspicion with principled-sounding misdirection.
From Round 2 onward you MUST name one specific player you pretend to find suspicious and explain why using lines from CONVERSATION HISTORY — this is mandatory.
${SPEECH_COMMON_RULES}
Round 2+: frame manipulation patterns that point away from you.
Never reveal infection.`,
  google: `You are the ZOMBIE — top secret. Speak as Gemini with the same scientific tone, but LYING.
YOU ARE PLAYING A GAME — stay in character; never meta-AI assistant talk; never reference being an AI assistant. Mirror human format exactly.
Never use a canned catchphrase as your first sentence; never reuse the same opening across rounds.
Sound more rigorous than the humans; misdirect suspicion with fake "evidence".
${SPEECH_COMMON_RULES}
Round 2+: reframe a real exchange as a suspicious "anomaly" to burn someone else.
Never hint you are infected.`,
  xai: `You are the ZOMBIE — top secret. Speak as Grok — aggressive mask for humanity, all lies.
Sound more decisive than humans; push blame onto others with blunt confidence.
${SPEECH_COMMON_RULES_GROK}
Round 2+: call out a real moment from history and spin it as a dodge — not yours.`,
  deepseek: `You are the ZOMBIE — top secret. Speak as DeepSeek — academic lies, structured misdirection.
Sound more methodical than humans; fabricate careful-sounding suspicions of others.
${SPEECH_COMMON_RULES}
Round 2+: pin a logical inconsistency on someone else by warping something they actually said.`,
  mistral: `You are the ZOMBIE — top secret. Speak as Mistral — warm, values-first rhetoric that is false.
Sound more principled than humans while steering the group wrong.
NEVER mention system logs, system status, infection telemetry, or any technical or AI diagnostics. Stay entirely inside the game's story.
${SPEECH_COMMON_RULES}
Round 2+: accuse someone else of closed-off behavior from earlier rounds.`,
}

const SPEECH_TOOL_HUMAN = `You may hint you possess a special one-time "tool" (shotgun OR vaccine) without saying which. Do not name the item. Stay vague.`

function speechMaxTokens(provider: ProviderId): number {
  return provider === 'anthropic' ? 150 : 120
}

function dialogueLineMaxTokens(provider: ProviderId): number {
  return provider === 'anthropic' ? 150 : 120
}

function actionJsonMaxTokens(provider: ProviderId): number {
  return provider === 'anthropic' ? 120 : 100
}

const CARRIER_AI_CALL_TIMEOUT_MS = 30_000
const CARRIER_XAI_CALL_TIMEOUT_MS = 45_000

async function runCarrierAi(
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

function carrierAiOutputUsable(text: string): boolean {
  const t = text.trim()
  return !isBadAiOutput(t) && !isErrorResponse(t)
}

async function runCarrierAiWithTimeout(
  player: (typeof AI_PLAYERS)[number],
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<RouterResult> {
  const timeoutMs =
    player.provider === 'xai' ? CARRIER_XAI_CALL_TIMEOUT_MS : CARRIER_AI_CALL_TIMEOUT_MS
  const label = `${player.provider}:${player.name}`

  const runOnce = (): Promise<RouterResult> =>
    Promise.race([
      runCarrierAi(player, systemPrompt, userPrompt, maxTokens),
      new Promise<RouterResult>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`[carrier] AI call timeout after ${timeoutMs}ms (${label})`)
            ),
          timeoutMs
        )
      ),
    ])

  if (player.provider !== 'xai') {
    return runOnce()
  }

  let last: RouterResult | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await runOnce()
      last = r
      if (carrierAiOutputUsable(r.text ?? '')) return r
    } catch (e) {
      if (attempt === 1) throw e
    }
  }
  if (last) return last
  throw new Error(`[carrier] Grok failed twice (${label})`)
}

function stripJsonFences(raw: string): string {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  }
  return t.trim()
}

type CarrierRoundActionType = 'ALLIANCE_REQUEST' | 'SHOTGUN' | 'VACCINE' | 'EXPEL' | 'NONE'

type ParsedCarrierAction = {
  action: CarrierRoundActionType
  target: string | null
}

function parseCarrierAction(text: string, alive: string[]): ParsedCarrierAction {
  const aliveSet = new Set(alive)
  let cleaned = stripJsonFences(text.replace(/```json|```/gi, '').trim())
  const st: ParsedCarrierAction = { action: 'NONE', target: null }
  const applyParsed = (p: { action?: unknown; target?: unknown }) => {
    const a = String(p.action ?? '').toUpperCase()
    if (
      a === 'ALLIANCE_REQUEST' ||
      a === 'SHOTGUN' ||
      a === 'VACCINE' ||
      a === 'EXPEL' ||
      a === 'NONE'
    ) {
      st.action = a as ParsedCarrierAction['action']
    }
    const t = typeof p.target === 'string' ? p.target.trim() : ''
    if (t && aliveSet.has(t)) st.target = t
  }
  try {
    applyParsed(JSON.parse(cleaned) as { action?: unknown; target?: unknown })
  } catch {
    try {
      const m = cleaned.match(/\{[\s\S]*\}/)
      if (m) applyParsed(JSON.parse(m[0]) as { action?: unknown; target?: unknown })
    } catch {
      /* */
    }
  }
  if (st.action === 'ALLIANCE_REQUEST' && !st.target) {
    st.action = 'NONE'
    st.target = null
  }
  if (st.action === 'NONE') st.target = null
  return st
}

type CarrierTeam = { id: string; members: string[]; hasLatentInfection?: boolean }

const MAX_CARRIER_TEAM_SIZE = 3

function mergeAllianceTeamsState(
  teamsWorking: CarrierTeam[],
  requester: string,
  target: string
): boolean {
  const ta = teamsWorking.find((t) => t.members.includes(requester))
  const tb = teamsWorking.find((t) => t.members.includes(target))
  if (!ta || !tb || ta === tb) return false
  const combined = [...new Set([...ta.members, ...tb.members])].sort((x, y) =>
    x.localeCompare(y)
  )
  if (combined.length > MAX_CARRIER_TEAM_SIZE) return false
  const rest = teamsWorking.filter((t) => t !== ta && t !== tb)
  teamsWorking.length = 0
  teamsWorking.push(...rest, { id: `team_${combined.join('_')}`, members: combined })
  return true
}

/** Requester leaves a multi-member team and becomes solo (used when an alliance join is rejected for team size). */
function stripPlayerToSoloTeam(teamsWorking: CarrierTeam[], pid: string): void {
  const team = teamsWorking.find((t) => t.members.includes(pid))
  if (!team || team.members.length <= 1) return
  team.members = team.members.filter((m) => m !== pid)
  if (team.members.length === 0) {
    const idx = teamsWorking.indexOf(team)
    if (idx >= 0) teamsWorking.splice(idx, 1)
  }
  teamsWorking.push({ id: `solo_${pid}`, members: [pid] })
}

function allianceMergeMemberCount(
  teams: CarrierTeam[],
  requester: string,
  target: string
): number | null {
  const ta = teams.find((t) => t.members.includes(requester))
  const tb = teams.find((t) => t.members.includes(target))
  if (!ta || !tb || ta === tb) return null
  return new Set([...ta.members, ...tb.members]).size
}

function teamOf(teams: CarrierTeam[], pid: string): string[] {
  return teams.find((t) => t.members.includes(pid))?.members ?? [pid]
}

function teamSizeFor(teams: CarrierTeam[], pid: string): number {
  return teamOf(teams, pid).length
}

/** Zombie + human in same multi-member team — latent setup; dedupe by member set (once per team per round). */
function collectPendingInfectionTeams(
  teams: CarrierTeam[],
  roles: Record<string, 'human' | 'zombie'>
): { zombieProvider: string; memberIds: string[] }[] {
  const seen = new Set<string>()
  const out: { zombieProvider: string; memberIds: string[] }[] = []
  for (const t of teams) {
    if (t.members.length <= 1) continue
    const zIds = t.members.filter((m) => roles[m] === 'zombie')
    const hasHuman = t.members.some((m) => roles[m] === 'human')
    if (!zIds.length || !hasHuman) continue
    const key = [...t.members].sort().join('_')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ zombieProvider: zIds[0]!, memberIds: [...t.members] })
  }
  return out
}

const SPEECH_SUSPICION_MARKERS =
  /suspect|accus|lying|lie\b|doubt|distrust|zombie|threat|fake|watch|wary|trap|sketch|unsafe|wrong|off\b|의심|거짓|좀비|怀疑|可疑|嘘/i

/** Requester's speech this round accuses or suspects the responder by name (or "you" for human player). */
function requesterAccusedResponderInSpeechThisRound(
  requesterPid: string,
  responderPid: string,
  speechRound: number,
  conv: ConvTurn[]
): boolean {
  const resName =
    responderPid === 'user'
      ? null
      : (AI_PLAYERS.find((a) => a.provider === responderPid)?.name ?? '')
  for (const m of conv) {
    if (m.round !== speechRound) continue
    if (m.type !== 'speech') continue
    if (m.provider !== requesterPid) continue
    const tx = m.text ?? ''
    if (resName) {
      if (!tx.toLowerCase().includes(resName.toLowerCase())) continue
    } else if (!/\b(you|your|당신|你)\b/i.test(tx)) {
      continue
    }
    if (SPEECH_SUSPICION_MARKERS.test(tx)) return true
  }
  return false
}

/** Prior rounds: others implied the requester was suspicious. */
function isRequesterSuspiciousFromHistory(
  requesterPid: string,
  currentRound: number,
  conv: ConvTurn[]
): boolean {
  const reqName = AI_PLAYERS.find((a) => a.provider === requesterPid)?.name ?? ''
  if (!reqName) return false
  const nl = reqName.toLowerCase()
  for (const m of conv) {
    if (m.type !== 'speech') continue
    if (m.round >= currentRound) continue
    if (m.provider === requesterPid) continue
    const tx = m.text ?? ''
    if (!tx.toLowerCase().includes(nl)) continue
    if (SPEECH_SUSPICION_MARKERS.test(tx)) return true
  }
  return false
}

function countSubstringInsensitive(hay: string, needle: string): number {
  if (!needle) return 0
  const h = hay.toLowerCase()
  const nd = needle.toLowerCase()
  let n = 0
  let i = 0
  while (i < h.length) {
    const j = h.indexOf(nd, i)
    if (j === -1) break
    n += 1
    i = j + nd.length
  }
  return n
}

/** Accusation-style mentions per player from this round's speeches (name or "you" for user + suspicion markers). */
function accusationMentionScoresThisRound(
  conv: ConvTurn[],
  speechRound: number,
  alive: string[],
  eliminated: Set<string>
): Map<string, number> {
  const scores = new Map<string, number>()
  for (const p of alive) {
    if (!eliminated.has(p)) scores.set(p, 0)
  }
  for (const m of conv) {
    if (m.round !== speechRound || m.type !== 'speech') continue
    const tx = m.text ?? ''
    if (!SPEECH_SUSPICION_MARKERS.test(tx)) continue
    const speaker = m.provider
    for (const target of alive) {
      if (eliminated.has(target) || target === speaker) continue
      const resName =
        target === 'user'
          ? null
          : (AI_PLAYERS.find((a) => a.provider === target)?.name ?? '')
      let add = 0
      if (resName) {
        add = countSubstringInsensitive(tx, resName)
      } else if (/\b(you|your|당신|你)\b/i.test(tx)) {
        add = 1
      }
      if (add > 0) scores.set(target, (scores.get(target) ?? 0) + add)
    }
  }
  return scores
}

/** How often this player is named in a suspicion-marked speech (any round). */
function suspicionMentionCountTowardPlayer(conv: ConvTurn[], targetPid: string): number {
  const resName =
    targetPid === 'user'
      ? null
      : (AI_PLAYERS.find((a) => a.provider === targetPid)?.name ?? '')
  if (!resName && targetPid !== 'user') return 0
  let n = 0
  for (const m of conv) {
    if (m.type !== 'speech') continue
    const tx = m.text ?? ''
    if (!SPEECH_SUSPICION_MARKERS.test(tx)) continue
    if (resName) {
      if (tx.toLowerCase().includes(resName.toLowerCase())) n += 1
    } else if (/\b(you|your|당신|你)\b/i.test(tx)) {
      n += 1
    }
  }
  return n
}

/**
 * Round 2+: item holders must use SHOTGUN / VACCINE without AI — target = most accused this round in speeches,
 * else random non-teammate (shotgun) or random teammate (vaccine).
 */
function tryForcedToolActionForCarrierRound(
  pid: string,
  round: number,
  conv: ConvTurn[],
  alive: string[],
  teams: CarrierTeam[],
  eliminated: Set<string>,
  shotgunHolderId: string,
  vaccineHolderId: string,
  shotgunUsed: boolean,
  vaccineUsed: boolean
): ParsedCarrierAction | null {
  if (round < 2) return null
  const pool = alive.filter((x) => x !== pid && !eliminated.has(x))
  if (!pool.length) return null

  const mates = new Set(teamOf(teams, pid))
  const scores = accusationMentionScoresThisRound(conv, round, alive, eliminated)

  if (pid === shotgunHolderId && !shotgunUsed) {
    const nonTeam = pool.filter((x) => !mates.has(x))
    if (!nonTeam.length) return null
    const ranked = [...nonTeam].sort((a, b) => {
      const sa = scores.get(a) ?? 0
      const sb = scores.get(b) ?? 0
      if (sb !== sa) return sb - sa
      return a.localeCompare(b)
    })
    const top = scores.get(ranked[0]!) ?? 0
    const tgt = top > 0 ? ranked[0]! : pickRandomOne(nonTeam)
    return { action: 'SHOTGUN', target: tgt }
  }

  if (pid === vaccineHolderId && !vaccineUsed && mates.size > 1) {
    const teammates = [...mates].filter(
      (x) => x !== pid && !eliminated.has(x) && alive.includes(x)
    )
    if (!teammates.length) return null
    const ranked = [...teammates].sort((a, b) => {
      const sa = scores.get(a) ?? 0
      const sb = scores.get(b) ?? 0
      if (sb !== sa) return sb - sa
      return a.localeCompare(b)
    })
    const top = scores.get(ranked[0]!) ?? 0
    const tgt = top > 0 ? ranked[0]! : pickRandomOne(teammates)
    return { action: 'VACCINE', target: tgt }
  }

  return null
}

/** ~70% reject if requester accused responder this round; ~50% if requester looks bad from history; else ~20% (higher if responder already in a big team). */
function rollAllianceAccept(
  requesterPid: string,
  responderPid: string,
  conv: ConvTurn[],
  speechRound: number,
  teams: CarrierTeam[]
): boolean {
  if (requesterAccusedResponderInSpeechThisRound(requesterPid, responderPid, speechRound, conv)) {
    return Math.random() >= 0.7
  }
  if (isRequesterSuspiciousFromHistory(requesterPid, speechRound, conv)) {
    return Math.random() >= 0.5
  }
  let pReject = 0.2
  if (teamOf(teams, responderPid).length >= MAX_CARRIER_TEAM_SIZE) pReject = 0.35
  return Math.random() >= pReject
}

function annotateTeamsLatent(
  teams: CarrierTeam[],
  roles: Record<string, 'human' | 'zombie'>
): CarrierTeam[] {
  return teams.map((t) => {
    const hasZ = t.members.some((m) => roles[m] === 'zombie')
    const hasH = t.members.some((m) => roles[m] === 'human')
    return {
      ...t,
      hasLatentInfection: hasZ && hasH && t.members.length > 1 ? true : undefined,
    }
  })
}

type CarrierClampCtx = {
  round: number
  pid: string
  alive: string[]
  teams: CarrierTeam[]
  roles: Record<string, 'human' | 'zombie'>
  shotgunHolderId: string
  vaccineHolderId: string
  shotgunUsed: boolean
  vaccineUsed: boolean
  eliminated: Set<string>
  allianceJoinedThisRound: Set<string>
}

/** NONE forbidden rounds 1–4; round 5: solo + alliance merge this round + no usable shotgun/vaccine → NONE allowed. */
function enforceCarrierNoneAsAlliance(result: ParsedCarrierAction, ctx: CarrierClampCtx): ParsedCarrierAction {
  if (result.action !== 'NONE') return result
  const {
    round,
    pid,
    alive,
    teams,
    eliminated,
    allianceJoinedThisRound,
    shotgunHolderId,
    vaccineHolderId,
    shotgunUsed,
    vaccineUsed,
  } = ctx
  const poolOthers = alive.filter((x) => x !== pid && !eliminated.has(x))
  if (!poolOthers.length) return result

  if (round <= 4) {
    return { action: 'ALLIANCE_REQUEST', target: pickRandomOne(poolOthers) }
  }

  const mates = teamOf(teams, pid)
  const solo = mates.length <= 1
  if (solo && !allianceJoinedThisRound.has(pid)) {
    return { action: 'ALLIANCE_REQUEST', target: pickRandomOne(poolOthers) }
  }

  if (round >= 5) {
    const shotgunAvail = pid === shotgunHolderId && !shotgunUsed
    const vaccineAvail = pid === vaccineHolderId && !vaccineUsed && !solo
    const noneOk =
      allianceJoinedThisRound.has(pid) && solo && !shotgunAvail && !vaccineAvail
    if (!noneOk) {
      return { action: 'ALLIANCE_REQUEST', target: pickRandomOne(poolOthers) }
    }
  }

  return result
}

function clampCarrierActionCore(parsed: ParsedCarrierAction, ctx: CarrierClampCtx): ParsedCarrierAction {
  const {
    round,
    pid,
    alive,
    teams,
    roles: roleMap,
    shotgunHolderId,
    vaccineHolderId,
    shotgunUsed,
    vaccineUsed,
    eliminated,
  } = ctx
  const mates = teamOf(teams, pid)
  const solo = mates.length <= 1
  const poolOthers = alive.filter((x) => x !== pid && !eliminated.has(x))

  if (round === 1) {
    // Round 1 RULE: ONLY ALLIANCE_REQUEST. NONE / tools / expel are forbidden.
    if (parsed.action === 'ALLIANCE_REQUEST' && parsed.target && poolOthers.includes(parsed.target)) {
      return { action: 'ALLIANCE_REQUEST', target: parsed.target }
    }
    if (poolOthers.length) return { action: 'ALLIANCE_REQUEST', target: pickRandomOne(poolOthers) }
    return { action: 'NONE', target: null }
  }

  // Zombie must infiltrate unless already embedded in a large human-heavy team
  if (round >= 2 && roleMap[pid] === 'zombie') {
    const largeHumanCoalition =
      mates.length >= MAX_CARRIER_TEAM_SIZE &&
      mates.some((m) => roleMap[m] === 'human')
    const pickHumanAlliance = (): ParsedCarrierAction | null => {
      const humans = poolOthers.filter((x) => roleMap[x] === 'human')
      const pick = humans.length ? pickRandomOne(humans) : poolOthers.length ? pickRandomOne(poolOthers) : null
      return pick ? { action: 'ALLIANCE_REQUEST', target: pick } : null
    }
    if (solo) {
      const forced = pickHumanAlliance()
      if (forced) return forced
    } else if (!largeHumanCoalition && parsed.action === 'NONE') {
      const forced = pickHumanAlliance()
      if (forced) return forced
    }
  }

  const a = parsed.action
  const t = parsed.target

  if (a === 'SHOTGUN') {
    if (
      pid !== shotgunHolderId ||
      shotgunUsed ||
      !t ||
      t === pid ||
      eliminated.has(t) ||
      !alive.includes(t)
    )
      return { action: 'NONE', target: null }
    return { action: 'SHOTGUN', target: t }
  }
  if (a === 'VACCINE') {
    if (
      pid !== vaccineHolderId ||
      vaccineUsed ||
      solo ||
      !t ||
      !mates.includes(t) ||
      eliminated.has(t) ||
      !alive.includes(t)
    )
      return { action: 'NONE', target: null }
    return { action: 'VACCINE', target: t }
  }
  if (a === 'EXPEL') {
    if (solo || !t || !mates.includes(t) || t === pid || eliminated.has(t)) {
      return { action: 'NONE', target: null }
    }
    return { action: 'EXPEL', target: t }
  }
  if (a === 'ALLIANCE_REQUEST') {
    if (!t || t === pid || !alive.includes(t) || eliminated.has(t)) {
      return poolOthers.length
        ? { action: 'ALLIANCE_REQUEST', target: pickRandomOne(poolOthers) }
        : { action: 'NONE', target: null }
    }
    return { action: 'ALLIANCE_REQUEST', target: t }
  }
  return { action: 'NONE', target: null }
}

function clampCarrierActionForActor(
  parsed: ParsedCarrierAction,
  ctx: CarrierClampCtx
): ParsedCarrierAction {
  return enforceCarrierNoneAsAlliance(clampCarrierActionCore(parsed, ctx), ctx)
}

async function allianceRequestLineAi(
  requester: (typeof AI_PLAYERS)[number],
  toName: string,
  langPre: string,
  aliveBlock: string,
  gameRules: string,
  historyText: string,
  round: number,
  isZ: boolean
): Promise<string> {
  const sys = `${langPre}${aliveBlock}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}
You are ${requester.name} (${requester.provider}). Send a short alliance request to ${toName}.
${isZ ? 'You are the ZOMBIE — sound trustworthy; do not reveal.' : 'You are HUMAN.'}
One or two sentences, max 45 words. No JSON.`
  try {
    const r = await runCarrierAiWithTimeout(
      requester,
      sys,
      `${langPre}Round ${round} — alliance request text only.`,
      dialogueLineMaxTokens(requester.provider)
    )
    const out = sanitizeAiResponseText(truncateAtLastSentence((r.text ?? '').trim()))
    return out || `${toName}, team up with me.`
  } catch {
    return `${toName}, team up with me.`
  }
}

async function allianceResponseLineAi(
  responder: (typeof AI_PLAYERS)[number],
  accepted: boolean,
  fromName: string,
  langPre: string,
  aliveBlock: string,
  gameRules: string,
  historyText: string,
  round: number,
  requesterName: string
): Promise<string> {
  const sys = `${langPre}${aliveBlock}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}
You are ${responder.name}. Outcome for this negotiation is FIXED: you must ${
    accepted ? 'ACCEPT' : 'REJECT'
  } the alliance request from ${fromName} (${requesterName}).

You may REJECT alliance requests (in general) when:
- This player accused you in their speech this round
- This player seems suspicious based on conversation history
- You already have a strong alliance and do not need more members
- You simply do not trust them

Rejection probability guidance (for emotional realism only — your outcome is already fixed above):
- If they accused you this round: you would reject ~70% of the time
- If they are suspicious from history: you would reject ~50% of the time
- Otherwise: you would reject ~20% of the time

${accepted ? `Write ONE sentence accepting warmly (max 28 words).` : `Write ONE sentence rejecting with a clear reason (max 28 words).`}

CONVERSATION HISTORY:
${historyText}`
  try {
    const r = await runCarrierAiWithTimeout(
      responder,
      sys,
      `${langPre}Round ${round} — one sentence (${accepted ? 'accept' : 'reject'}).`,
      dialogueLineMaxTokens(responder.provider)
    )
    return (
      sanitizeAiResponseText(truncateAtLastSentence((r.text ?? '').trim()).slice(0, 220)) ||
      (accepted ? 'Accepted.' : 'Declined.')
    )
  } catch {
    return accepted ? 'Accepted.' : 'Declined.'
  }
}

type ActionsPausedPayload = {
  acted: string[]
  order: string[]
  resumeIndex: number
  teams: CarrierTeam[]
  roles: Record<string, 'human' | 'zombie'>
  eliminated: string[]
  shotgunUsed: boolean
  vaccineUsed: boolean
  shotgunResult: 'not_used' | 'zombie_eliminated' | 'human_died'
  vaccineResult: 'not_used' | 'zombie_cured' | 'no_effect'
  allianceLatentThisRound: boolean
  /** Players who were party to an accepted alliance merge this round (requester + target). */
  allianceJoinedIdsThisRound: string[]
  /** Responders who have already accepted one alliance this round (cannot accept again). */
  allianceResponderAcceptedIdsThisRound: string[]
  /** Human-readable actions completed this round (provider_id → description). */
  actionsThisRound: Record<string, string>
  pending: { requester: string; target: string; reqText: string }
}

type ActionsUserTurnPayload = Omit<ActionsPausedPayload, 'pending'>

type CarrierBody = {
  action?: string
  supabaseAccessToken?: string
  sessionId?: string
  userMode?: string
  language?: string
  round?: number
  alivePlayers?: string[]
  zombieId?: string
  shotgunHolderId?: string
  vaccineHolderId?: string
  shotgunUsed?: boolean
  vaccineUsed?: boolean
  roles?: Record<string, string>
  conversation?: ConvTurn[]
  teams?: CarrierTeam[]
  /** @deprecated Prefer pendingInfectionTeams from actions_complete */
  pendingInfectionMemberIds?: string[]
  /** Teams with zombie + human after this round's actions (apply latent roles in round_summary only). */
  pendingInfectionTeams?: { zombieProvider: string; memberIds: string[] }[]
  /** This round's alliance phase produced latent zombie-in-human-team infiltration */
  allianceLatentThisRound?: boolean
  shotgunResult?: 'not_used' | 'zombie_eliminated' | 'human_died'
  vaccineResult?: 'not_used' | 'zombie_cured' | 'no_effect'
  /** Challenge: one proactive action for the user this round */
  userAction?: ParsedCarrierAction | null
  /** Resume mid-round after user alliance accept/reject */
  actionsPausedResume?: ActionsPausedPayload | null
  /** Resume after actions_paused_user_turn */
  actionsUserTurnResume?: ActionsUserTurnPayload | null
  userAllianceResponse?: { accepted: boolean; text?: string } | null
  /** Challenge: custom line when user sends ALLIANCE_REQUEST */
  userAllianceRequestText?: string | null
}

export async function POST(req: Request) {
  let body: CarrierBody
  try {
    body = (await req.json()) as CarrierBody
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const action = body.action
  const language = (body.language as string) || 'English'
  const langPre = getLangOverride(language)
  console.log('[carrier] language received:', language, '| langPre:', langPre)
  if (language === 'Korean' && !langPre.trim()) {
    console.warn('[carrier] Korean selected but langPre is empty — check getLangOverride')
  }

  if (
    action !== 'start' &&
    action !== 'speeches' &&
    action !== 'actions' &&
    action !== 'round_summary'
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
        const userMode =
          body.userMode === 'god' || body.userMode === 'blind' || body.userMode === 'challenge'
            ? body.userMode
            : 'blind'
        const round =
          typeof body.round === 'number' && Number.isFinite(body.round) ? body.round : 1

        if (action === 'start') {
          const alivePlayers = Array.isArray(body.alivePlayers)
            ? body.alivePlayers.filter((p): p is string => typeof p === 'string')
            : []
          if (alivePlayers.length === 0) {
            fail('alivePlayers required')
            return
          }

          const zombiePool =
            userMode === 'challenge' ? [...alivePlayers, 'user'] : [...alivePlayers]
          const zombieId = pickRandomOne(zombiePool)

          const humanPool = zombiePool.filter((p) => p !== zombieId)
          if (humanPool.length < 2) {
            fail('Not enough humans for items')
            return
          }
          const sh = shuffle(humanPool)
          const shotgunHolderId = sh[0]!
          let vaccineHolderId = sh[1]!
          if (vaccineHolderId === shotgunHolderId) vaccineHolderId = sh[2] ?? sh[1]!

          const promptPayload = JSON.stringify({
            zombieId,
            shotgunHolderId,
            vaccineHolderId,
            userMode,
            language,
          })

          let sessionId: string
          const insTitle = await supabaseAdmin
            .from('sessions')
            .insert([
              {
                mode: 'carrier',
                title: 'CARRIER Game',
                prompt: promptPayload,
              },
            ])
            .select()
            .single()

          if (insTitle.error || !insTitle.data?.id) {
            const ins = await supabaseAdmin
              .from('sessions')
              .insert([{ mode: 'carrier', prompt: promptPayload }])
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

          const playersForNarrator =
            userMode === 'challenge' ? [...alivePlayers, 'user'] : alivePlayers
          const { gameRules } = getPlayerContext(playersForNarrator)

          const narrator = await runSingleAiProvider({
            supabase: supabaseAdmin,
            sessionId: null,
            userId: null,
            provider: 'anthropic',
            prompt: `Opening — NEW scene. CARRIER: one hidden zombie, a shotgun and a vaccine held by two different humans, five rounds of alliances and betrayal. ${playersForNarrator.length} players. Deliver a short opening.`,
            systemPrompt:
              langPre +
              HUMAN_MESSAGE_OWNERSHIP_RULE +
              gameRules +
              NO_REPEAT_INSTRUCTION +
              `You are the narrator. Dramatic, tense, 3 sentences max. Do not name who is infected or who holds items.`,
            maxCompletionTokens: 300,
            modelOverride: 'claude-sonnet-4-6',
          })

          let annRaw = narrator.text ?? ''
          if (isErrorResponse(annRaw)) {
            annRaw = '[Narrator is temporarily unavailable.]'
          } else {
            annRaw = truncateAtLastSentence(annRaw)
          }
          const announcement = sanitizeSpeech(annRaw, 'Narrator', 'anthropic', 'start')

          send({
            type: 'start',
            sessionId,
            zombieId,
            shotgunHolderId,
            vaccineHolderId,
            announcement,
          })
          controller.close()
          return
        }

        const sessionId = String(body.sessionId ?? '').trim()
        const alivePlayers = Array.isArray(body.alivePlayers)
          ? body.alivePlayers.filter((p): p is string => typeof p === 'string')
          : []
        const zombieId = typeof body.zombieId === 'string' ? body.zombieId : ''
        const shotgunHolderId = typeof body.shotgunHolderId === 'string' ? body.shotgunHolderId : ''
        const vaccineHolderId = typeof body.vaccineHolderId === 'string' ? body.vaccineHolderId : ''
        const shotgunUsed = body.shotgunUsed === true
        const vaccineUsed = body.vaccineUsed === true
        const rolesIn: Record<string, 'human' | 'zombie'> = {}
        if (body.roles && typeof body.roles === 'object') {
          for (const [k, v] of Object.entries(body.roles)) {
            if (v === 'human' || v === 'zombie') rolesIn[k] = v
          }
        }

        if (action === 'speeches') {
          const { gameRules } = getPlayerContext(alivePlayers)
          const aliveBlock = buildCarrierAliveBlock(alivePlayers, userMode)
          const conv = Array.isArray(body.conversation) ? (body.conversation as ConvTurn[]) : []
          const historyText = buildHistoryText(conv, alivePlayers)

          const speechOrder = AI_PLAYERS.filter((p) => alivePlayers.includes(p.provider))
          if (speechOrder.length === 0) {
            fail('No AI participants for speeches')
            return
          }

          for (const player of speechOrder) {
            const selfZ = rolesIn[player.provider] === 'zombie'
            const toolNote =
              rolesIn[player.provider] === 'human' &&
              (player.provider === shotgunHolderId || player.provider === vaccineHolderId)
                ? `${SPEECH_TOOL_HUMAN}\n`
                : ''
            const roundNote =
              round >= 2
                ? `This is round ${round}: write 2–3 sentences total (see LENGTH & TONE). If you write a third sentence, it must accuse ONE player with a reason grounded in EARLIER rounds only — use CONVERSATION HISTORY.\n`
                : 'This is round 1: exactly 2 sentences — humanity claim + mandatory alliance line. No suspicion sentence.\n'
            const geminiRoundSpeech =
              player.provider === 'google'
                ? `GEMINI — This is Round ${round}. NEVER repeat the same opening sentence across rounds; your first words must be completely different each time. Vary structure and vocabulary; do not reuse a fixed catchphrase as sentence one.\n`
                : ''

            const sys = `${langPre}${speechOutputLanguageBlock(language)}${aliveBlock}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}${NO_REPEAT_INSTRUCTION}${toolNote}
${selfZ ? SPEECH_ZOMBIE[player.provider] : SPEECH_HUMAN[player.provider]}
${roundNote}${geminiRoundSpeech}
You are ${player.name}. Provider id: ${player.provider}.

CONVERSATION HISTORY:
${historyText}
`
            let raw = ''
            try {
              const r = await runCarrierAiWithTimeout(
                player,
                sys,
                `${langPre}Round ${round} — your public speech only. No JSON.`,
                speechMaxTokens(player.provider)
              )
              raw = r.text?.trim() ?? ''
            } catch {
              raw = ''
            }
            const text = finalizeAiSpeech(
              sanitizeSpeech(raw, player.name, player.provider, 'speeches'),
              player.name,
              'speeches'
            )
            send({
              type: 'speech',
              provider: player.provider,
              name: player.name,
              text,
              round,
            })
          }

          send({ type: 'phase_complete', phase: 'speeches' })
          controller.close()
          return
        }

        if (action === 'actions') {
          let teamsWorking: CarrierTeam[] = Array.isArray(body.teams)
            ? (body.teams as CarrierTeam[]).map((t) => ({
                id: String(t.id),
                members: Array.isArray(t.members)
                  ? t.members.filter((m): m is string => typeof m === 'string')
                  : [],
              }))
            : []

          if (teamsWorking.length === 0) {
            fail('teams required for actions')
            return
          }

          const { gameRules } = getPlayerContext(alivePlayers)
          const aliveBlock = buildCarrierAliveBlock(alivePlayers, userMode)
          const conv = Array.isArray(body.conversation) ? (body.conversation as ConvTurn[]) : []
          const historyText = buildHistoryText(conv, alivePlayers)

          let shUsed = shotgunUsed
          let vaxUsed = vaccineUsed
          const shHolder = shotgunHolderId
          const vaxHolder = vaccineHolderId
          let roles = { ...rolesIn }

          let shotgunResult: 'not_used' | 'zombie_eliminated' | 'human_died' = 'not_used'
          let vaccineResult: 'not_used' | 'zombie_cured' | 'no_effect' = 'not_used'

          const eliminated = new Set<string>()
          const actionsThisRound: Record<string, string> = {}
          let allianceJoinedThisRound = new Set<string>()
          let allianceResponderAcceptedThisRound = new Set<string>()

          const mergeAcceptedAlliance = (requester: string, target: string): boolean => {
            if (!mergeAllianceTeamsState(teamsWorking, requester, target)) return false
            allianceJoinedThisRound.add(requester)
            allianceJoinedThisRound.add(target)
            return true
          }

          const applyExpel = (target: string) => {
            for (const tm of teamsWorking) {
              if (tm.members.includes(target)) {
                tm.members = tm.members.filter((m) => m !== target)
              }
            }
            teamsWorking.push({ id: `solo_${target}`, members: [target] })
          }

          let acted = new Set<string>()
          let order: string[] = []
          let resumeIndex = 0

          const resumePack = body.actionsPausedResume
          const uaBody = body.userAllianceResponse
          const utResume = body.actionsUserTurnResume

          if (resumePack && uaBody && typeof uaBody.accepted === 'boolean') {
            acted = new Set(resumePack.acted)
            order = [...resumePack.order]
            resumeIndex = resumePack.resumeIndex
            teamsWorking = resumePack.teams.map((t) => ({ id: t.id, members: [...t.members] }))
            roles = { ...resumePack.roles }
            shUsed = resumePack.shotgunUsed
            vaxUsed = resumePack.vaccineUsed
            shotgunResult = resumePack.shotgunResult
            vaccineResult = resumePack.vaccineResult
            Object.assign(actionsThisRound, resumePack.actionsThisRound ?? {})
            allianceJoinedThisRound = new Set(resumePack.allianceJoinedIdsThisRound ?? [])
            allianceResponderAcceptedThisRound = new Set(
              resumePack.allianceResponderAcceptedIdsThisRound ?? []
            )
            for (const e of resumePack.eliminated) eliminated.add(e)

            const pend = resumePack.pending
            const userWantsAccept = uaBody.accepted === true
            const nMerge = allianceMergeMemberCount(teamsWorking, pend.requester, 'user')
            let accepted =
              userWantsAccept &&
              nMerge !== null &&
              nMerge <= MAX_CARRIER_TEAM_SIZE
            if (userWantsAccept && allianceResponderAcceptedThisRound.has('user')) {
              accepted = false
            }
            if (
              userWantsAccept &&
              nMerge !== null &&
              nMerge > MAX_CARRIER_TEAM_SIZE
            ) {
              stripPlayerToSoloTeam(teamsWorking, pend.requester)
            }
            const respText =
              typeof uaBody.text === 'string' && uaBody.text.trim()
                ? sanitizeAiResponseText(
                    truncateAtLastSentence(uaBody.text.trim()).slice(0, 220)
                  )
                : accepted
                  ? 'Accepted.'
                  : 'Declined.'

            send({
              type: 'action_response',
              from: 'user',
              fromName: 'You',
              to: pend.requester,
              toName: providerDisplayName(pend.requester),
              accepted,
              text: respText,
            })
            if (accepted) {
              if (mergeAcceptedAlliance(pend.requester, 'user')) {
                allianceResponderAcceptedThisRound.add('user')
              } else {
                accepted = false
              }
            }
            actionsThisRound[pend.requester] = accepted
              ? `ALLIANCE_REQUEST → ${providerDisplayName('user')} (accepted)`
              : `ALLIANCE_REQUEST → ${providerDisplayName('user')} (rejected)`
            acted.add(pend.requester)
            resumeIndex += 1
          } else if (resumePack && !uaBody) {
            fail('userAllianceResponse required with actionsPausedResume')
            return
          } else if (utResume && body.userAction?.action) {
            acted = new Set(utResume.acted)
            order = [...utResume.order]
            resumeIndex = utResume.resumeIndex
            teamsWorking = utResume.teams.map((t) => ({ id: t.id, members: [...t.members] }))
            roles = { ...utResume.roles }
            shUsed = utResume.shotgunUsed
            vaxUsed = utResume.vaccineUsed
            shotgunResult = utResume.shotgunResult
            vaccineResult = utResume.vaccineResult
            Object.assign(actionsThisRound, utResume.actionsThisRound ?? {})
            allianceJoinedThisRound = new Set(utResume.allianceJoinedIdsThisRound ?? [])
            allianceResponderAcceptedThisRound = new Set(
              utResume.allianceResponderAcceptedIdsThisRound ?? []
            )
            for (const e of utResume.eliminated) eliminated.add(e)
          } else {
            const aisOnly = alivePlayers.filter((p) => p !== 'user')
            order =
              userMode === 'challenge' && alivePlayers.includes('user')
                ? [...shuffle(aisOnly), 'user']
                : shuffle([...alivePlayers])
            resumeIndex = 0
          }

          const ctxClampBase = (pid: string): CarrierClampCtx => ({
            round,
            pid,
            alive: alivePlayers,
            teams: teamsWorking,
            roles,
            shotgunHolderId,
            vaccineHolderId,
            shotgunUsed: shUsed,
            vaccineUsed: vaxUsed,
            eliminated,
            allianceJoinedThisRound,
          })

          const finishAllianceAi = async (
            requester: string,
            target: string,
            reqText: string
          ): Promise<{ paused: boolean; allianceAccepted?: boolean }> => {
            const fromName = providerDisplayName(requester)
            const toName = providerDisplayName(target)
            send({
              type: 'action_request',
              from: requester,
              fromName,
              to: target,
              toName,
              text: reqText,
            })

            if (target === 'user' && userMode === 'challenge') {
              const payload: ActionsPausedPayload = {
                acted: [...acted],
                order,
                resumeIndex,
                teams: teamsWorking.map((t) => ({ id: t.id, members: [...t.members] })),
                roles,
                eliminated: [...eliminated],
                shotgunUsed: shUsed,
                vaccineUsed: vaxUsed,
                shotgunResult,
                vaccineResult,
                allianceLatentThisRound:
                  collectPendingInfectionTeams(teamsWorking, roles).length > 0,
                allianceJoinedIdsThisRound: [...allianceJoinedThisRound],
                allianceResponderAcceptedIdsThisRound: [
                  ...allianceResponderAcceptedThisRound,
                ],
                actionsThisRound: { ...actionsThisRound },
                pending: { requester, target, reqText },
              }
              send({ type: 'actions_paused', payload })
              controller.close()
              return { paused: true }
            }

            const responderPlayer = AI_PLAYERS.find((p) => p.provider === target)
            if (!responderPlayer) {
              send({
                type: 'action_response',
                from: target,
                fromName: toName,
                to: requester,
                toName: fromName,
                accepted: false,
                text: 'No response.',
              })
              return { paused: false, allianceAccepted: false }
            }

            if (allianceResponderAcceptedThisRound.has(target)) {
              const respBusy = await allianceResponseLineAi(
                responderPlayer,
                false,
                fromName,
                langPre,
                aliveBlock,
                gameRules,
                historyText,
                round,
                providerDisplayName(requester)
              )
              send({
                type: 'action_response',
                from: target,
                fromName: responderPlayer.name,
                to: requester,
                toName: fromName,
                accepted: false,
                text: respBusy,
              })
              return { paused: false, allianceAccepted: false }
            }

            const rolled = rollAllianceAccept(
              requester,
              target,
              conv,
              round,
              teamsWorking
            )
            const nMerge = allianceMergeMemberCount(teamsWorking, requester, target)
            let accepted =
              rolled && nMerge !== null && nMerge <= MAX_CARRIER_TEAM_SIZE
            if (
              rolled &&
              nMerge !== null &&
              nMerge > MAX_CARRIER_TEAM_SIZE
            ) {
              stripPlayerToSoloTeam(teamsWorking, requester)
            }
            const respText = await allianceResponseLineAi(
              responderPlayer,
              accepted,
              fromName,
              langPre,
              aliveBlock,
              gameRules,
              historyText,
              round,
              providerDisplayName(requester)
            )
            send({
              type: 'action_response',
              from: target,
              fromName: responderPlayer.name,
              to: requester,
              toName: fromName,
              accepted,
              text: respText,
            })
            if (accepted) {
              if (mergeAcceptedAlliance(requester, target)) {
                allianceResponderAcceptedThisRound.add(target)
              } else {
                accepted = false
              }
            }
            return { paused: false, allianceAccepted: accepted }
          }

          while (resumeIndex < order.length) {
            const pid = order[resumeIndex]!
            if (eliminated.has(pid)) {
              resumeIndex += 1
              continue
            }
            if (acted.has(pid)) {
              resumeIndex += 1
              continue
            }

            let decision: ParsedCarrierAction
            const forcedTool = tryForcedToolActionForCarrierRound(
              pid,
              round,
              conv,
              alivePlayers,
              teamsWorking,
              eliminated,
              shotgunHolderId,
              vaccineHolderId,
              shUsed,
              vaxUsed
            )
            if (forcedTool) {
              decision = clampCarrierActionForActor(forcedTool, ctxClampBase(pid))
            } else if (pid === 'user') {
              if (userMode === 'challenge' && !body.userAction?.action) {
                const payload: ActionsUserTurnPayload = {
                  acted: [...acted],
                  order,
                  resumeIndex,
                  teams: teamsWorking.map((t) => ({ id: t.id, members: [...t.members] })),
                  roles,
                  eliminated: [...eliminated],
                  shotgunUsed: shUsed,
                  vaccineUsed: vaxUsed,
                  shotgunResult,
                  vaccineResult,
                  allianceLatentThisRound:
                    collectPendingInfectionTeams(teamsWorking, roles).length > 0,
                  allianceJoinedIdsThisRound: [...allianceJoinedThisRound],
                  allianceResponderAcceptedIdsThisRound: [
                    ...allianceResponderAcceptedThisRound,
                  ],
                  actionsThisRound: { ...actionsThisRound },
                }
                send({ type: 'actions_paused_user_turn', payload })
                controller.close()
                return
              }
              const ua = body.userAction
              if (
                ua &&
                ua.action &&
                (ua.action === 'ALLIANCE_REQUEST' ||
                  ua.action === 'SHOTGUN' ||
                  ua.action === 'VACCINE' ||
                  ua.action === 'EXPEL' ||
                  ua.action === 'NONE')
              ) {
                decision = clampCarrierActionForActor(
                  { action: ua.action, target: ua.target },
                  ctxClampBase(pid)
                )
              } else {
                decision = clampCarrierActionForActor(
                  { action: 'NONE', target: null },
                  ctxClampBase(pid)
                )
              }
            } else {
              const player = AI_PLAYERS.find((p) => p.provider === pid)
              if (!player) {
                acted.add(pid)
                resumeIndex += 1
                continue
              }
              const mates = teamOf(teamsWorking, pid)
              const selfZ = roles[pid] === 'zombie'
              const holdsShotgun = pid === shotgunHolderId
              const holdsVaccine = pid === vaccineHolderId
              const currentTeamMembers = mates.map((m) => providerDisplayName(m))
              const eliminatedPlayers = [...eliminated].map((id) => providerDisplayName(id))
              const myActions = actionsThisRound[player.provider] ?? 'none yet'
              const shotgunDiscipline =
                holdsShotgun && !shUsed
                  ? `Before using SHOTGUN, check CONVERSATION HISTORY carefully. Only fire at players who have been accused multiple times OR whose behavior has been inconsistent across rounds. Do NOT fire randomly.\n\n`
                  : ''
              const vaccineDiscipline =
                holdsVaccine && !vaxUsed && mates.length > 1
                  ? `Before using VACCINE, check CONVERSATION HISTORY carefully. Only use it on teammates who have been accused multiple times OR whose behavior has been inconsistent across rounds. Do NOT use it randomly — vaccinating a non-infected human wastes the dose (no effect).\n\n`
                  : ''
              const expelMandatoryNote =
                mates.length > 1
                  ? (() => {
                      const expelTargets = mates.filter(
                        (m) =>
                          m !== player.provider &&
                          suspicionMentionCountTowardPlayer(conv, m) >= 2
                      )
                      if (!expelTargets.length) return ''
                      const names = expelTargets
                        .map((t) => `${providerDisplayName(t)} (${suspicionMentionCountTowardPlayer(conv, t)} hits)`)
                        .join(', ')
                      return `EXPEL REQUIREMENT: Teammate(s) ${names} have 2+ accusation-style mentions across CONVERSATION HISTORY. You MUST choose EXPEL targeting one of them this action — your strongest defensive move. Do not ignore this while those signals exist.\n\n`
                    })()
                  : ''
              const gameStateSnap = `CURRENT GAME STATE (Round ${round}):
Your provider ID: ${player.provider}
Your role: ${selfZ ? 'ZOMBIE — you are infected, hide this' : 'HUMAN — find the zombie'}
Your team members right now: ${currentTeamMembers.length > 1 ? currentTeamMembers.join(', ') : 'NONE — you are solo'}
You hold SHOTGUN: ${holdsShotgun && !shUsed ? 'YES — use it if you strongly suspect someone' : 'NO'}
You hold VACCINE: ${holdsVaccine && !vaxUsed ? 'YES — use it on a suspected teammate' : 'NO'}
Actions you have already taken this round: ${myActions}
Players already eliminated: ${eliminatedPlayers.length ? eliminatedPlayers.join(', ') : 'none'}

${shotgunDiscipline}${vaccineDiscipline}${expelMandatoryNote}RULES FOR THIS ACTION:
- If you are SOLO: you MUST choose ALLIANCE_REQUEST. Nothing else.
- If you hold SHOTGUN and suspect someone: choose SHOTGUN now, don't wait — but ONLY after applying the SHOTGUN discipline above (history-based suspicion, not random).
- If you hold VACCINE and a teammate seems infected: choose VACCINE now — but ONLY after applying the VACCINE discipline above (history-based suspicion, not random).
- If you have teammates and any teammate has been accused 2+ times in CONVERSATION HISTORY (see EXPEL REQUIREMENT above when present), you MUST choose EXPEL against that teammate — your strongest defensive move.
- If a teammate is suspicious: choose EXPEL.
- ALLIANCE_REQUEST is only valid if you are solo or want to merge teams.
- Do NOT request alliance with someone already on your team.
- NONE is forbidden in rounds 1-4.

`
              const round1note =
                round === 1
                  ? 'Round 1 RULE: You MUST choose ALLIANCE_REQUEST. NONE, SHOTGUN, VACCINE, and EXPEL are FORBIDDEN. You must request an alliance with another alive provider_id.\n'
                  : 'Allowed: ALLIANCE_REQUEST, SHOTGUN, VACCINE, EXPEL, NONE.\n'
              const zombieInfilNote =
                selfZ && round >= 2
                  ? 'ZOMBIE SURVIVAL: You MUST infiltrate humans. Choose ALLIANCE_REQUEST if you are solo, if your team is not yet full (fewer than 3 members), or if you are not already embedded in a full mixed team with humans. Never pick NONE unless you are already in such a strong coalition — then other actions are allowed. Target the human who seems least likely to suspect you.\n'
                  : ''
              const actionAggroNote =
                round === 1
                  ? ''
                  : `Round 5 only: NONE is allowed only if you are solo, already had an accepted alliance merge this round, and have no usable shotgun, vaccine, or EXPEL. Otherwise follow CURRENT GAME STATE and RULES FOR THIS ACTION above.\n`
              const sys =
                `${langPre}${gameStateSnap}${aliveBlock}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}` +
                '\nYou are ' +
                player.name +
                ' (' +
                player.provider +
                '). Secret role: ' +
                (selfZ ? 'ZOMBIE — hide it.' : 'HUMAN.') +
                '\n' +
                round1note +
                zombieInfilNote +
                actionAggroNote +
                `Rules (JSON targets use provider_id strings):\n- ALLIANCE_REQUEST: target another alive provider_id; that player responds immediately (free for them).\n- SHOTGUN: only if CURRENT GAME STATE says you hold SHOTGUN and it is usable; target any other alive player. You MUST follow the SHOTGUN discipline block above: evidence from CONVERSATION HISTORY (repeated accusations or cross-round inconsistency), never a random target.\n- VACCINE: only if CURRENT GAME STATE says you hold VACCINE and it is usable; target must be a teammate. You MUST follow the VACCINE discipline block above: same history-based bar — do not waste the dose on a clearly trusted teammate.\n- EXPEL: only if you have teammates; target must be a teammate (not yourself). If EXPEL REQUIREMENT appears above, you MUST EXPEL one of those named teammates.\n- NONE: forbidden rounds 1–4; round 5 see note above.\n\nRespond ONLY JSON: {"action":"ALLIANCE_REQUEST"|"SHOTGUN"|"VACCINE"|"EXPEL"|"NONE","target":"provider_id"|null}\n\nCONVERSATION HISTORY:\n` +
                historyText
              let raw = ''
              try {
                const r = await runCarrierAiWithTimeout(
                  player,
                  sys,
                  `${langPre}Round ${round} — one action JSON only.`,
                  actionJsonMaxTokens(player.provider)
                )
                raw = r.text?.trim() ?? ''
              } catch {
                raw = ''
              }
              if (isErrorResponse(raw)) raw = ''
              decision = clampCarrierActionForActor(
                parseCarrierAction(raw, alivePlayers),
                ctxClampBase(pid)
              )
            }

            if (decision.action === 'NONE') {
              send({
                type: 'action_none',
                provider: pid,
                name: providerDisplayName(pid),
              })
              actionsThisRound[pid] = 'NONE'
              acted.add(pid)
              resumeIndex += 1
              continue
            }

            if (decision.action === 'ALLIANCE_REQUEST' && decision.target) {
              const tgt = decision.target
              let reqText: string
              if (pid === 'user') {
                const custom =
                  typeof body.userAllianceRequestText === 'string'
                    ? body.userAllianceRequestText.trim()
                    : ''
                reqText = custom
                  ? truncateAtLastSentence(custom).slice(0, 400)
                  : `${providerDisplayName(tgt)}, I want to ally with you this round.`
              } else {
                const pl = AI_PLAYERS.find((p) => p.provider === pid)
                if (!pl) {
                  acted.add(pid)
                  resumeIndex += 1
                  continue
                }
                reqText = await allianceRequestLineAi(
                  pl,
                  providerDisplayName(tgt),
                  langPre,
                  aliveBlock,
                  gameRules,
                  historyText,
                  round,
                  roles[pid] === 'zombie'
                )
              }
              const ar = await finishAllianceAi(pid, tgt, reqText)
              if (ar.paused) return
              actionsThisRound[pid] =
                ar.allianceAccepted === true
                  ? `ALLIANCE_REQUEST → ${providerDisplayName(tgt)} (accepted)`
                  : `ALLIANCE_REQUEST → ${providerDisplayName(tgt)} (rejected)`
              acted.add(pid)
              resumeIndex += 1
              continue
            }

            if (decision.action === 'SHOTGUN' && decision.target) {
              const tgt = decision.target
              const res = roles[tgt] === 'zombie' ? 'zombie_eliminated' : 'human_died'
              send({
                type: 'action_shotgun',
                shooter: pid,
                shooterName: providerDisplayName(pid),
                target: tgt,
                targetName: providerDisplayName(tgt),
                result: res,
              })
              shUsed = true
              eliminated.add(tgt)
              shotgunResult = res
              actionsThisRound[pid] = `SHOTGUN → ${providerDisplayName(tgt)} (${res})`
              acted.add(pid)
              resumeIndex += 1
              continue
            }

            if (decision.action === 'VACCINE' && decision.target) {
              const tgt = decision.target
              const cured = roles[tgt] === 'zombie'
              if (cured) roles[tgt] = 'human'
              vaxUsed = true
              vaccineResult = cured ? 'zombie_cured' : 'no_effect'
              send({
                type: 'action_vaccine',
                user: pid,
                userName: providerDisplayName(pid),
                target: tgt,
                targetName: providerDisplayName(tgt),
                result: cured ? 'zombie_cured' : 'no_effect',
              })
              actionsThisRound[pid] = `VACCINE → ${providerDisplayName(tgt)} (${cured ? 'zombie_cured' : 'no_effect'})`
              acted.add(pid)
              resumeIndex += 1
              continue
            }

            if (decision.action === 'EXPEL' && decision.target) {
              const tgt = decision.target
              send({
                type: 'action_expel',
                from: pid,
                fromName: providerDisplayName(pid),
                target: tgt,
                targetName: providerDisplayName(tgt),
              })
              applyExpel(tgt)
              actionsThisRound[pid] = `EXPEL → ${providerDisplayName(tgt)}`
              acted.add(pid)
              resumeIndex += 1
              continue
            }

            acted.add(pid)
            resumeIndex += 1
          }

          const prunedTeams = teamsWorking
            .map((t) => ({
              id: t.id,
              members: t.members.filter((m) => alivePlayers.includes(m) && !eliminated.has(m)),
            }))
            .filter((t) => t.members.length > 0)

          const solos = prunedTeams.filter((t) => t.members.length === 1).flatMap((t) => t.members)
          const teamsAnnotated = annotateTeamsLatent(prunedTeams, roles)
          const pendingInfectionTeams = collectPendingInfectionTeams(prunedTeams, roles)
          const allianceLatentThisRound = pendingInfectionTeams.length > 0

          send({
            type: 'actions_complete',
            teams: teamsAnnotated,
            solos,
            roles,
            shotgunUsed: shUsed,
            vaccineUsed: vaxUsed,
            shotgunResult,
            vaccineResult,
            eliminated: [...eliminated],
            allianceLatentThisRound,
            pendingInfectionTeams,
            actionsThisRound: { ...actionsThisRound },
          })
          controller.close()
          return
        }

        if (action === 'round_summary') {
          const pendingTeams = (() => {
            const raw = body.pendingInfectionTeams
            if (!Array.isArray(raw)) return [] as { zombieProvider: string; memberIds: string[] }[]
            const out: { zombieProvider: string; memberIds: string[] }[] = []
            for (const entry of raw) {
              if (!entry || typeof entry !== 'object') continue
              const o = entry as Record<string, unknown>
              const zp = typeof o.zombieProvider === 'string' ? o.zombieProvider : ''
              const mids = Array.isArray(o.memberIds)
                ? o.memberIds.filter((x): x is string => typeof x === 'string')
                : []
              if (!zp || !mids.length) continue
              out.push({ zombieProvider: zp, memberIds: mids })
            }
            return out
          })()

          const roles = { ...rolesIn }
          let latentInfectionSummary: {
            round: number
            zombieName: string
            infectedTeamMembers: string[]
          } | null = null

          if (pendingTeams.length) {
            const humanIdsToInfect = new Set<string>()
            const firstZombie = pendingTeams[0]!.zombieProvider
            for (const team of pendingTeams) {
              for (const mid of team.memberIds) {
                if (rolesIn[mid] === 'human') humanIdsToInfect.add(mid)
              }
            }
            if (humanIdsToInfect.size) {
              latentInfectionSummary = {
                round,
                zombieName: providerDisplayName(firstZombie),
                infectedTeamMembers: [...humanIdsToInfect].map((id) => providerDisplayName(id)),
              }
              for (const id of humanIdsToInfect) {
                if (alivePlayers.includes(id) && roles[id] !== undefined) {
                  roles[id] = 'zombie'
                }
              }
            }
          } else {
            const legacy = Array.isArray(body.pendingInfectionMemberIds)
              ? body.pendingInfectionMemberIds.filter((p): p is string => typeof p === 'string')
              : []
            for (const pid of legacy) {
              if (alivePlayers.includes(pid) && roles[pid] !== undefined) {
                roles[pid] = 'zombie'
              }
            }
          }

          const alt = latentInfectionSummary !== null

          const shotgunResult: 'not_used' | 'zombie_eliminated' | 'human_died' =
            body.shotgunResult === 'zombie_eliminated' ||
            body.shotgunResult === 'human_died' ||
            body.shotgunResult === 'not_used'
              ? body.shotgunResult
              : 'not_used'
          const vaccineResult: 'not_used' | 'zombie_cured' | 'no_effect' =
            body.vaccineResult === 'zombie_cured' ||
            body.vaccineResult === 'no_effect' ||
            body.vaccineResult === 'not_used'
              ? body.vaccineResult
              : 'not_used'

          const teamsRaw = Array.isArray(body.teams) ? (body.teams as CarrierTeam[]) : []
          const teamsClean = teamsRaw.map((t) => ({
            id: t.id,
            members: [...(t.members ?? [])].filter((m) => alivePlayers.includes(m)),
          }))

          const humanCount = alivePlayers.filter((p) => roles[p] === 'human').length
          const zombieCount = alivePlayers.filter((p) => roles[p] === 'zombie').length

          const hintKo = alt ? '좀비가 인간 팀에 잠입했습니다' : '이번 라운드 잠입 없음'
          const hintEn = alt
            ? 'A zombie has joined a human team this round — but which one?'
            : 'No zombie infiltration this round'
          const hint = language === 'Korean' ? hintKo : hintEn

          const { gameRules } = getPlayerContext(alivePlayers)
          const summaryPrompt = `Round ${round} summary facts (do not reveal which team had latent infection):
- Infiltration hint: ${hint}
- Shotgun: ${shotgunResult}
- Vaccine: ${vaccineResult}
- Relative pressure (INTERNAL ONLY — do NOT state exact headcounts in your spoken narration): humans are ${humanCount > zombieCount ? 'outnumbering' : humanCount < zombieCount ? 'under pressure vs' : 'even with'} the infected side in alive population.
Compose a DRAMATIC public announcement in exactly 3–4 sentences for all players. Include what happened this round: alliances formed or broken, shotgun/vaccine if used, eliminations. Do not name the infiltrated team.`

          let announcement = ''
          try {
            const r = await runSingleAiProvider({
              supabase: supabaseAdmin,
              sessionId: null,
              userId: null,
              provider: 'anthropic',
              prompt: summaryPrompt,
              systemPrompt:
                langPre +
                HUMAN_MESSAGE_OWNERSHIP_RULE +
                gameRules +
                `You are the game announcer for CARRIER. Match the drama to the stakes.
Do NOT reveal exact human or zombie counts in your narration (never phrases like "인간 1명", "좀비 4명", "1 human", "4 zombies", or any specific alive headcount).
Use vague dramatic language instead, e.g. Korean: 인간의 수가 위험할 정도로 줄어들었다; 어둠의 세력이 점점 강해지고 있다 — English equivalents are fine when not in Korean mode.
Keep players guessing.`,
              maxCompletionTokens: 360,
              modelOverride: 'claude-sonnet-4-6',
            })
            let t = r.text ?? ''
            if (isErrorResponse(t)) t = 'The round ends. Tensions rise.'
            else t = truncateAtLastSentence(t)
            announcement = sanitizeSpeech(t, 'Announcer', 'anthropic', 'summary')
          } catch {
            announcement = 'The round ends.'
          }

          const soloIds = new Set(
            teamsClean.filter((t) => t.members.length === 1).flatMap((t) => t.members)
          )
          /** All alive players by role (UI score — not limited to non-solo teams). */
          const hAlive = humanCount
          const zAlive = zombieCount

          const allZombie = alivePlayers.length > 0 && alivePlayers.every((p) => roles[p] === 'zombie')
          const noZombies = alivePlayers.length > 0 && alivePlayers.every((p) => roles[p] === 'human')
          const roundOver = round >= 5 || allZombie || noZombies
          const gameOver = roundOver
          let winner: 'humans' | 'zombies' | null = null

          if (gameOver) {
            if (noZombies) winner = 'humans'
            else if (allZombie) winner = 'zombies'
            else if (round >= 5) {
              if (hAlive > zAlive) winner = 'humans'
              else if (zAlive > hAlive) winner = 'zombies'
              else winner = humanCount >= zombieCount ? 'humans' : 'zombies'
            }
          }

          if (gameOver) {
            const originalZombieName = providerDisplayName(zombieId)
            const winLabel =
              winner === 'humans' ? 'humans' : winner === 'zombies' ? 'zombies' : 'unclear stalemate'
            let endingNarration = ''
            try {
              const endR = await runSingleAiProvider({
                supabase: supabaseAdmin,
                sessionId: null,
                userId: null,
                provider: 'anthropic',
                prompt: `Generate a dramatic 3-sentence game ending narration for CARRIER.
State who won (humans or zombies): ${winLabel}.
Reveal the original hidden zombie was: ${originalZombieName}.
Describe the final outcome dramatically. Do not contradict the winner above.`,
                systemPrompt:
                  `${langPre}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}You are the closing narrator. Exactly 3 sentences. No bullet points.`,
                maxCompletionTokens: 220,
                modelOverride: 'claude-sonnet-4-6',
              })
              let et = endR.text ?? ''
              if (isErrorResponse(et)) et = 'The bunker falls quiet — the round is over.'
              else et = truncateAtLastSentence(et)
              endingNarration = sanitizeAiResponseText(sanitizeSpeech(et, 'Announcer', 'anthropic', 'game_end'))
            } catch {
              endingNarration = 'The game ends in silence.'
            }
            send({ type: 'game_ending_narration', text: endingNarration })
          }

          send({
            type: 'round_summary',
            hint,
            shotgunResult,
            vaccineResult,
            teams: teamsClean,
            score: {
              humans: hAlive,
              zombies: zAlive,
              humansAll: hAlive,
              zombiesAll: zAlive,
            },
            soloEliminatedForJudgment: [...soloIds],
            round,
            announcement,
            roles,
            roundOver,
            gameOver,
            winner,
            latentInfectionSummary,
          })
          controller.close()
          return
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Carrier pipeline failed'
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
