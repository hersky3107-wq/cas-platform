import { listPriceCost, TOKEN_CAPS, TYPICAL_OUTPUT_TOKENS } from './prices'
import type { AnthropicThinking, EngineProvider, GoogleThinking } from './providers/types'
import type { EngineRole } from './schema'

/**
 * Crisis engine roster. Model strings are pinned to the ids league-work
 * actually calls (git show league-work:lib/league/roster.ts and
 * lib/ai/platform-providers.ts). No lookup in the main-branch router.
 *
 * Challenger Kimi is still moonshotai/kimi-k2.6 in the platform registry;
 * the official 40-AI Challenger seat was swapped to Hunyuan. Solar Pro 3
 * is retired on league-work; the live Upstage seat is solar-pro4.
 */
export interface RosterSlot {
  role: EngineRole
  slot: string
  model: string
  provider: EngineProvider
  brand: string
  search: boolean
  maxTurns?: number
  extraBody?: Record<string, unknown>
  googleThinking?: GoogleThinking
  anthropicThinking?: AnthropicThinking
  reasoning?: boolean
}

export interface ResolvedRoster {
  slots: RosterSlot[]
  judgeModel: string
}

const REASONING_MINIMAL = { reasoning: { effort: 'minimal' } }
const XAI_REASONING_LOW = { reasoning_effort: 'low' }

function slot(partial: RosterSlot): RosterSlot {
  return partial
}

export function resolveRoster(env: NodeJS.ProcessEnv = process.env): ResolvedRoster {
  const analysts: RosterSlot[] = [
    slot({
      role: 'dept_analyst',
      slot: 'natural-hydro',
      model: 'gemini-3.6-flash',
      provider: 'google',
      brand: 'Google',
      search: false,
      googleThinking: 'minimal',
      reasoning: true,
    }),
    slot({
      role: 'dept_analyst',
      slot: 'natural-geo',
      model: 'moonshotai/kimi-k2.6',
      provider: 'openrouter',
      brand: 'Moonshot AI',
      search: false,
      extraBody: REASONING_MINIMAL,
      reasoning: true,
    }),
    slot({
      role: 'dept_analyst',
      slot: 'health',
      model: 'claude-sonnet-5',
      provider: 'anthropic',
      brand: 'Anthropic',
      search: false,
      anthropicThinking: 'disabled',
    }),
    slot({
      role: 'dept_analyst',
      slot: 'conflict-political',
      model: 'grok-4.3',
      provider: 'xai',
      brand: 'xAI',
      search: false,
      extraBody: XAI_REASONING_LOW,
      reasoning: true,
    }),
    slot({
      role: 'dept_analyst',
      slot: 'infrastructure-economy',
      model: 'gpt-5.6-terra',
      provider: 'openai',
      brand: 'OpenAI',
      search: false,
      extraBody: { reasoning_effort: 'low' },
      reasoning: true,
    }),
  ]
  const queryWriter = slot({
    role: 'query_writer',
    slot: 'query_writer',
    model: 'gemini-3.5-flash-lite',
    provider: 'google',
    brand: 'Google',
    search: false,
    googleThinking: 'minimal',
    reasoning: true,
  })
  const search: RosterSlot[] = [
    slot({
      role: 'search',
      slot: 'grok-live',
      model: 'grok-4.6',
      provider: 'xai',
      brand: 'xAI',
      search: true,
      maxTurns: 1,
      extraBody: XAI_REASONING_LOW,
      reasoning: true,
    }),
    slot({
      role: 'search',
      slot: 'perplexity-sonar',
      model: 'sonar-reasoning-pro',
      provider: 'perplexity',
      brand: 'Perplexity',
      search: true,
      reasoning: true,
    }),
  ]
  const hunters: RosterSlot[] = [
    slot({
      role: 'hunter',
      slot: 'hunter-qwen',
      model: 'qwen/qwen3.5-plus-20260420',
      provider: 'openrouter',
      brand: 'Qwen',
      search: false,
      extraBody: REASONING_MINIMAL,
      reasoning: true,
    }),
    slot({
      role: 'hunter',
      slot: 'hunter-deepseek',
      model: 'deepseek/deepseek-v3.2',
      provider: 'openrouter',
      brand: 'DeepSeek',
      search: false,
      extraBody: REASONING_MINIMAL,
      reasoning: true,
    }),
    slot({
      role: 'hunter',
      slot: 'hunter-mistral',
      model: 'mistralai/mistral-medium-3-5',
      provider: 'openrouter',
      brand: 'Mistral',
      search: false,
    }),
    slot({
      role: 'hunter',
      slot: 'hunter-solar',
      model: 'solar-pro4',
      provider: 'upstage',
      brand: 'Upstage',
      search: false,
      extraBody: { reasoning_effort: 'none' },
      reasoning: true,
    }),
    slot({
      role: 'hunter',
      slot: 'hunter-nemotron',
      model: 'nvidia/nemotron-3-ultra-550b-a55b',
      provider: 'openrouter',
      brand: 'NVIDIA',
      search: false,
      extraBody: REASONING_MINIMAL,
      reasoning: true,
    }),
    slot({
      role: 'hunter',
      slot: 'hunter-glm',
      model: 'z-ai/glm-5.3',
      provider: 'openrouter',
      brand: 'Z.ai',
      search: false,
      extraBody: REASONING_MINIMAL,
      reasoning: true,
    }),
  ]
  const redTeam = slot({
    role: 'red_team',
    slot: 'red_team',
    model: 'cohere/command-a',
    provider: 'openrouter',
    brand: 'Cohere',
    search: false,
  })
  const judgeModel = env.CRISIS_ENGINE_JUDGE_MODEL?.trim() || 'claude-opus-5-5'
  const judge = slot({
    role: 'judge',
    slot: 'judge',
    model: judgeModel,
    provider: 'anthropic',
    brand: 'Anthropic',
    search: false,
    reasoning: true,
  })
  const slots = [...analysts, queryWriter, ...search, ...hunters, redTeam, judge]
  assertDistinctBrands(analysts, 'dept_analyst')
  assertDistinctBrands(hunters, 'hunter')
  return { slots, judgeModel }
}

function assertDistinctBrands(slots: RosterSlot[], label: string): void {
  const brands = slots.map((row) => row.brand)
  if (new Set(brands).size !== brands.length) {
    throw new Error(`${label} brands are not all different: ${brands.join(', ')}`)
  }
}

export function slotsFor(roster: ResolvedRoster, role: EngineRole): RosterSlot[] {
  return roster.slots.filter((row) => row.role === role)
}

/** Typical-token list-price estimate for one region. Not a live quote. */
export function estimateRegionRunUsd(roster: ResolvedRoster = resolveRoster()): number {
  const typicalIn: Record<EngineRole, number> = {
    dept_analyst: 900,
    query_writer: 600,
    search: 500,
    hunter: 1800,
    red_team: 2200,
    judge: 3500,
  }
  return roster.slots.reduce((sum, row) => {
    const cappedIn = Math.min(typicalIn[row.role], TOKEN_CAPS[row.role].in)
    const cappedOut = Math.min(TYPICAL_OUTPUT_TOKENS[row.role], TOKEN_CAPS[row.role].out)
    return sum + listPriceCost(row.model, cappedIn, cappedOut)
  }, 0)
}
