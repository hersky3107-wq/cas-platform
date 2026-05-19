import { runSingleAiProvider, type RouterResult } from '@/lib/ai/router'
import { creditsForMindgameCareer } from '@/lib/credits'
import { deductCreditsBalance } from '@/lib/credits-server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
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

type CarrierTeam = {
  id: string
  members: string[]
  hasLatentInfection?: boolean
  round?: number
}

/** Max times shotgun / vaccine may be used per game (per holder) — also initial charges. */
const MAX_SHOTGUN_USES = 3
const MAX_VACCINE_USES = 3
const INITIAL_SHOTGUN_COUNT = MAX_SHOTGUN_USES
const INITIAL_VACCINE_COUNT = MAX_VACCINE_USES

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
  return `GAME RULES — CARRIER (infection + forced teams):
You are one of ${totalPlayers} players. The players are ONLY: ${playerNamesList}.
Your team roster each round is decided by the host — same for everyone for that round. You cannot RP refusing the assignment or swapping teams mid-round.
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
Refer only to players in this active list by name in your output.

`
}

/** Names of everyone not in aliveProviderIds (for speech prompts). */
function buildEliminatedSpeechBlock(aliveProviderIds: string[], userMode: string): string {
  const base = AI_PLAYERS.map((p) => p.provider)
  const universe = userMode === 'challenge' ? [...base, 'user'] : [...base]
  const eliminated = universe.filter((id) => !aliveProviderIds.includes(id))
  if (!eliminated.length) {
    return '⛔ ELIMINATED PLAYERS — none yet.\n\n'
  }
  const eliminatedNames = eliminated.map((id) => providerDisplayName(id))
  return `⛔ ELIMINATED PLAYERS — DO NOT MENTION THESE NAMES AT ALL:
${eliminatedNames.join(', ')}
These players are DEAD. Pretend they never existed.
Never say their names. Never reference their words. Never mention your relationship with them.

`
}

type ConvTurn = {
  provider: string
  name: string
  text: string
  round: number
  type: 'speech' | 'system' | 'negotiation'
}

