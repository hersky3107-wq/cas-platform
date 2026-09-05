/**
 * Single-call probe for a brand's provider-specific thinking/reasoning field.
 * Run BEFORE the sequential 20× onboarding gate for any new seat brand:
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs \
 *     scripts/oracle-brand-probe.mts --brand=ByteDance
 *
 * Prints finish reason, content/reasoning token split, cost, and the head of
 * the raw text. If reasoningTokens is non-null/non-zero here, the registry
 * entry needs an explicit reasoning control (effort minimal / disabled)
 * before the 20× pass — that is the field this probe exists to expose.
 */
process.env.ORACLE_AI_MODE = 'live'

const brandFlag = process.argv.find((a) => a.startsWith('--brand='))?.slice('--brand='.length)
if (!brandFlag) throw new Error('usage: --brand=<registry brand>')

const { readFileSync } = await import('node:fs')
const { join } = await import('node:path')
const { callLayer1Model } = await import('../lib/oracle/ai/call')
const { createLayer1HttpBudget } = await import('../lib/oracle/ai/http-budget')
const { parseVerdictJson } = await import('../lib/oracle/ai/parse-verdict')
const {
  buildVerdictSystemPrompt,
  buildVerdictUserPrompt,
  VERDICT_MAX_COMPLETION_TOKENS,
} = await import('../lib/oracle/ai/prompts/verdict')
const { layer1EntryForBrand } = await import('../lib/oracle/ai/registry')

const entryBase = layer1EntryForBrand(brandFlag)
if (!entryBase) throw new Error(`no registry entry for brand ${brandFlag}`)
const entry = {
  ...entryBase,
  maxCompletionTokens: Math.max(entryBase.maxCompletionTokens, VERDICT_MAX_COMPLETION_TOKENS),
}

const inputs = JSON.parse(
  readFileSync(join(process.cwd(), 'docs', 'oracle-synthesis-bakeoff-inputs.json'), 'utf8'),
)
const payload = {
  readingInput: 'axes',
  reader: { slug: 'contrarian', index: 5, of: 5 },
  consensus: inputs.integrated.consensus,
  readings: (inputs.integrated.readings as Array<Record<string, unknown>>).map((row) => ({
    system: row.system,
    status: 'done',
    summary: row.summary,
    narrative: row.narrative,
  })),
  context: { asOfDate: '2026-08-25', question: '올해 일의 방향을 어떻게 잡아야 하는가?' },
}

console.log(`probe: brand=${entry.brand} model=${entry.model} caller=${JSON.stringify(entry.caller)}`)
const raw = await callLayer1Model({
  entry,
  systemPrompt: buildVerdictSystemPrompt('ko', 'contrarian', 5),
  userPrompt: buildVerdictUserPrompt(payload, 'ko'),
  timeoutMs: 240_000,
  sessionId: `probe-${entry.brand}`,
  httpBudget: createLayer1HttpBudget(2),
})

console.log(
  JSON.stringify(
    {
      finishReason: raw.finishReason,
      tokensIn: raw.tokensIn,
      tokensOut: raw.tokensOut,
      contentTokens: raw.contentTokens,
      reasoningTokens: raw.reasoningTokens,
      costUsd: raw.costUsd,
      latencyMs: raw.latencyMs,
      emptyContent: raw.emptyContent,
      error: raw.error ?? null,
      diagnostics: raw.diagnostics,
      parsed: parseVerdictJson(raw.text ?? '', 5) != null,
    },
    null,
    2,
  ),
)
console.log('--- text head ---')
console.log((raw.text ?? '(null)').slice(0, 600))
