import type { EngineRole } from './schema'

/**
 * Dry-run list prices in USD per 1,000,000 tokens.
 * These are budgeting estimates. A live call stores the provider billed cost when one is returned.
 */
export const LIST_PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'openrouter:qwen3.5-flash': { input: 0.1, output: 0.4 },
  'openrouter:deepseek-v4-flash': { input: 0.14, output: 0.28 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'openrouter:nova-2-lite': { input: 0.06, output: 0.24 },
  'openrouter:phi-4': { input: 0.07, output: 0.14 },
  'gemini-3.5-flash': { input: 0.15, output: 0.6 },
  'grok-3': { input: 3, output: 15 },
  sonar: { input: 1, output: 1 },
  'gpt-4o': { input: 2.5, output: 10 },
  'openrouter:qwen3.5-plus': { input: 0.4, output: 1.2 },
  'openrouter:mistral-medium-3.5': { input: 0.4, output: 2 },
  'upstage:solar-pro3': { input: 0.15, output: 0.6 },
  'openrouter:nemotron-3-ultra-550b': { input: 0.9, output: 2.7 },
  'openrouter:deepseek-v3.2': { input: 0.27, output: 1.1 },
  'openrouter:command-a': { input: 2.5, output: 10 },
  'claude-opus-4-7': { input: 15, output: 75 },
}

/** Completion size used when estimating a call that has not run. */
export const TYPICAL_OUTPUT_TOKENS: Record<EngineRole, number> = {
  dept_analyst: 400,
  query_writer: 180,
  search: 700,
  hunter: 700,
  red_team: 400,
  judge: 1100,
}

export const TOKEN_CAPS: Record<EngineRole, { in: number; out: number }> = {
  dept_analyst: { in: 4000, out: 800 },
  query_writer: { in: 2000, out: 400 },
  search: { in: 2500, out: 1200 },
  hunter: { in: 6000, out: 1500 },
  red_team: { in: 6000, out: 1000 },
  judge: { in: 8000, out: 2500 },
}

export const ROLE_TIMEOUT_MS: Record<EngineRole, number> = {
  dept_analyst: 45_000,
  query_writer: 30_000,
  search: 60_000,
  hunter: 60_000,
  red_team: 45_000,
  judge: 90_000,
}

export const DEFAULT_COST_CAP_USD = 1.5

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4))
}

export function listPriceCost(model: string, tokensIn: number, tokensOut: number): number {
  const price = LIST_PRICE_PER_MILLION[model]
  if (!price) throw new Error(`no list price for model ${model}`)
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000
}
