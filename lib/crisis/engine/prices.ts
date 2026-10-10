import type { EngineRole } from './schema'

/**
 * Dry-run list prices in USD per 1,000,000 tokens.
 * Taken from league-work lib/league/roster.ts (PRICE AUDIT 2026-09) and
 * lib/league/deep-report-ledger.ts for Claude Opus 5.5.
 * A live call stores the provider billed cost when one is returned.
 */
export const LIST_PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'claude-sonnet-5': { input: 2, output: 10 },
  'gemini-3.6-flash': { input: 1.5, output: 7.5 },
  'moonshotai/kimi-k2.6': { input: 0.6, output: 3 },
  'grok-4.3': { input: 1.25, output: 2.5 },
  'gpt-5.6-terra': { input: 2, output: 12 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'grok-4.6': { input: 2, output: 6 },
  'sonar-reasoning-pro': { input: 2, output: 8 },
  'qwen/qwen3.5-plus-20260420': { input: 0.4, output: 1.2 },
  'deepseek/deepseek-v3.2': { input: 0.27, output: 1.1 },
  'mistralai/mistral-medium-3-5': { input: 0.4, output: 2 },
  'solar-pro4': { input: 0.15, output: 0.6 },
  'nvidia/nemotron-3-ultra-550b-a55b': { input: 0.5, output: 2.2 },
  'z-ai/glm-5.3': { input: 0.378, output: 1.188 },
  'cohere/command-a': { input: 2.5, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
}

export const TYPICAL_OUTPUT_TOKENS: Record<EngineRole, number> = {
  dept_analyst: 400,
  query_writer: 180,
  search: 700,
  hunter: 900,
  red_team: 400,
  judge: 2500,
}

export const TOKEN_CAPS: Record<EngineRole, { in: number; out: number }> = {
  dept_analyst: { in: 4000, out: 1200 },
  query_writer: { in: 2000, out: 400 },
  search: { in: 2500, out: 1200 },
  hunter: { in: 9000, out: 3000 },
  red_team: { in: 6000, out: 1800 },
  judge: { in: 14000, out: 9000 },
}

/** Added on top of the role output cap for models that spend tokens on reasoning. */
export const REASONING_OVERHEAD = 2000

export function outputBudget(role: EngineRole, reasoning = false): number {
  return TOKEN_CAPS[role].out + (reasoning ? REASONING_OVERHEAD : 0)
}

export const ROLE_TIMEOUT_MS: Record<EngineRole, number> = {
  dept_analyst: 90_000,
  query_writer: 90_000,
  search: 90_000,
  hunter: 90_000,
  red_team: 120_000,
  judge: 240_000,
}

/** DeepSeek hunter slot only; other hunters use ROLE_TIMEOUT_MS.hunter. */
export const HUNTER_DEEPSEEK_TIMEOUT_MS = 120_000

export const DEFAULT_COST_CAP_USD = 1.5
/** One zone run (top 8 regions, same pipeline). */
export const ZONE_COST_CAP_USD = 1.2

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function listPriceCost(model: string, tokensIn: number, tokensOut: number): number {
  const price = LIST_PRICE_PER_MILLION[model]
  if (!price) throw new Error(`no list price for model ${model}`)
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000
}
