/**
 * One-off: does kimi-k2.6 ever return visible content on a league-sized prompt?
 * Tries max_tokens 8000 with a 240s budget (mirrors the production caller).
 *
 * Run: npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/probe-kimi-k26.ts
 */
import { callPlatformModel } from '../lib/ai/platform-providers'

async function main() {
  const started = Date.now()
  const res = await callPlatformModel({
    id: 'openrouter:kimi-k2.6',
    systemPrompt: 'You are an independent forecasting model. Output exactly one line of strict JSON: {"direction":"up|down|flat|abstain","probability":0-100,"rationale":"one line"}.',
    userPrompt:
      'Proposition: Will Apple (AAPL) close higher 24h from now than its last close?\nInstrument: AAPL\nCategory: stock\n' +
      'DATA PACKET: AAPL last close 305.93, 5-day change +1.2%, 20-day change -2.1%.\n' +
      'RESEARCH PACKET: 1) Apple stock AAPL closing price August 14 2026 — closed at 305.93, down 0.4% on the day...\n'.repeat(4),
    maxCompletionTokens: 8000,
  })
  console.log(`HTTP-level ok=${!res.error} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  console.log('text:', res.text ? res.text.slice(0, 300) : null)
  console.log('usage:', res.usage, 'cost:', res.costUsd)
  if (res.error) console.log('error:', res.error.slice(0, 300))
}

main()