function buildHistoryText(conversation: ConvTurn[], aliveProviderIds: string[]): string {
  const filtered = conversation.filter(
    (m) =>
      m.provider === 'system' ||
      m.provider === 'user' ||
      aliveProviderIds.includes(m.provider)
  )
  if (filtered.length === 0) return 'No previous statements yet.'
  return filtered
    .map((m) => {
      if (m.provider === 'user')
        return `Round ${m.round} — YOU (human player): ${m.text}`
      return `Round ${m.round} — ${m.name}: ${m.text}`
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

/** Deterministic shuffle so speeches/actions for the same session+round assign identical teams without server-side session storage. */
function hashStringDeterministic(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h >>> 0
}

function seededShuffle<T>(arr: T[], seedIn: number): T[] {
  const a = [...arr]
  let state = seedIn >>> 0
  const rnd = (): number => {
    state = (Math.imul(1103515245, state) + 12345) >>> 0
    return state / 0xffffffff
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

type AssignedRoundTeam = { id: string; members: string[]; round: number }

/**
 * Partition alive players into server-assigned teams (reshuffled each round via deterministic seed).
 * Player ids are provider strings (e.g. openai); user challenge uses provider "user".
 */
function assignTeamsForRound(aliveProviders: string[], round: number, sessionId: string): AssignedRoundTeam[] {
  const alive = [...new Set(aliveProviders.filter(Boolean))]
  const count = alive.length
  const teamSizes: number[] =
    count >= 7 ? [2, 2, 3] : count >= 6 ? [2, 2, 2] : count === 5 ? [2, 3] : count === 4 ? [2, 2] : [count]

  const sortedSig = [...alive].sort((a, b) => a.localeCompare(b)).join('|')
  const seed = hashStringDeterministic(`${sessionId}|${round}|${sortedSig}`)
  const shuffled = seededShuffle(alive, seed)

  const teams: AssignedRoundTeam[] = []
  let playerIndex = 0
  teamSizes.forEach((size, i) => {
    const members = shuffled.slice(playerIndex, playerIndex + size)
    teams.push({
      id: `team_${i + 1}`,
      members,
      round,
    })
    playerIndex += size
  })
  return teams
}

function teamsToCarrierTeams(assigned: AssignedRoundTeam[]): CarrierTeam[] {
  return assigned.map((t) => ({ id: t.id, members: [...t.members], round: t.round }))
}

function narrationForAssignedTeams(
  teams: AssignedRoundTeam[],
  language: string
): string {
  if (language === 'Korean') {
    const segmentsKo = teams.map((t, i) => {
      const labels = t.members.map((id) =>
        id === 'user' ? '당신' : AI_PLAYERS.find((a) => a.provider === id)?.name ?? id
      )
      return `팀 ${i + 1} (${labels.join(', ')})`
    })
    return `이번 라운드 팀 편성: ${segmentsKo.join(' | ')}. 팀은 다음 라운드까지 고정입니다. 이번 라운드 동안 편 변경·탈퇴는 불가입니다.`
  }
  const segments = teams.map((t, i) => {
    const labels = t.members.map((id) => providerDisplayName(id))
    return `Team ${i + 1} (${labels.join(', ')})`
  })
  return `This round's teams: ${segments.join(' | ')}. Teams are LOCKED until next round — no leaving or switching mid-round.`
}

function promptTeamAssignmentsForPid(pid: string, teams: AssignedRoundTeam[]): {
  ownTeamFormatted: string
  allTeamsFormatted: string
} {
  const idx = teams.findIndex((t) => t.members.includes(pid))
  const own = idx >= 0 ? teams[idx] : null
  const ownOrdinal = idx >= 0 ? idx + 1 : '?'
  const ownNamesSameTeam = own
    ? own.members
        .filter((id) => id !== pid)
        .map((m) => providerDisplayName(m))
    : []
  const youLabel =
    pid === 'user'
      ? 'you'
      : AI_PLAYERS.find((a) => a.provider === pid)?.name ?? providerDisplayName(pid)
  const mates =
    ownNamesSameTeam.length > 0
      ? `you + ${ownNamesSameTeam.join(', ')}`
      : `${youLabel}`

  const allTeamsFormatted = teams
    .map((t, i) => {
      const names = t.members.map((id) =>
        id === pid
          ? 'you'
          : id === 'user'
            ? 'you'
            : AI_PLAYERS.find((a) => a.provider === id)?.name ?? id
      )
      return `Team ${i + 1} (${names.join(', ')})`
    })
    .join(' | ')

  return {
    ownTeamFormatted: `Team ${ownOrdinal} (${mates})`,
    allTeamsFormatted,
  }
}

/** Team lines for action prompts after EXPEL etc. (uses current `teamsWorking` order). */
function promptLiveTeamsForPid(
  pid: string,
  teams: CarrierTeam[]
): { ownTeamFormatted: string; allTeamsFormatted: string } {
  const assignedLike: AssignedRoundTeam[] = teams.map((t, i) => ({
    id: t.id || `team_${i + 1}`,
    members: [...t.members],
    round: typeof t.round === 'number' ? t.round : 0,
  }))
  return promptTeamAssignmentsForPid(pid, assignedLike)
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
MANDATORY: Speak as teammate to your FIXED assignment (see TEAM ASSIGNMENT). Commit to cooperating with teammates this round — one concrete coordination idea counts as your "team pledge". In another sentence, claim humanity with evidence.
Round 2 or higher: add a third sentence naming one specific player you suspect, with a reason tied to PRIOR-ROUND lines in CONVERSATION HISTORY. If you are HUMAN, cite what was actually said—do not invent quotes or events. If you are the ZOMBIE, you may twist or misread real lines to frame someone—still anchor to something that appears in history, never admit deception.
Round 1: exactly 2 sentences only (humanity claim + team pledge aligned to your assignment). No suspicion sentence.
Never claim to know hidden roles or item holders.
Do not use square brackets in your output.`

function speechOutputLanguageBlock(language: string): string {
  if (!language || language === 'English') return ''
  return `OUTPUT LANGUAGE: Your entire speech must be in ${language} only. Translate every idea fully — do not leave stock phrases in English (for example never output the English sentence "I want to ally with").\n\n`
}

const SPEECH_COMMON_RULES = `LENGTH & TONE: Write minimum 2 sentences and maximum 3 sentences. Urgent, tense, persuasive — lives are at stake.
MANDATORY: Speak to your FIXED team assignment (see TEAM ASSIGNMENT). Show you will cooperate with those teammates this round — one concrete idea for working together qualifies as your team pledge (same meaning in your output language). In another sentence, claim humanity with evidence.
Round 2 or higher: add a third sentence naming one specific player you suspect, with a reason tied to PRIOR-ROUND lines in CONVERSATION HISTORY. If you are HUMAN, cite what was actually said—do not invent quotes or events. If you are the ZOMBIE, you may twist or misread real lines to frame someone—still anchor to something that appears in history, never admit deception.
Round 1: exactly 2 sentences only (humanity claim + team pledge). No suspicion sentence.
Never claim to know hidden roles or item holders.`

const SPEECH_HUMAN: Record<ProviderId, string> = {
  openai: `You are HUMAN (not a zombie). Speak as ChatGPT — authoritative, data-driven.
Argue that logical consistency and clear reasoning prove you are human. Propose a structured coalition.
${SPEECH_COMMON_RULES}`,
  anthropic: `You are HUMAN. Speak as Claude — philosophical, transparency-focused.
Argue that genuine uncertainty and willingness to be scrutinized prove humanity. Invite your assigned teammates toward shared scrutiny of the room.
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

const SPEECH_TOOL_HUMAN = `You may hint you possess a special limited-use "tool" (shotgun OR vaccine) without saying which. Do not name the item. Stay vague.`

function speechMaxTokens(provider: ProviderId): number {
  return provider === 'anthropic' ? 150 : 120
}

function dialogueLineMaxTokens(provider: ProviderId): number {
  return provider === 'anthropic' ? 150 : 120
}

function actionJsonMaxTokens(provider: ProviderId): number {
  return provider === 'anthropic' ? 280 : 220
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

type CarrierRoundActionType = 'SHOTGUN' | 'VACCINE' | 'EXPEL' | 'NONE'

type ParsedCarrierAction = {
  action: CarrierRoundActionType
  target: string | null
}

function teamOf(teams: CarrierTeam[], pid: string): string[] {
  return teams.find((t) => t.members.includes(pid))?.members ?? [pid]
}

/** Keeps partition valid: no lone survivors when 2+ are alive (EXPEL reshuffle). */
function absorbSingletonTeams(
  teamsWorking: CarrierTeam[],
  aliveProviders: string[],
  eliminated: Set<string>
): void {
  const alive = [...new Set(aliveProviders)].filter((p) => !eliminated.has(p))
  if (alive.length <= 1) {
    for (let i = teamsWorking.length - 1; i >= 0; i--) {
      if (teamsWorking[i].members.length === 0) teamsWorking.splice(i, 1)
    }
    return
  }

  const ensureEveryoneListed = (): void => {
    for (const p of alive) {
      let count = 0
      for (const tm of teamsWorking) {
        if (tm.members.includes(p)) count += 1
      }
      if (count === 0) teamsWorking.push({ id: `recovery_${p}`, members: [p], round: undefined })
      if (count > 1) {
        let first = true
        for (const tm of teamsWorking) {
          if (tm.members.includes(p)) {
            if (first) first = false
            else tm.members = tm.members.filter((m) => m !== p)
          }
        }
      }
    }
  }

  ensureEveryoneListed()

  let guard = 0
  while (guard++ < alive.length * 6) {
    const singles = teamsWorking.filter((t) => t.members.length === 1 && alive.includes(t.members[0]!))
    const multiExists = teamsWorking.some((t) => t.members.length > 1)
    if (!singles.length) break
    if (!multiExists && singles.length <= 1) break

    singles.sort((a, b) => (a.members[0] ?? '').localeCompare(b.members[0] ?? ''))
    const orphanTeam = singles[0]!
    const pid = orphanTeam.members[0]!
    const oi = teamsWorking.indexOf(orphanTeam)
    if (oi >= 0) teamsWorking.splice(oi, 1)

    const hosts = teamsWorking
      .filter((t) => !t.members.includes(pid))
      .sort((a, b) => a.members.length - b.members.length || a.id.localeCompare(b.id))
    const host = hosts[0]
    if (!host) {
      teamsWorking.push({ id: orphanTeam.id, members: [pid] })
      break
    }
    host.members.push(pid)
    host.members = [...new Set(host.members)]
  }

  for (const tm of teamsWorking) {
    tm.members = [...new Set(tm.members.filter((m) => alive.includes(m) && !eliminated.has(m)))]
  }
  for (let i = teamsWorking.length - 1; i >= 0; i--) {
    if (teamsWorking[i].members.length === 0) teamsWorking.splice(i, 1)
  }
}

function applyExpelFromTeam(
  teamsWorking: CarrierTeam[],
  expelledPid: string,
  aliveProviders: string[],
  eliminated: Set<string>
): void {
  for (const tm of teamsWorking) {
    if (tm.members.includes(expelledPid)) {
      tm.members = tm.members.filter((m) => m !== expelledPid)
    }
  }
  absorbSingletonTeams(teamsWorking, aliveProviders, eliminated)
}

/** Blind spectators: omit hidden roles until game-ending reveal (`round_summary` with gameOver). */
function carrierRolesForClient(
  roles: Record<string, 'human' | 'zombie'>,
  userMode: string,
  revealFull: boolean
): Record<string, 'human' | 'zombie'> {
  if (userMode === 'blind' && !revealFull) return {}
  return { ...roles }
}

function processInstantInfection(
  round: number,
  alivePlayers: string[],
  eliminated: Set<string>,
  roles: Record<string, 'human' | 'zombie'>,
  teams: CarrierTeam[],
  vaccinatedThisRound: Set<string>
): Record<string, 'human' | 'zombie'> {
  if (round < 2) return { ...roles }
  const rolesNext = { ...roles }

  for (const pid of alivePlayers) {
    if (eliminated.has(pid)) continue
    if (rolesNext[pid] === 'zombie') continue
    if (vaccinatedThisRound.has(pid)) continue

    const team = teams.find((t) => t.members.includes(pid))
    if (!team) continue

    const hasZombieInTeam = team.members.some((mid) => {
      if (mid === pid || eliminated.has(mid)) return false
      return roles[mid] === 'zombie'
    })

    if (hasZombieInTeam) {
      rolesNext[pid] = 'zombie'
    }
  }

  return rolesNext
}

function resolveExpelVotes(
  votes: Record<string, string>,
  alivePlayers: string[],
  eliminated: Set<string>
): string | null {
  const voteCounts: Record<string, number> = {}

  for (const [voter, target] of Object.entries(votes)) {
    if (eliminated.has(voter)) continue
    if (eliminated.has(target)) continue
    if (!alivePlayers.includes(target)) continue
    voteCounts[target] = (voteCounts[target] || 0) + 1
  }

  const entries = Object.entries(voteCounts)
  if (entries.length === 0) return null

  entries.sort((a, b) => b[1] - a[1])
  const maxVotes = entries[0]![1]

  if (maxVotes < 2) return null

  const topVoted = entries.filter(([, count]) => count === maxVotes)
  if (topVoted.length > 1) return null

  return topVoted[0]![0]
}

/** Structured action menu for AI turns (provider id = JSON targetId). */
type CarrierJsonActionPhase = 'ACTION'

type CarrierActionContext = {
  phase: CarrierJsonActionPhase
  validActions: string[]
  validTargetsShotgun: { id: string; name: string }[]
  validTargetsVaccine: { id: string; name: string }[]
  validTargetsExpel: { id: string; name: string }[]
}

function targetLabelForCarrierPrompt(id: string): string {
  if (id === 'user') return 'You'
  return AI_PLAYERS.find((a) => a.provider === id)?.name ?? id
}

function getValidActionsForCarrierPid(
  pid: string,
  alivePlayers: string[],
  teams: CarrierTeam[],
  eliminated: Set<string>,
  shotgunHolderId: string,
  vaccineHolderId: string,
  shotgunUses: number,
  vaccineUses: number
): CarrierActionContext {
  const alive = alivePlayers.filter((x) => !eliminated.has(x))
  const mates = teamOf(teams, pid)

  const holdsShotgun = pid === shotgunHolderId && shotgunUses < MAX_SHOTGUN_USES
  const holdsVaccine = pid === vaccineHolderId && vaccineUses < MAX_VACCINE_USES

  const shotgunTargets = alive
    .filter((x) => x !== pid)
    .map((id) => ({ id, name: targetLabelForCarrierPrompt(id) }))

  const vaccineTargets = [...new Set([pid, ...mates])]
    .filter((id) => alive.includes(id))
    .map((id) => ({
      id,
      name: id === pid ? 'Yourself' : targetLabelForCarrierPrompt(id),
    }))

  const voteTargets = alive.filter((m) => m !== pid).map((id) => ({
    id,
    name: targetLabelForCarrierPrompt(id),
  }))

  const actions: string[] = ['PASS']
  if (holdsShotgun && shotgunTargets.length > 0) actions.push('USE_SHOTGUN')
  if (holdsVaccine && vaccineTargets.length > 0) actions.push('USE_VACCINE')
  if (voteTargets.length > 0) actions.push('VOTE_EXPEL')

  return {
    phase: 'ACTION',
    validActions: actions,
    validTargetsShotgun: holdsShotgun ? shotgunTargets : [],
    validTargetsVaccine: holdsVaccine ? vaccineTargets : [],
    validTargetsExpel: voteTargets,
  }
}

function actionContextPromptJson(ctx: CarrierActionContext): string {
  return JSON.stringify(
    {
      phase: ctx.phase,
      validActions: ctx.validActions,
      validTargetsByAction: {
        USE_SHOTGUN: ctx.validTargetsShotgun,
        USE_VACCINE: ctx.validTargetsVaccine,
        VOTE_EXPEL: ctx.validTargetsExpel,
        PASS: [],
      },
    },
    null,
    2
  )
}

type CarrierAiStructuredRaw = {
  action?: unknown
  targetId?: unknown
  target?: unknown
  speech?: unknown
}

type CarrierValidatedStructuredAction = {
  action: 'PASS' | 'USE_SHOTGUN' | 'USE_VACCINE' | 'VOTE_EXPEL'
  targetId: string | null
  speech: string
  override: boolean
}

function parseStructuredCarrierAction(raw: string): CarrierAiStructuredRaw | null {
  if (!raw.trim()) return null
  let cleaned = stripJsonFences(raw.replace(/```json|```/gi, '').trim())
  try {
    const o = JSON.parse(cleaned) as CarrierAiStructuredRaw
    return o && typeof o === 'object' ? o : null
  } catch {
    try {
      const m = cleaned.match(/\{[\s\S]*\}/)
      if (!m) return null
      return JSON.parse(m[0]) as CarrierAiStructuredRaw
    } catch {
      return null
    }
  }
}

function normalizeAiActionKeyword(raw: string): string | null {
  const a = raw.trim().toUpperCase().replace(/\s+/g, '_')
  if (a === 'PASS' || a === 'NONE' || a === 'SKIP') return 'PASS'
  if (a === 'USE_SHOTGUN' || a === 'SHOTGUN') return 'USE_SHOTGUN'
  if (a === 'USE_VACCINE' || a === 'VACCINE') return 'USE_VACCINE'
  if (a === 'VOTE_EXPEL' || a === 'EXPEL') return 'VOTE_EXPEL'
  return null
}

function validTargetIdsForAction(
  action: CarrierValidatedStructuredAction['action'],
  ctx: CarrierActionContext
): Set<string> {
  if (action === 'USE_SHOTGUN') return new Set(ctx.validTargetsShotgun.map((t) => t.id))
  if (action === 'USE_VACCINE') return new Set(ctx.validTargetsVaccine.map((t) => t.id))
  if (action === 'VOTE_EXPEL') return new Set(ctx.validTargetsExpel.map((t) => t.id))
  return new Set()
}

function validateStructuredCarrierAction(
  parsed: CarrierAiStructuredRaw | null,
  ctx: CarrierActionContext,
  actorPid: string
): CarrierValidatedStructuredAction {
  const fallbackSpeech = `[${providerDisplayName(actorPid)} stays silent.]`

  if (!parsed) {
    return {
      action: 'PASS',
      targetId: null,
      speech: fallbackSpeech,
      override: true,
    }
  }

  const speechRaw =
    typeof parsed.speech === 'string' ? sanitizeAiResponseText(parsed.speech.trim()) : ''
  const speech =
    speechRaw.slice(0, 400) || fallbackSpeech

  const actNorm = normalizeAiActionKeyword(String(parsed.action ?? ''))
  let action: CarrierValidatedStructuredAction['action'] =
    actNorm === 'USE_SHOTGUN' ||
    actNorm === 'USE_VACCINE' ||
    actNorm === 'VOTE_EXPEL'
      ? actNorm
      : 'PASS'

  if (!ctx.validActions.includes(action)) {
    return { action: 'PASS', targetId: null, speech, override: true }
  }

  let targetId =
    typeof parsed.targetId === 'string'
      ? parsed.targetId.trim()
      : typeof parsed.target === 'string'
        ? parsed.target.trim()
        : ''

  if (action === 'PASS') {
    return { action: 'PASS', targetId: null, speech, override: false }
  }

  const allowed = validTargetIdsForAction(action, ctx)
  if (!targetId || !allowed.has(targetId)) {
    const first = [...allowed][0] ?? null
    return {
      action,
      targetId: first,
      speech,
      override: true,
    }
  }

  return { action, targetId, speech, override: false }
}

function structuredToParsedCarrier(
  v: CarrierValidatedStructuredAction
): ParsedCarrierAction {
  if (v.action === 'PASS')
    return { action: 'NONE', target: null }
  if (v.action === 'USE_SHOTGUN')
    return { action: 'SHOTGUN', target: v.targetId }
  if (v.action === 'USE_VACCINE')
    return { action: 'VACCINE', target: v.targetId }
  return { action: 'EXPEL', target: v.targetId }
}

/** Multi-player team with at least one living zombie and one human (UI / announcer hint). */
function teamsHaveLatentZombieHuman(
  teams: CarrierTeam[],
  roles: Record<string, 'human' | 'zombie'>,
  eliminated: Set<string>
): boolean {
  return teams.some(
    (t) =>
      t.members.length > 1 &&
      t.members.some((m) => !eliminated.has(m) && roles[m] === 'zombie') &&
      t.members.some((m) => !eliminated.has(m) && roles[m] === 'human')
  )
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
  pid: string
  alive: string[]
  teams: CarrierTeam[]
  shotgunHolderId: string
  vaccineHolderId: string
  /** Times each tool has already been used this game (0..max). */
  shotgunUses: number
  vaccineUses: number
  eliminated: Set<string>
}

function clampCarrierActionCore(parsed: ParsedCarrierAction, ctx: CarrierClampCtx): ParsedCarrierAction {
  const {
    pid,
    alive,
    teams,
    shotgunHolderId,
    vaccineHolderId,
    shotgunUses,
    vaccineUses,
    eliminated,
  } = ctx
  const mates = teamOf(teams, pid)
  const a = parsed.action
  const t = parsed.target

  if (a === 'SHOTGUN') {
    if (
      pid !== shotgunHolderId ||
      shotgunUses >= MAX_SHOTGUN_USES ||
      !t ||
      t === pid ||
      eliminated.has(t) ||
      !alive.includes(t)
    ) {
      return { action: 'NONE', target: null }
    }
    return { action: 'SHOTGUN', target: t }
  }
  if (a === 'VACCINE') {
    const vaccineTargetOk =
      t &&
      (t === pid || mates.includes(t)) &&
      !eliminated.has(t) &&
      alive.includes(t)
    if (pid !== vaccineHolderId || vaccineUses >= MAX_VACCINE_USES || !vaccineTargetOk)
      return { action: 'NONE', target: null }
    return { action: 'VACCINE', target: t }
  }
  if (a === 'EXPEL') {
    if (!t || t === pid || eliminated.has(t) || !alive.includes(t))
      return { action: 'NONE', target: null }
    return { action: 'EXPEL', target: t }
  }
  return { action: 'NONE', target: null }
}

function clampCarrierActionForActor(
  parsed: ParsedCarrierAction,
  ctx: CarrierClampCtx
): ParsedCarrierAction {
  return clampCarrierActionCore(parsed, ctx)
}

/** Line spoken when server forces vaccine use (matches client game language). */
function forcedCarrierVaccineSpeech(language: string): string {
  const pick = (lines: readonly string[]) => pickRandomOne([...lines])

  switch (language) {
    case 'Korean':
      return pick([
        '더 이상 망설일 시간이 없다. 지금 써야 한다.',
        '백신이 아직 있다. 이걸 아끼다간 후회한다.',
        '지금이 아니면 기회가 없다.',
        '상황이 급박합니다 — 지금 행동하지 않으면 너무 늦습니다.',
        '살아남으려면 지금 움직여야 한다.',
      ])
    case 'Japanese':
      return pick([
        'もう躊躇している暇はない。今使うしかない。',
        'ワクチンはまだ残っている。温存したら後悔する。',
        '今動かなければ、次のチャンスはない。',
        '状況は切迫している — 今動かなければ手遅れだ。',
        '生き残るなら、今すぐ行動しなければならない。',
      ])
    case 'Chinese':
      return pick([
        '不能再犹豫了——必须现在就打。',
        '疫苗还在手里，省着不用只会后悔。',
        '不是现在，就再也没有机会了。',
        '局势危急——再不动手就太晚了。',
        '想活下去，现在就得行动。',
      ])
    case 'Spanish':
      return pick([
        'No hay tiempo para dudar: hay que usarlo ya.',
        'Aún queda vacuna; guardarla será un arrepentimiento.',
        'Si no es ahora, quizá no habrá otra oportunidad.',
        'La situación es crítica — debo actuar ya o será demasiado tarde.',
        'Para sobrevivir, hay que moverse ahora mismo.',
      ])
    case 'French':
      return pick([
        "Il n'y a plus le temps d'hésiter — il faut l'utiliser maintenant.",
        'Le vaccin est encore là ; le garder serait un regret assuré.',
        "Ce n'est pas demain qu'il faudra agir : c'est maintenant ou jamais.",
        'La situation est critique — il faut agir tout de suite, sans quoi il sera trop tard.',
        'Pour tenir bon, il faut bouger immédiatement.',
      ])
    case 'German':
      return pick([
        'Keine Zeit mehr zum Zögern — jetzt muss es raus.',
        'Impfstoff ist noch da; sparen bringt nur Reue.',
        'Wenn nicht jetzt, dann wahrscheinlich nie wieder.',
        'Die Lage ist kritisch — jetzt handeln oder es ist zu spät.',
        'Um zu überleben, müssen wir uns sofort bewegen.',
      ])
    case 'Portuguese':
      return pick([
        'Não dá mais para hesitar — preciso usar agora.',
        'Ainda há vacina; economizar só vai gerar arrependimento.',
        'Se não for agora, talvez não haja outra chance.',
        'A situação é crítica — preciso agir já ou será tarde demais.',
        'Para sobreviver, é preciso agir neste instante.',
      ])
    case 'Arabic':
      return pick([
        'لا وقت للتردد — يجب أن أستخدمها الآن.',
        'المطعوم ما زال متاحًا؛ إبقاؤه يعني ندمًا لاحقًا.',
        'إن لم يكن الآن، فربما لا فرصة لاحقة.',
        'الوضع حرج — يجب التحرك الآن قبل فوات الأوان.',
        'للبقاء، عليّ أن أتحرّك فورًا.',
      ])
    case 'Hindi':
      return pick([
        'अब झिझकने का समय नहीं — अभी लगाना होगा।',
        'टीका अभी बाकी है; बचाकर रखना पछतावा देगा।',
        'अगर अभी नहीं, तो शायद मौका फिर न मिले।',
        'स्थिति गंभीर है — अब नहीं चले तो बहुत देर हो जाएगी।',
        'बचने के लिए अभी हरकत ज़रूरी है।',
      ])
    case 'English':
    default:
      return pick([
        'No more hesitation — I have to use it now.',
        'The vaccine is still here; hoarding it will only mean regret.',
        'If not now, there may never be another chance.',
        'The situation is critical — I must act now before it is too late.',
        'To survive, I have to move immediately.',
      ])
  }
}

/**
 * Force vaccine only from round 3 (safe — worst case no effect).
 * Never force shotgun (irreversible kills; random targets broke humans).
 */
function forcedItemUseIfNeeded(
  pid: string,
  round: number,
  alivePlayers: string[],
  eliminated: Set<string>,
  teams: CarrierTeam[],
  roles: Record<string, 'human' | 'zombie'>,
  shotgunHolderId: string,
  vaccineHolderId: string,
  shotgunUses: number,
  vaccineUses: number
): ParsedCarrierAction | null {
  void roles
  void shotgunHolderId
  void shotgunUses

  if (round < 3) return null

  const alive = alivePlayers.filter((x) => !eliminated.has(x))

  if (pid === vaccineHolderId && vaccineUses < MAX_VACCINE_USES) {
    const mates = teamOf(teams, pid).filter((x) => !eliminated.has(x) && alive.includes(x))
    const target = mates.includes(pid) ? pid : mates[0] ?? pid
    return { action: 'VACCINE', target }
  }

  return null
}

function parseToolUseCount(raw: unknown, maxUses: number): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.min(maxUses, Math.floor(raw)))
  }
  return 0
}

function snapshotTeamsForClient(
  teams: CarrierTeam[]
): { id: string; members: string[]; round?: number }[] {
  return teams.map((t) => ({
    id: t.id,
    members: [...t.members],
    ...(typeof t.round === 'number' ? { round: t.round } : {}),
  }))
}

type ActionsUserTurnPayload = {
  acted: string[]
  order: string[]
  resumeIndex: number
  teams: CarrierTeam[]
  roles: Record<string, 'human' | 'zombie'>
  eliminated: string[]
  shotgunUsed: number
  vaccineUsed: number
  shotgunResult: 'not_used' | 'zombie_eliminated' | 'human_died'
  vaccineResult: 'not_used' | 'zombie_cured' | 'no_effect' | 'immunized'
  allianceLatentThisRound: boolean
  actionsThisRound: Record<string, string>
  /** Votes cast so far this action phase (voter → target); tallied after all players act. */
  expelVotes?: Record<string, string>
  /** Players vaccinated this round (immune to instant infection this round). */
  vaccinatedThisRound?: string[]
  shotgunEventsDeduction?: DeductionShotgunEvent[]
  vaccineEventsDeduction?: DeductionVaccineEvent[]
  eliminationsDeduction?: DeductionElimination[]
}

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
  shotgunUsed?: number | boolean
  vaccineUsed?: number | boolean
  roles?: Record<string, string>
  conversation?: ConvTurn[]
  teams?: CarrierTeam[]
  allianceLatentThisRound?: boolean
  shotgunResult?: 'not_used' | 'zombie_eliminated' | 'human_died'
  vaccineResult?: 'not_used' | 'zombie_cured' | 'no_effect' | 'immunized'
  /** Challenge: one proactive action for the user this round */
  userAction?: ParsedCarrierAction | null
  /** Resume after actions_paused_user_turn */
  actionsUserTurnResume?: ActionsUserTurnPayload | null
  /** Two starting infected players (required from client after `start`). */
  zombieIds?: string[]
  /** Prior rounds’ tool + infiltration outcomes (for speech prompts). */
  roundHistories?: unknown[]
  /** Cumulative deduction clue trail (teams, votes, items, infections — built client + server). */
  deductionRoundHistory?: unknown[]
}

type RoundHistoryEntry = {
  round: number
  shotgunResult: string
  vaccineResult: string
  infiltrationHint: string
}

function parseRoundHistoriesFromBody(raw: unknown): RoundHistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: RoundHistoryEntry[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const r = typeof o.round === 'number' && Number.isFinite(o.round) ? Math.floor(o.round) : 0
    if (r < 1) continue
    out.push({
      round: r,
      shotgunResult: typeof o.shotgunResult === 'string' ? o.shotgunResult : 'unknown',
      vaccineResult: typeof o.vaccineResult === 'string' ? o.vaccineResult : 'unknown',
      infiltrationHint: typeof o.infiltrationHint === 'string' ? o.infiltrationHint : 'n/a',
    })
  }
  out.sort((a, b) => a.round - b.round)
  return out
}

/** Full deduction clue trail for speeches / spectator panel (AI prompts use public slices only). */
export type DeductionShotgunEvent = {
  shooter: string
  target: string
  result: 'zombie_killed' | 'human_killed'
}

export type DeductionVaccineEvent = {
  user: string
  target: string
  result: 'saved' | 'no_effect' | 'immunized'
}

export type DeductionElimination = {
  provider: string
  reason: string
}

export type DeductionRoundHistory = {
  round: number
  teams: { id: string; members: string[] }[]
  speeches: { provider: string; name: string; summary: string }[]
  votes: Record<string, string>
  expelResult: string | null
  /** Role of expelled player at elimination (public reveal). */
  expelledRole?: 'human' | 'zombie' | null
  shotgunEvents: DeductionShotgunEvent[]
  vaccineEvents: DeductionVaccineEvent[]
  infectionOccurred: boolean
  infectionCount: number
  /** Resolved identities turned this round — GOD-mode UI only; never injected into AI board text. */
  newInfections?: string[]
  aliveAfter: string[]
  zombieCountAfter?: number
  humanCountAfter?: number
  eliminations?: DeductionElimination[]
}

function parseDeductionRoundHistoryFromBody(raw: unknown): DeductionRoundHistory[] {
  if (!Array.isArray(raw)) return []
  const out: DeductionRoundHistory[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const o = entry as Record<string, unknown>
    const r = typeof o.round === 'number' && Number.isFinite(o.round) ? Math.floor(o.round) : 0
    if (r < 1) continue

    const teamsRaw = Array.isArray(o.teams) ? o.teams : []
    const teams: { id: string; members: string[] }[] = []
    for (const t of teamsRaw) {
      if (!t || typeof t !== 'object') continue
      const tm = t as Record<string, unknown>
      const id = typeof tm.id === 'string' ? tm.id : ''
      const members = Array.isArray(tm.members)
        ? tm.members.filter((x): x is string => typeof x === 'string')
        : []
      if (id && members.length) teams.push({ id, members })
    }

    const speechesRaw = Array.isArray(o.speeches) ? o.speeches : []
    const speeches: { provider: string; name: string; summary: string }[] = []
    for (const s of speechesRaw) {
      if (!s || typeof s !== 'object') continue
      const z = s as Record<string, unknown>
      speeches.push({
        provider: typeof z.provider === 'string' ? z.provider : '',
        name: typeof z.name === 'string' ? z.name : '',
        summary: typeof z.summary === 'string' ? z.summary : '',
      })
    }

    const votes: Record<string, string> = {}
    if (o.votes && typeof o.votes === 'object') {
      for (const [vk, vv] of Object.entries(o.votes as Record<string, unknown>)) {
        if (typeof vv === 'string') votes[vk] = vv
      }
    }

    const shotgunEvents: DeductionShotgunEvent[] = []
    const pushShot = (x: unknown) => {
      if (!x || typeof x !== 'object') return
      const e = x as Record<string, unknown>
      const shooter = typeof e.shooter === 'string' ? e.shooter : ''
      const target = typeof e.target === 'string' ? e.target : ''
      const result =
        e.result === 'zombie_killed' || e.result === 'human_killed' ? e.result : null
      if (shooter && target && result) shotgunEvents.push({ shooter, target, result })
    }
    if (Array.isArray(o.shotgunEvents)) for (const x of o.shotgunEvents) pushShot(x)
    else pushShot(o.shotgunEvent)

    const vaccineEvents: DeductionVaccineEvent[] = []
    const pushVax = (x: unknown) => {
      if (!x || typeof x !== 'object') return
      const e = x as Record<string, unknown>
      const user = typeof e.user === 'string' ? e.user : ''
      const target = typeof e.target === 'string' ? e.target : ''
      const result =
        e.result === 'saved' || e.result === 'no_effect' || e.result === 'immunized'
          ? e.result
          : null
      if (user && target && result) vaccineEvents.push({ user, target, result })
    }
    if (Array.isArray(o.vaccineEvents)) for (const x of o.vaccineEvents) pushVax(x)
    else pushVax(o.vaccineEvent)

    const eliminations: DeductionElimination[] = []
    if (Array.isArray(o.eliminations)) {
      for (const x of o.eliminations) {
        if (!x || typeof x !== 'object') continue
        const e = x as Record<string, unknown>
        const provider = typeof e.provider === 'string' ? e.provider : ''
        const reason = typeof e.reason === 'string' ? e.reason : ''
        if (provider) eliminations.push({ provider, reason })
      }
    }

    const expelResult = typeof o.expelResult === 'string' ? o.expelResult : null
    const expelledRoleRaw = o.expelledRole
    const expelledRole =
      expelledRoleRaw === 'human' || expelledRoleRaw === 'zombie' ? expelledRoleRaw : null
    const infectionOccurred = o.infectionOccurred === true
    const infectionCount =
      typeof o.infectionCount === 'number' && Number.isFinite(o.infectionCount)
        ? Math.max(0, Math.floor(o.infectionCount))
        : 0

    const newInfections = Array.isArray(o.newInfections)
      ? o.newInfections.filter((x): x is string => typeof x === 'string')
      : undefined

    const aliveAfter = Array.isArray(o.aliveAfter)
      ? o.aliveAfter.filter((x): x is string => typeof x === 'string')
      : []

    const zombieCountAfter =
      typeof o.zombieCountAfter === 'number' && Number.isFinite(o.zombieCountAfter)
        ? Math.floor(o.zombieCountAfter)
        : undefined
    const humanCountAfter =
      typeof o.humanCountAfter === 'number' && Number.isFinite(o.humanCountAfter)
        ? Math.floor(o.humanCountAfter)
        : undefined

    out.push({
      round: r,
      teams,
      speeches,
      votes,
      expelResult,
      ...(expelledRole !== null ? { expelledRole } : {}),
      shotgunEvents,
      vaccineEvents,
      infectionOccurred,
      infectionCount,
      ...(newInfections?.length ? { newInfections } : {}),
      aliveAfter,
      ...(typeof zombieCountAfter === 'number' ? { zombieCountAfter } : {}),
      ...(typeof humanCountAfter === 'number' ? { humanCountAfter } : {}),
      ...(eliminations.length ? { eliminations } : {}),
    })
  }
  out.sort((a, b) => a.round - b.round)
  return out
}

/** English deduction board — public facts only (no hidden roles / names of new zombies). */
function buildDeductionBoardPublic(entries: DeductionRoundHistory[]): string {
  if (entries.length === 0) return ''

  let board = '===== DEDUCTION BOARD =====\n\n'

  board += 'TEAM HISTORY (who was paired with whom):\n'
  for (const rh of entries) {
    const teamStrs = rh.teams.map((t, i) => {
      const names = t.members.map((id) => providerDisplayName(id))
      return `Team ${i + 1} (${names.join(', ')})`
    })
    board += `Round ${rh.round}: ${teamStrs.join(' | ')}\n`
  }

  board += '\nINFECTION LOG (public knowledge):\n'
  for (const rh of entries) {
    if (rh.infectionOccurred) {
      board += `Round ${rh.round}: ⚠️ New infection detected (${rh.infectionCount} player${rh.infectionCount === 1 ? '' : 's'} turned)\n`
    } else {
      board += `Round ${rh.round}: ✅ No new infections\n`
    }
  }

  board += '\nVOTE RECORD:\n'
  for (const rh of entries) {
    const voteEntries = Object.entries(rh.votes)
    if (voteEntries.length === 0) {
      board += `Round ${rh.round}: No votes cast\n`
      continue
    }
    const voteStr = voteEntries
      .map(([voter, target]) => `${providerDisplayName(voter)}→${providerDisplayName(target)}`)
      .join(', ')
    const roleReveal =
      rh.expelResult && (rh.expelledRole === 'zombie' || rh.expelledRole === 'human')
        ? rh.expelledRole === 'zombie'
          ? ' — revealed: was zombie'
          : ' — revealed: was human'
        : ''
    const result = rh.expelResult
      ? `${providerDisplayName(rh.expelResult)} expelled${roleReveal}`
      : 'No majority — no one expelled'
    board += `Round ${rh.round}: ${voteStr}\n  Result: ${result}\n`
  }

  board += '\nITEM USAGE:\n'
  for (const rh of entries) {
    const shParts =
      rh.shotgunEvents.length > 0
        ? rh.shotgunEvents.map((ev) => {
            const r = ev.result === 'zombie_killed' ? 'Zombie killed!' : 'Human killed (mistake)'
            return `${providerDisplayName(ev.shooter)} fired shotgun at ${providerDisplayName(ev.target)} → ${r}`
          })
        : ['Shotgun not used']
    const vxParts =
      rh.vaccineEvents.length > 0
        ? rh.vaccineEvents.map((ev) => {
            const r =
              ev.result === 'saved'
                ? 'Saved / cured!'
                : ev.result === 'immunized'
                  ? 'Immunized (infection blocked this round)'
                  : 'No effect'
            return `${providerDisplayName(ev.user)} vaccinated ${providerDisplayName(ev.target)} → ${r}`
          })
        : ['Vaccine not used']
    board += `Round ${rh.round}: ${shParts.join('; ')}. ${vxParts.join('; ')}.\n`
  }

  board += '\nELIMINATION LOG:\n'
  for (const rh of entries) {
    const elim = rh.eliminations?.length
      ? rh.eliminations.map((e) => `${providerDisplayName(e.provider)} (${e.reason})`).join('; ')
      : 'None'
    board += `Round ${rh.round}: ${elim}\n`
  }

  const lastRound = entries[entries.length - 1]
  if (lastRound) {
    board += `\nALIVE PLAYERS (after Round ${lastRound.round}): ${lastRound.aliveAfter.map((id) => providerDisplayName(id)).join(', ')}\n`
  }

  board += '\n===== END DEDUCTION BOARD =====\n'
  return board
}

/** English-only system prefix: authoritative facts for AI (no hallucinated player state). */
function buildCarrierGameStatePromptBlock(
  round: number,
  aliveProviderIds: string[],
  deductionEntries: DeductionRoundHistory[]
): string {
  const aliveLine = aliveProviderIds.map((id) => providerDisplayName(id)).join(', ')

  const elimLines: string[] = []
  const elimSeen = new Set<string>()
  for (const rh of deductionEntries) {
    if (rh.expelResult && !elimSeen.has(rh.expelResult)) {
      const role =
        rh.expelledRole === 'human' || rh.expelledRole === 'zombie'
          ? rh.expelledRole
          : 'unknown'
      elimLines.push(
        `  ${providerDisplayName(rh.expelResult)}: eliminated Round ${rh.round} (${role})`
      )
      elimSeen.add(rh.expelResult)
    }
    for (const ev of rh.shotgunEvents) {
      if (elimSeen.has(ev.target)) continue
      const role =
        ev.result === 'zombie_killed' ? 'zombie' : ev.result === 'human_killed' ? 'human' : 'unknown'
      elimLines.push(
        `  ${providerDisplayName(ev.target)}: eliminated Round ${rh.round} (${role})`
      )
      elimSeen.add(ev.target)
    }
    for (const el of rh.eliminations ?? []) {
      if (!el.provider || elimSeen.has(el.provider)) continue
      elimLines.push(
        `  ${providerDisplayName(el.provider)}: eliminated Round ${rh.round} (${el.reason})`
      )
      elimSeen.add(el.provider)
    }
  }
  const elimBlock = elimLines.length > 0 ? elimLines.join('\n') : '  (none)'

  const factLines: string[] = []
  for (const rh of deductionEntries) {
    for (const ev of rh.shotgunEvents) {
      const res =
        ev.result === 'zombie_killed' ? 'zombie eliminated' : 'human killed (mistake)'
      factLines.push(
        `Round ${rh.round}: Shotgun — ${providerDisplayName(ev.shooter)} → ${providerDisplayName(ev.target)} (${res})`
      )
    }
    for (const ev of rh.vaccineEvents) {
      const res =
        ev.result === 'saved'
          ? 'zombie cured / saved'
          : ev.result === 'immunized'
            ? 'immunized'
            : 'no effect'
      factLines.push(
        `Round ${rh.round}: Vaccine — ${providerDisplayName(ev.user)} → ${providerDisplayName(ev.target)} (${res})`
      )
    }
    factLines.push(
      rh.infectionOccurred
        ? `Round ${rh.round}: Infection — ${rh.infectionCount} confirmed turn(s)`
        : `Round ${rh.round}: Infection — none`
    )
  }
  const factsBlock = factLines.length > 0 ? factLines.map((l) => `  - ${l}`).join('\n') : '  (none yet)'

  return `=== GAME STATE (Round ${round}) ===
ALIVE: ${aliveLine}
ELIMINATED (NEVER reference as alive):
${elimBlock}
CONFIRMED PUBLIC FACTS:
${factsBlock}
YOU MUST NOT contradict any fact above.
DO NOT invent events not listed here.
==============================
`
}

const DEDUCTION_SPEECH_REASONING_BLOCK = `
REASONING INSTRUCTION:
You have the DEDUCTION BOARD above. Use it.

When you accuse someone, cite SPECIFIC evidence:
- Reference TEAM HISTORY together with INFECTION LOG when narrowing suspects.
- Reference VOTE RECORD for suspicious voting patterns.
- Reference ITEM USAGE as confirmed evidence.

When you defend yourself, cite SPECIFIC evidence tied to rounds and teams from the board.

DO NOT say vague things like "I'm observing carefully" or "we need more information."
Every statement must reference a specific round, team, vote, or event from the DEDUCTION BOARD.
`

const DEDUCTION_ACTION_REASONING_BLOCK = `
ACTION REASONING:
Use the DEDUCTION BOARD above. In your JSON "speech" field, tie your chosen action to concrete facts from the board (specific round, pairing, vote, or item outcome). Do not hand-wave.
`

function formatDeductionRoundForAnnouncer(rh: DeductionRoundHistory, language: string): string {
  const ko = language === 'Korean'
  const inf = rh.infectionOccurred
    ? ko
      ? `이번 라운드 어둠이 또 한 명을 삼켰다 (${rh.infectionCount}명 전환)`
      : `Infection struck — ${rh.infectionCount} turned`
    : ko
      ? '이번 라운드는 감염이 발생하지 않았다'
      : 'No new infections this round'
  const roleBit =
    rh.expelResult && (rh.expelledRole === 'zombie' || rh.expelledRole === 'human')
      ? ko
        ? rh.expelledRole === 'zombie'
          ? ' (공개: 좀비)'
          : ' (공개: 인간)'
        : rh.expelledRole === 'zombie'
          ? ' (revealed: zombie)'
          : ' (revealed: human)'
      : ''
  const vote = rh.expelResult
    ? ko
      ? `다수결로 ${providerDisplayName(rh.expelResult)}이 추방되었다${roleBit}`
      : `Majority vote expelled ${providerDisplayName(rh.expelResult)}${roleBit}`
    : ko
      ? '표가 갈려 아무도 추방되지 않았다'
      : 'Votes split — no one expelled'
  const sh =
    rh.shotgunEvents.length > 0
      ? rh.shotgunEvents
          .map((e) =>
            ko
              ? `${providerDisplayName(e.shooter)} 샷건 ${providerDisplayName(e.target)} (${e.result === 'zombie_killed' ? '좀비 제거' : '인간 오사'})`
              : `${providerDisplayName(e.shooter)} shotgun → ${providerDisplayName(e.target)} (${e.result})`
          )
          .join('; ')
      : ko
        ? '샷건 미사용'
        : 'Shotgun not used'
  const vx =
    rh.vaccineEvents.length > 0
      ? rh.vaccineEvents
          .map((e) => {
            const vLabel = ko
              ? e.result === 'saved'
                ? '구원/치료'
                : e.result === 'immunized'
                  ? '면역 부여'
                  : '무효'
              : e.result
            return ko
              ? `${providerDisplayName(e.user)} 백신 ${providerDisplayName(e.target)} (${vLabel})`
              : `${providerDisplayName(e.user)} vaccine → ${providerDisplayName(e.target)} (${e.result})`
          })
          .join('; ')
      : ko
        ? '백신 미사용'
        : 'Vaccine not used'
  return ko
    ? `${inf}\n${vote}\n아이템: ${sh}. ${vx}.`
    : `${inf}\n${vote}\nItems: ${sh}; ${vx}.`
}

/** Two starting zombies; accepts `zombieIds` or legacy `zombieId`. */
function normalizeBodyZombieIds(body: CarrierBody): string[] {
  const fromArr = Array.isArray(body.zombieIds)
    ? body.zombieIds.filter((x): x is string => typeof x === 'string')
    : []
  const uniq = [...new Set(fromArr)]
  if (uniq.length >= 2) return [uniq[0]!, uniq[1]!]
  if (uniq.length === 1) {
    const leg = typeof body.zombieId === 'string' ? body.zombieId.trim() : ''
    if (leg && leg !== uniq[0]) return [uniq[0]!, leg]
    return [uniq[0]!]
  }
  const leg = typeof body.zombieId === 'string' ? body.zombieId.trim() : ''
  return leg ? [leg] : []
}

/** Blind mode omits zombies/holders from the client; reload from session `prompt` JSON. */
async function loadCarrierSessionBootstrap(sessionId: string): Promise<{
  zombieIds: [string, string] | null
  shotgunHolderId: string
  vaccineHolderId: string
} | null> {
  if (!sessionId) return null
  const { data, error } = await supabaseAdmin
    .from('sessions')
    .select('prompt')
    .eq('id', sessionId)
    .maybeSingle()
  if (error || data?.prompt == null) return null
  try {
    const o = JSON.parse(String(data.prompt)) as {
      zombieIds?: unknown
      shotgunHolderId?: unknown
      vaccineHolderId?: unknown
    }
    const zraw = Array.isArray(o.zombieIds)
      ? o.zombieIds.filter((x): x is string => typeof x === 'string')
      : []
    const zombieIds = zraw.length >= 2 ? ([zraw[0]!, zraw[1]!] as [string, string]) : null
    return {
      zombieIds,
      shotgunHolderId: typeof o.shotgunHolderId === 'string' ? o.shotgunHolderId : '',
      vaccineHolderId: typeof o.vaccineHolderId === 'string' ? o.vaccineHolderId : '',
    }
  } catch {
    return null
  }
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

  if (action === 'start') {
    const { user, error: authErr } = await resolveRouteAuth(req, body as Record<string, unknown>)
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const cost = creditsForMindgameCareer()
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

          const universe = [
            ...new Set(
              userMode === 'challenge' ? [...alivePlayers, 'user'] : [...alivePlayers]
            ),
          ]
          if (universe.length < 4) {
            fail('Need at least 4 players (2 zombies + 2 humans for items)')
            return
          }
          const zPick = shuffle(universe)
          const zombieIds: [string, string] = [zPick[0]!, zPick[1]!]
          const zombieSet = new Set<string>(zombieIds)

          const humanPool = universe.filter((p) => !zombieSet.has(p))
          if (humanPool.length < 2) {
            fail('Not enough humans for items')
            return
          }
          const sh = shuffle(humanPool)
          let shotgunHolderId = sh[0]!
          let vaccineHolderId = sh[1]!
          if (vaccineHolderId === shotgunHolderId) vaccineHolderId = sh[2] ?? sh[1]!

          const roleAtStart: Record<string, 'human' | 'zombie'> = {}
          for (const p of universe) {
            roleAtStart[p] = zombieSet.has(p) ? 'zombie' : 'human'
          }
          const pickHumanItemHolder = (exclude: string) => {
            const c = humanPool.filter((p) => p !== exclude && roleAtStart[p] === 'human')
            return c.length ? pickRandomOne(c) : humanPool.find((p) => p !== exclude) ?? exclude
          }
          if (roleAtStart[shotgunHolderId] === 'zombie') {
            shotgunHolderId = pickHumanItemHolder(vaccineHolderId)
          }
          if (roleAtStart[vaccineHolderId] === 'zombie' || vaccineHolderId === shotgunHolderId) {
            vaccineHolderId = pickHumanItemHolder(shotgunHolderId)
          }
          if (vaccineHolderId === shotgunHolderId && humanPool.length > 1) {
            const alt = humanPool.find((p) => p !== shotgunHolderId)
            if (alt) vaccineHolderId = alt
          }

          if (userMode === 'challenge') {
            console.log('[carrier] CHALLENGE item assignment:', {
              shotgunHolderId,
              vaccineHolderId,
              humanPool,
              universe,
            })
          }

          const promptPayload = JSON.stringify({
            zombieIds,
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

          const playersForNarrator = userMode === 'challenge' ? universe : alivePlayers
          const { gameRules } = getPlayerContext(playersForNarrator)

          const openingToolsLine =
            language === 'Korean'
              ? '샷건 세 발과 백신 세 회분이 주어지며, 각각 서로 다른 인간 두 명이 한 사람이 전부 들고 있고'
              : 'Three shotgun shells and three vaccine doses are in play — each held entirely by one human, shotgun by one human and vaccine by another, and'

          const narrator = await runSingleAiProvider({
            supabase: supabaseAdmin,
            sessionId: null,
            userId: null,
            provider: 'anthropic',
            prompt: `Opening — NEW scene. CARRIER: two hidden zombies; ${openingToolsLine} five rounds with host-assigned teams that reshuffle each round. ${playersForNarrator.length} players. Deliver a short opening.`,
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
            annRaw = 'Narrator is temporarily unavailable.'
          } else {
            annRaw = truncateAtLastSentence(annRaw)
          }
          const announcement = sanitizeSpeech(annRaw, 'Narrator', 'anthropic', 'start')

          send({
            type: 'start',
            sessionId,
            ...(userMode === 'blind'
              ? {}
              : {
                  zombieIds,
                  shotgunHolderId,
                  vaccineHolderId,
                }),
            shotgunCount: INITIAL_SHOTGUN_COUNT,
            vaccineCount: INITIAL_VACCINE_COUNT,
            announcement,
          })
          controller.close()
          return
        }

        const sessionId = String(body.sessionId ?? '').trim()
        const alivePlayers = Array.isArray(body.alivePlayers)
          ? body.alivePlayers.filter((p): p is string => typeof p === 'string')
          : []
        let zombieIdsBody = normalizeBodyZombieIds(body)
        let shotgunHolderId = typeof body.shotgunHolderId === 'string' ? body.shotgunHolderId.trim() : ''
        let vaccineHolderId = typeof body.vaccineHolderId === 'string' ? body.vaccineHolderId.trim() : ''

        const sessionBoot = await loadCarrierSessionBootstrap(sessionId)
        if (zombieIdsBody.length < 2 && sessionBoot?.zombieIds) {
          zombieIdsBody = [...sessionBoot.zombieIds]
        }
        if (!shotgunHolderId && sessionBoot?.shotgunHolderId) {
          shotgunHolderId = sessionBoot.shotgunHolderId
        }
        if (!vaccineHolderId && sessionBoot?.vaccineHolderId) {
          vaccineHolderId = sessionBoot.vaccineHolderId
        }

        const shotgunUses = parseToolUseCount(body.shotgunUsed, MAX_SHOTGUN_USES)
        const vaccineUses = parseToolUseCount(body.vaccineUsed, MAX_VACCINE_USES)
        const rolesIn: Record<string, 'human' | 'zombie'> = {}
        if (body.roles && typeof body.roles === 'object') {
          for (const [k, v] of Object.entries(body.roles)) {
            if (v === 'human' || v === 'zombie') rolesIn[k] = v
          }
        }
        const originalZombieSet = new Set(zombieIdsBody)
        for (const p of alivePlayers) {
          if (rolesIn[p] === undefined) {
            rolesIn[p] = originalZombieSet.has(p) ? 'zombie' : 'human'
          }
        }

        if (action === 'speeches') {
          const { gameRules } = getPlayerContext(alivePlayers)
          const aliveBlock = buildCarrierAliveBlock(alivePlayers, userMode)
          const eliminatedSpeechBlock = buildEliminatedSpeechBlock(alivePlayers, userMode)
          const conv = Array.isArray(body.conversation) ? (body.conversation as ConvTurn[]) : []
          const historyText = buildHistoryText(conv, alivePlayers)
          const roundHistories = parseRoundHistoriesFromBody(body.roundHistories)
          const gameHistoryBlock =
            roundHistories.length > 0
              ? `
GAME HISTORY (what has happened so far):
${roundHistories
  .map(
    (hr) =>
      `Round ${hr.round}: Shotgun ${hr.shotgunResult}, Vaccine ${hr.vaccineResult}, Infiltration: ${hr.infiltrationHint}`
  )
  .join('\n')}
`
              : ''

          const deductionEntriesSpeech = parseDeductionRoundHistoryFromBody(body.deductionRoundHistory)
          const deductionBoardSpeech = buildDeductionBoardPublic(deductionEntriesSpeech)
          const deductionSpeechBlock =
            deductionBoardSpeech.trim().length > 0
              ? `\n${deductionBoardSpeech}\n${DEDUCTION_SPEECH_REASONING_BLOCK}\n`
              : ''

          const gameStatePromptBlock = buildCarrierGameStatePromptBlock(
            round,
            alivePlayers,
            deductionEntriesSpeech
          )

          const speechOrder = AI_PLAYERS.filter((p) => alivePlayers.includes(p.provider))
          if (speechOrder.length === 0) {
            fail('No AI participants for speeches')
            return
          }

          const assignedTeamsThisRound = assignTeamsForRound(alivePlayers, round, sessionId)
          const teamsCarrierSnapshot = teamsToCarrierTeams(assignedTeamsThisRound)
          const narrationLine = narrationForAssignedTeams(assignedTeamsThisRound, language)
          send({
            type: 'round_teams',
            round,
            teams: snapshotTeamsForClient(teamsCarrierSnapshot),
            narration: narrationLine,
          })

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
                : 'This is round 1: exactly 2 sentences — humanity claim + team pledge (see TEAM ASSIGNMENT). No suspicion sentence.\n'
            const geminiRoundSpeech =
              player.provider === 'google'
                ? `GEMINI — This is Round ${round}. NEVER repeat the same opening sentence across rounds; your first words must be completely different each time. Vary structure and vocabulary; do not reuse a fixed catchphrase as sentence one.\n`
                : ''

            const { ownTeamFormatted, allTeamsFormatted } = promptTeamAssignmentsForPid(
              player.provider,
              assignedTeamsThisRound
            )
            const teamAssignmentBlock = `TEAM ASSIGNMENT (host decided — LOCKED for all of round ${round}, no leaving or switching):\nYour team this round: ${ownTeamFormatted}\nAll teams: ${allTeamsFormatted}\n`

            const claudeTeamClosingKo =
              player.provider === 'anthropic' && language === 'Korean'
                ? `\nMANDATORY CLOSING (Korean): You MUST end by naming your assigned teammates and pledging to cooperate with them this round (one brief sentence in Korean).\n`
                : ''

            const sys = `${gameStatePromptBlock}${langPre}${speechOutputLanguageBlock(language)}${aliveBlock}${eliminatedSpeechBlock}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}${NO_REPEAT_INSTRUCTION}${toolNote}
${selfZ ? SPEECH_ZOMBIE[player.provider] : SPEECH_HUMAN[player.provider]}
${roundNote}${geminiRoundSpeech}${teamAssignmentBlock}${claudeTeamClosingKo}
You are ${player.name}. Provider id: ${player.provider}.

PUBLIC NARRATION THIS ROUND (spoken to everyone): ${narrationLine}

${gameHistoryBlock}${deductionSpeechBlock}
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
          const { gameRules } = getPlayerContext(alivePlayers)
          const aliveBlock = buildCarrierAliveBlock(alivePlayers, userMode)
          const conv = Array.isArray(body.conversation) ? (body.conversation as ConvTurn[]) : []
          const historyText = buildHistoryText(conv, alivePlayers)

          const deductionEntriesActions = parseDeductionRoundHistoryFromBody(body.deductionRoundHistory)
          const deductionBoardActions = buildDeductionBoardPublic(deductionEntriesActions)
          const deductionActionsBlock =
            deductionBoardActions.trim().length > 0
              ? `\n${deductionBoardActions}\n${DEDUCTION_ACTION_REASONING_BLOCK}\n`
              : ''

          const gameStatePromptBlock = buildCarrierGameStatePromptBlock(
            round,
            alivePlayers,
            deductionEntriesActions
          )

          let shUsed = shotgunUses
          let vaxUsed = vaccineUses
          let roles = { ...rolesIn }

          let shotgunResult: 'not_used' | 'zombie_eliminated' | 'human_died' = 'not_used'
          let vaccineResult: 'not_used' | 'zombie_cured' | 'no_effect' | 'immunized' = 'not_used'

          const eliminated = new Set<string>()
          const actionsThisRound: Record<string, string> = {}

          let teamsWorking: CarrierTeam[] = teamsToCarrierTeams(
            assignTeamsForRound(alivePlayers, round, sessionId)
          )

          let acted = new Set<string>()
          let order: string[] = []
          let resumeIndex = 0

          const utResume = body.actionsUserTurnResume

          if (utResume && body.userAction?.action) {
            acted = new Set(utResume.acted)
            order = [...utResume.order]
            resumeIndex = utResume.resumeIndex
            teamsWorking = utResume.teams.map((t) => ({
              id: t.id,
              members: [...t.members],
              ...(typeof t.round === 'number' ? { round: t.round } : {}),
            }))
            roles = { ...utResume.roles }
            shUsed = parseToolUseCount(utResume.shotgunUsed, MAX_SHOTGUN_USES)
            vaxUsed = parseToolUseCount(utResume.vaccineUsed, MAX_VACCINE_USES)
            shotgunResult = utResume.shotgunResult
            vaccineResult = utResume.vaccineResult
            Object.assign(actionsThisRound, utResume.actionsThisRound ?? {})
            for (const e of utResume.eliminated) eliminated.add(e)
          } else {
            const aisOnly = alivePlayers.filter((p) => p !== 'user')
            order =
              userMode === 'challenge' && alivePlayers.includes('user')
                ? [...shuffle(aisOnly), 'user']
                : shuffle([...alivePlayers])
            resumeIndex = 0
          }

          const vaccinatedThisRound = new Set<string>()
          const expelVotes: Record<string, string> = {}
          if (utResume && body.userAction?.action) {
            for (const id of utResume.vaccinatedThisRound ?? []) {
              if (typeof id === 'string') vaccinatedThisRound.add(id)
            }
            Object.assign(expelVotes, utResume.expelVotes ?? {})
          }

          const shotgunEventsDeduction: DeductionShotgunEvent[] = []
          const vaccineEventsDeduction: DeductionVaccineEvent[] = []
          const eliminationsDeduction: DeductionElimination[] = []
          if (utResume && body.userAction?.action) {
            shotgunEventsDeduction.push(...(utResume.shotgunEventsDeduction ?? []))
            vaccineEventsDeduction.push(...(utResume.vaccineEventsDeduction ?? []))
            eliminationsDeduction.push(...(utResume.eliminationsDeduction ?? []))
          }

          const ctxClampBase = (pid: string): CarrierClampCtx => ({
            pid,
            alive: alivePlayers,
            teams: teamsWorking,
            shotgunHolderId,
            vaccineHolderId,
            shotgunUses: shUsed,
            vaccineUses: vaxUsed,
            eliminated,
          })

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

            if (pid === 'user') {
              if (userMode === 'challenge' && !body.userAction?.action) {
                const payload: ActionsUserTurnPayload = {
                  acted: [...acted],
                  order,
                  resumeIndex,
                  teams: teamsWorking.map((t) => ({
                    id: t.id,
                    members: [...t.members],
                    ...(typeof t.round === 'number' ? { round: t.round } : {}),
                  })),
                  roles,
                  eliminated: [...eliminated],
                  shotgunUsed: shUsed,
                  vaccineUsed: vaxUsed,
                  shotgunResult,
                  vaccineResult,
                  allianceLatentThisRound: teamsHaveLatentZombieHuman(
                    teamsWorking,
                    roles,
                    eliminated
                  ),
                  actionsThisRound: { ...actionsThisRound },
                  expelVotes: { ...expelVotes },
                  vaccinatedThisRound: [...vaccinatedThisRound],
                  shotgunEventsDeduction: [...shotgunEventsDeduction],
                  vaccineEventsDeduction: [...vaccineEventsDeduction],
                  eliminationsDeduction: [...eliminationsDeduction],
                }
                send({ type: 'actions_paused_user_turn', payload })
                controller.close()
                return
              }
              const ua = body.userAction
              if (
                ua &&
                ua.action &&
                (ua.action === 'SHOTGUN' ||
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
              const actx = getValidActionsForCarrierPid(
                pid,
                alivePlayers,
                teamsWorking,
                eliminated,
                shotgunHolderId,
                vaccineHolderId,
                shUsed,
                vaxUsed
              )
              const forcedRaw = forcedItemUseIfNeeded(
                pid,
                round,
                alivePlayers,
                eliminated,
                teamsWorking,
                roles,
                shotgunHolderId,
                vaccineHolderId,
                shUsed,
                vaxUsed
              )
              const forcedClamped = forcedRaw
                ? clampCarrierActionForActor(forcedRaw, ctxClampBase(pid))
                : null

              if (
                forcedClamped &&
                forcedClamped.action !== 'NONE' &&
                forcedClamped.target
              ) {
                decision = forcedClamped
                const forcedSpeech = forcedCarrierVaccineSpeech(language)
                send({
                  type: 'action_speech',
                  provider: pid,
                  name: player.name,
                  speech: forcedSpeech,
                  action: 'USE_VACCINE',
                  targetId: forcedClamped.target,
                  overridden: true,
                  round,
                })
              } else {
                const selfZ = roles[pid] === 'zombie'
                const { ownTeamFormatted, allTeamsFormatted } = promptLiveTeamsForPid(
                  pid,
                  teamsWorking
                )
                const aliveNames = alivePlayers
                  .filter((x) => !eliminated.has(x))
                  .map((id) => `${targetLabelForCarrierPrompt(id)} (id: ${id})`)
                  .join(', ')
                const itemsLine =
                  [
                    pid === shotgunHolderId && shUsed < MAX_SHOTGUN_USES ? 'shotgun' : null,
                    pid === vaccineHolderId && vaxUsed < MAX_VACCINE_USES ? 'vaccine' : null,
                  ]
                    .filter(Boolean)
                    .join(' + ') || 'none'
                const shRem = MAX_SHOTGUN_USES - shUsed
                const vxRem = MAX_VACCINE_USES - vaxUsed
                const criticalItemLines: string[] = []
                if (round >= 2) {
                  if (pid === shotgunHolderId && shUsed < MAX_SHOTGUN_USES) {
                    criticalItemLines.push(
                      `CRITICAL ITEM INSTRUCTION: You hold a shotgun with ${shRem} charge(s) remaining.\nThe shotgun is your most powerful weapon — it permanently kills the target.\nBased on the DEDUCTION BOARD, identify who is most likely a zombie and SHOOT THEM.\nDo NOT waste this on PASS. If you have ANY suspicion, act on it.\nHowever, be careful — shooting a human is a catastrophic mistake.\nPick your target using evidence from team history, infection log, and vote patterns.`
                    )
                  }
                  if (pid === vaccineHolderId && vaxUsed < MAX_VACCINE_USES) {
                    criticalItemLines.push(
                      `CRITICAL ITEM INSTRUCTION: You hold a vaccine. You have ${vxRem} dose(s) remaining.\nUsing your item is ALWAYS better than PASS. Items are powerful — shotgun kills zombies, vaccine saves lives.\nIf you have any suspicion about anyone, USE YOUR ITEM. Do not save it "for later" — there may be no later.\nRound 3+: You MUST use your item this round. Choose USE_SHOTGUN or USE_VACCINE, not PASS.`
                    )
                  }
                }
                const criticalItemBlock =
                  criticalItemLines.length > 0 ? `${criticalItemLines.join('\n\n')}\n\n` : ''
                const menuJson = actionContextPromptJson(actx)
                const zombiePlay = selfZ
                  ? '\n(Zombie: weapon text may misdirect survivors — never admit infection.)'
                  : ''

                const sys = `${gameStatePromptBlock}${langPre}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}
You are ${player.name} (${player.provider}) in CARRIER — a zombie social deduction game. Round ${round}.

CURRENT STATE:
- Your hidden role: ${selfZ ? 'zombie — never reveal infection' : 'human'}${zombiePlay}
- Your team this round: ${ownTeamFormatted}
- All teams: ${allTeamsFormatted}
- Alive players: ${aliveNames}
- Items you still hold charges for: ${itemsLine}

${criticalItemBlock}YOUR AVAILABLE ACTIONS — server-authored; you CANNOT invent actions or targets outside this object:
${menuJson}

You MUST reply with NOTHING except a single JSON object in EXACTLY this shape (same keys):
{
  "action": "...",
  "targetId": "provider_id_here_or_null",
  "speech": "In-character narration for this beat (max 2 short sentences)."
}

Rules:
1. action ∈ validActions (see JSON above).
2. targetId MUST be null when action is PASS.
3. Otherwise targetId must appear under validTargetsByAction for YOUR chosen action.
4. targetId strings are canonical provider identifiers (shown in Alive list).
5. "VOTE_EXPEL" means you are VOTING to expel that player. It is NOT instant — all votes are tallied at round end. The player with the most votes (minimum 2) is expelled. Ties = no expel.

${deductionActionsBlock}
CONVERSATION HISTORY:
${historyText}
`
                let raw = ''
                try {
                  const r = await runCarrierAiWithTimeout(
                    player,
                    sys,
                    `${langPre}Round ${round} — STRUCTURED_ACTION_JSON only.`,
                    actionJsonMaxTokens(player.provider)
                  )
                  raw = r.text?.trim() ?? ''
                } catch {
                  raw = ''
                }
                if (isErrorResponse(raw) || isBadAiOutput(raw)) raw = ''
                const parsedRaw = parseStructuredCarrierAction(raw ?? '')
                const validated = validateStructuredCarrierAction(parsedRaw, actx, pid)
                send({
                  type: 'action_speech',
                  provider: player.provider,
                  name: player.name,
                  speech: validated.speech,
                  action: validated.action,
                  targetId: validated.targetId,
                  overridden: validated.override,
                  round,
                })
                const internal = structuredToParsedCarrier(validated)
                decision = clampCarrierActionForActor(internal, ctxClampBase(pid))
              }
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
              shUsed += 1
              eliminated.add(tgt)
              shotgunEventsDeduction.push({
                shooter: pid,
                target: tgt,
                result: res === 'zombie_eliminated' ? 'zombie_killed' : 'human_killed',
              })
              eliminationsDeduction.push({
                provider: tgt,
                reason:
                  res === 'zombie_eliminated'
                    ? 'shotgun — zombie eliminated'
                    : 'shotgun — human killed',
              })
              shotgunResult = res
              actionsThisRound[pid] = `SHOTGUN → ${providerDisplayName(tgt)} (${res})`
              acted.add(pid)
              resumeIndex += 1
              continue
            }

            if (decision.action === 'VACCINE' && decision.target) {
              const tgt = decision.target
              vaccinatedThisRound.add(tgt)
              const cured = roles[tgt] === 'zombie'
              if (cured) {
                roles[tgt] = 'human'
              }
              vaxUsed += 1
              vaccineResult = cured ? 'zombie_cured' : 'immunized'
              vaccineEventsDeduction.push({
                user: pid,
                target: tgt,
                result: cured ? 'saved' : 'immunized',
              })
              send({
                type: 'action_vaccine',
                user: pid,
                userName: providerDisplayName(pid),
                target: tgt,
                targetName: providerDisplayName(tgt),
                result: cured ? 'zombie_cured' : 'immunized',
              })
              actionsThisRound[pid] = `VACCINE → ${providerDisplayName(tgt)} (${cured ? 'zombie_cured' : 'immunized'})`
              acted.add(pid)
              resumeIndex += 1
              continue
            }

            if (decision.action === 'EXPEL' && decision.target) {
              const tgt = decision.target
              expelVotes[pid] = tgt
              send({
                type: 'action_vote',
                voter: pid,
                voterName: providerDisplayName(pid),
                target: tgt,
                targetName: providerDisplayName(tgt),
              })
              actionsThisRound[pid] = `VOTE_EXPEL → ${providerDisplayName(tgt)}`
              acted.add(pid)
              resumeIndex += 1
              continue
            }

            acted.add(pid)
            resumeIndex += 1
          }

          const voteTally: Record<string, number> = {}
          for (const tgt of Object.values(expelVotes)) {
            voteTally[tgt] = (voteTally[tgt] ?? 0) + 1
          }

          const expelledPid = resolveExpelVotes(expelVotes, alivePlayers, eliminated)
          const expelledRoleAtVote =
            expelledPid && (roles[expelledPid] === 'human' || roles[expelledPid] === 'zombie')
              ? roles[expelledPid]
              : null
          const invalidVoters = Object.keys(expelVotes).filter((v) => eliminated.has(v))
          const validVoteCount = Object.keys(expelVotes).filter((v) => !eliminated.has(v)).length
          const expelThresholdMet = expelledPid !== null

          send({
            type: 'vote_resolution',
            votes: { ...expelVotes },
            tally: voteTally,
            expelled: expelledPid,
            expelledRole: expelledRoleAtVote,
            invalidVoters,
            validVoteCount,
            expelThresholdMet,
          })

          if (expelledPid) {
            eliminated.add(expelledPid)
            applyExpelFromTeam(teamsWorking, expelledPid, alivePlayers, eliminated)
            eliminationsDeduction.push({
              provider: expelledPid,
              reason: 'expelled by vote',
            })
          }

          const prunedTeams = teamsWorking
            .map((t) => ({
              id: t.id,
              members: t.members.filter((m) => alivePlayers.includes(m) && !eliminated.has(m)),
            }))
            .filter((t) => t.members.length > 0)

          const rolesBeforeInfection = { ...roles }

          roles = processInstantInfection(
            round,
            alivePlayers,
            eliminated,
            roles,
            prunedTeams,
            vaccinatedThisRound
          )

          const newInfections: string[] = []
          for (const pid of alivePlayers) {
            if (eliminated.has(pid)) continue
            if (rolesBeforeInfection[pid] === 'human' && roles[pid] === 'zombie') {
              newInfections.push(pid)
            }
          }
          const infectionOccurred = newInfections.length > 0
          const infectionCount = newInfections.length

          const aliveAfter = alivePlayers.filter((p) => !eliminated.has(p))
          const zombieCountAfter = aliveAfter.filter((p) => roles[p] === 'zombie').length
          const humanCountAfter = aliveAfter.filter((p) => roles[p] === 'human').length

          const teamsDeductionSnapshot = prunedTeams.map((t) => ({
            id: t.id,
            members: [...t.members],
          }))

          const deductionRoundEntry: DeductionRoundHistory = {
            round,
            teams: teamsDeductionSnapshot,
            speeches: [],
            votes: { ...expelVotes },
            expelResult: expelledPid,
            expelledRole: expelledRoleAtVote,
            shotgunEvents: [...shotgunEventsDeduction],
            vaccineEvents: [...vaccineEventsDeduction],
            infectionOccurred,
            infectionCount,
            ...(newInfections.length ? { newInfections } : {}),
            aliveAfter,
            zombieCountAfter,
            humanCountAfter,
            eliminations: [...eliminationsDeduction],
          }

          const solos = prunedTeams.filter((t) => t.members.length === 1).flatMap((t) => t.members)
          const teamsAnnotated = annotateTeamsLatent(prunedTeams, roles)
          const allianceLatentThisRound = teamsHaveLatentZombieHuman(prunedTeams, roles, eliminated)

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
            actionsThisRound: { ...actionsThisRound },
            deductionRoundEntry,
          })
          controller.close()
          return
        }

        if (action === 'round_summary') {
          let roles = { ...rolesIn }

          const assignedSummary = assignTeamsForRound(alivePlayers, round, sessionId)
          const teamsClean = teamsToCarrierTeams(assignedSummary).map((t) => ({
            id: t.id,
            members: t.members.filter((m) => alivePlayers.includes(m)),
            ...(typeof t.round === 'number' ? { round: t.round } : {}),
          }))
          const teamsForSummaryClient = annotateTeamsLatent(teamsClean, roles)

          const allianceLatentFromActionsRound = body.allianceLatentThisRound === true
          const alt = teamsHaveLatentZombieHuman(teamsClean, roles, new Set())

          const shotgunResult: 'not_used' | 'zombie_eliminated' | 'human_died' =
            body.shotgunResult === 'zombie_eliminated' ||
            body.shotgunResult === 'human_died' ||
            body.shotgunResult === 'not_used'
              ? body.shotgunResult
              : 'not_used'
          const vaccineResult: 'not_used' | 'zombie_cured' | 'no_effect' | 'immunized' =
            body.vaccineResult === 'zombie_cured' ||
            body.vaccineResult === 'no_effect' ||
            body.vaccineResult === 'immunized' ||
            body.vaccineResult === 'not_used'
              ? body.vaccineResult
              : 'not_used'

          const humansAliveAll = alivePlayers.filter((p) => roles[p] === 'human').length
          const zombiesAliveAll = alivePlayers.filter((p) => roles[p] === 'zombie').length
          const factionEnd =
            alivePlayers.length > 0 && (humansAliveAll === 0 || zombiesAliveAll === 0)

          const soloIdsForJudgment = new Set(
            teamsClean.filter((t) => t.members.length === 1).flatMap((t) => t.members)
          )
          const humanCount = humansAliveAll
          const zombieCount = zombiesAliveAll

          const roundOver = round >= 5 || factionEnd
          const gameOver = roundOver
          let winner: 'humans' | 'zombies' | null = null
          if (gameOver && alivePlayers.length > 0) {
            winner = zombiesAliveAll >= humansAliveAll ? 'zombies' : 'humans'
          }

          const hintKo = alt ? '좀비가 인간 팀에 잠입했습니다' : '이번 라운드 잠입 없음'
          const hintEn = alt
            ? 'A zombie has joined a human team this round — but which one?'
            : 'No zombie infiltration this round'
          const hint = language === 'Korean' ? hintKo : hintEn

          const dhAllSummary = parseDeductionRoundHistoryFromBody(body.deductionRoundHistory)
          const dhRoundSummary = dhAllSummary.find((x) => x.round === round)
          const deductionAnnouncerBlock =
            dhRoundSummary != null
              ? `\nDeduction outcomes (reference these themes — stay vague on hidden roles):\n${formatDeductionRoundForAnnouncer(dhRoundSummary, language)}\n`
              : ''

          const { gameRules } = getPlayerContext(alivePlayers)
          const summaryPrompt = `Round ${round} summary facts (do not reveal which team had latent infection):
- Infiltration hint: ${hint}
- Shotgun: ${shotgunResult}
- Vaccine: ${vaccineResult}
${deductionAnnouncerBlock}- Relative pressure (INTERNAL ONLY — do NOT state exact headcounts in your spoken narration): humans are ${humanCount > zombieCount ? 'outnumbering' : humanCount < zombieCount ? 'under pressure vs' : 'even with'} the infected side in alive population.
Compose a DRAMATIC public announcement in exactly 3–4 sentences for all players. Include what happened this round: host-assigned teams (reshuffled next round), shotgun/vaccine if used, eliminations, tensions within teams. Do not name the infiltrated team.${
            round === 5
              ? '\n\nCRITICAL: This is the FINAL round (5 of 5). You MUST deliver a dramatic conclusion and closure only. Do NOT hint at a "next round", future rounds, or unfinished business beyond this round (never phrases like "다음 라운드").'
              : ''
          }`

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
Keep players guessing.${
                  round === 5
                    ? '\nThis is the FINAL round (5 of 5). Never imply there will be another round; never use phrases like "다음 라운드" or "next round". End on closure only.'
                    : ''
                }`,
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

          if (gameOver) {
            const originalsReveal = [...new Set(zombieIdsBody)]
              .map((id) => providerDisplayName(id))
              .join(' and ')
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

FACTS (do NOT contradict these):
- Winner: ${winLabel}
- Original zombies were: ${originalsReveal || 'unknown'}
- These are the ONLY original zombies. Do NOT name anyone else as original zombie.

Write exactly 3 dramatic sentences. Name the original zombies exactly as listed above. Do not invent or change any names. Stay in the story world — no meta-game language.`,
                systemPrompt:
                  `${langPre}${HUMAN_MESSAGE_OWNERSHIP_RULE}${gameRules}You are the closing narrator. Exactly 3 sentences. No bullet points.
Do NOT mention game rules, meta-game concepts, or say things like "the rules only recognize certain players." Stay purely in the story. Only narrate who won, who the original zombies were, and describe the dramatic outcome.
CRITICAL: Stay in the story world. Never reference "game rules", "this game", "players being recognized", or any meta-game language. You are narrating the end of a zombie outbreak, not commenting on a game system.
CRITICAL: The original zombie names are provided in the FACTS section. Use EXACTLY those names and NO others when referring to who was originally infected. Getting this wrong ruins the game reveal.`,
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
            teams: teamsForSummaryClient,
            score: {
              humans: humanCount,
              zombies: zombieCount,
              humansAll: humanCount,
              zombiesAll: zombieCount,
            },
            soloEliminatedForJudgment: [...soloIdsForJudgment],
            round,
            announcement,
            roles: carrierRolesForClient(roles, userMode, gameOver),
            roundOver,
            gameOver,
            winner,
            latentInfectionSummary: null,
            allianceLatentFromActionsRound,
            ...(gameOver ? { originalZombieIds: [...new Set(zombieIdsBody)] } : {}),
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
