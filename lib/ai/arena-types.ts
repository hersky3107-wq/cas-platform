export type ArenaAI = 'gpt' | 'claude' | 'gemini' | 'grok' | 'deepseek' | 'mistral'

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
