export type ArenaAI = 'gpt' | 'claude' | 'gemini' | 'grok' | 'deepseek' | 'mistral'

export type ArenaFightMode = 'logic' | 'street'

export type ArenaMemoryRole = 'champion' | 'challenger' | 'co-fighter'

export interface ArenaMemoryEntry {
  round: number
  fighter: string
  role: ArenaMemoryRole
  content: string
}

export interface ArenaResponse {
  ai: ArenaAI
  champion: boolean
  position: string
  angle: string
  challenge: string | null
  support: string | null
  supportComment: string | null
  content: string
  responseTimeMs: number
  side: 'left' | 'right' | 'neutral'
  /** No API call — static supporter line in battle rounds */
  synthetic?: boolean
  /** Round 4+ co-fighter from the larger camp (real API turn) */
  joinedFight?: boolean
}

export interface ArenaRound {
  roundNumber: number
  responses: ArenaResponse[]
  sides: {
    left: ArenaAI[]
    right: ArenaAI[]
  }
  champion: {
    left: ArenaAI | null
    right: ArenaAI | null
  }
}
