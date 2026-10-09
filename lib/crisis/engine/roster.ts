import { MODEL_BY_PROVIDER } from '@/lib/ai/router'
import { JUDGE_MODEL_ID } from '@/lib/ai/suit-engine'
import { getPlatformModelEntry } from '@/lib/ai/platform-providers'
import { listPriceCost, TOKEN_CAPS, TYPICAL_OUTPUT_TOKENS } from './prices'
import type { Department, EngineRole } from './schema'

export interface RosterSlot {
  role: EngineRole
  slot: string
  model: string
  provider: string
  brand: string
  route: 'platform' | 'router'
  search: boolean
}

export interface ResolvedRoster {
  slots: RosterSlot[]
  judgeModel: string
}

const ANALYST_PLATFORM: Record<Exclude<Department, 'health'>, string> = {
  'natural-hydro': 'openrouter:qwen3.5-flash',
  'natural-geo': 'openrouter:deepseek-v4-flash',
  'conflict-political': 'openrouter:nova-2-lite',
  'infrastructure-economy': 'openrouter:phi-4',
}

const HUNTER_PLATFORM: Array<{ slot: string; id: string }> = [
  { slot: 'hunter-cn', id: 'openrouter:qwen3.5-plus' },
  { slot: 'hunter-eu', id: 'openrouter:mistral-medium-3.5' },
  { slot: 'hunter-kr', id: 'upstage:solar-pro3' },
  { slot: 'hunter-us-nvidia', id: 'openrouter:nemotron-3-ultra-550b' },
  { slot: 'hunter-cn-deepseek', id: 'openrouter:deepseek-v3.2' },
]

function platformSlot(role: EngineRole, slot: string, id: string, search = false): RosterSlot {
  const entry = getPlatformModelEntry(id)
  if (!entry) throw new Error(`platform registry has no model ${id}`)
  return {
    role,
    slot,
    model: entry.id,
    provider: entry.provider,
    brand: entry.brand,
    route: 'platform',
    search,
  }
}

function routerSlot(
  role: EngineRole,
  slot: string,
  provider: keyof typeof MODEL_BY_PROVIDER,
  brand: string,
  model = MODEL_BY_PROVIDER[provider],
  search = false,
): RosterSlot {
  if (!model) throw new Error(`provider registry has no model for ${provider}`)
  return { role, slot, model, provider, brand, route: 'router', search }
}

/**
 * Model ids are looked up in the AIMANI registries.
 * The registry has no Sonnet 5 id. The health analyst uses the registered Anthropic model.
 * The judge defaults to the suit-engine judge id and can be overridden with CRISIS_ENGINE_JUDGE_MODEL.
 */
export function resolveRoster(env: NodeJS.ProcessEnv = process.env): ResolvedRoster {
  const analysts: RosterSlot[] = [
    platformSlot('dept_analyst', 'natural-hydro', ANALYST_PLATFORM['natural-hydro']),
    platformSlot('dept_analyst', 'natural-geo', ANALYST_PLATFORM['natural-geo']),
    routerSlot('dept_analyst', 'health', 'anthropic', 'Anthropic'),
    platformSlot('dept_analyst', 'conflict-political', ANALYST_PLATFORM['conflict-political']),
    platformSlot('dept_analyst', 'infrastructure-economy', ANALYST_PLATFORM['infrastructure-economy']),
  ]
  const queryWriter = routerSlot('query_writer', 'query_writer', 'google', 'Google')
  const search = [
    routerSlot('search', 'grok-live', 'xai', 'xAI', MODEL_BY_PROVIDER.xai, true),
    routerSlot('search', 'perplexity-sonar', 'perplexity', 'Perplexity', MODEL_BY_PROVIDER.perplexity, true),
  ]
  const hunters: RosterSlot[] = [
    routerSlot('hunter', 'hunter-us', 'openai', 'OpenAI'),
    ...HUNTER_PLATFORM.map((hunter) => platformSlot('hunter', hunter.slot, hunter.id)),
  ]
  const redTeam = platformSlot('red_team', 'red_team', 'openrouter:command-a')
  const judgeOverride = env.CRISIS_ENGINE_JUDGE_MODEL?.trim()
  const judgeModel = judgeOverride || JUDGE_MODEL_ID
  const judge = routerSlot('judge', 'judge', 'anthropic', 'Anthropic', judgeModel)
  const slots = [...analysts, queryWriter, ...search, ...hunters, redTeam, judge]
  assertDistinctBrands(analysts, 'dept_analyst')
  assertDistinctBrands(hunters, 'hunter')
  return { slots, judgeModel }
}

function assertDistinctBrands(slots: RosterSlot[], label: string): void {
  const brands = slots.map((slot) => slot.brand)
  if (new Set(brands).size !== brands.length) {
    throw new Error(`${label} brands are not all different: ${brands.join(', ')}`)
  }
}

export function slotsFor(roster: ResolvedRoster, role: EngineRole): RosterSlot[] {
  return roster.slots.filter((slot) => slot.role === role)
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
  return roster.slots.reduce((sum, slot) => {
    const cappedIn = Math.min(typicalIn[slot.role], TOKEN_CAPS[slot.role].in)
    const cappedOut = Math.min(TYPICAL_OUTPUT_TOKENS[slot.role], TOKEN_CAPS[slot.role].out)
    return sum + listPriceCost(slot.model, cappedIn, cappedOut)
  }, 0)
}
