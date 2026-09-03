import type { ArenaAI } from '@/lib/ai/arena-types'

export type { ArenaAI, ArenaFightMode, ArenaMemoryEntry, ArenaResponse, ArenaRound } from '@/lib/ai/arena-types'

export const ARENA_ORDER: ArenaAI[] = [
  'grok',
  'gpt',
  'gemini',
  'deepseek',
  'mistral',
  'claude',
]

export const ARENA_DISPLAY: Record<ArenaAI, string> = {
  grok: 'Grok',
  gpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  claude: 'Claude',
}

/** Flat unlock cost for rounds 4–6 (one purchase per session). */
export function arenaFinalBundleCreditCost(): number {
  return 6
}

/** Flat unlock cost for rounds 7–9 (second continue; requires final bundle). */
export function arenaExtendedBundleCreditCost(): number {
  return 6
}
