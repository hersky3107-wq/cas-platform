/**
 * Live layer-1 adapter. Implements OracleAiAdapter so swapping the stub is
 * a one-line change at the route. Verdicts (layer 2) are never sent here —
 * the factory keeps those on the stub.
 *
 * Network clients are constructed only when `call` is omitted; tests inject
 * a fake so this file stays offline.
 */
import { createStubAiAdapter } from '../runner/ai-stub'
import type { OracleAiAdapter, OracleAiFailure, OracleAiRequest, OracleAiResult } from '../runner/types'
import type { Layer1Call, Layer1CallResult } from './call'
import { createLayer1HttpBudget, type Layer1HttpBudget } from './http-budget'
import { isEmptyModelText, parseLayer1Json } from './parse-layer1'
import { buildLayer1SystemPrompt, buildLayer1UserPrompt } from './prompts/layer1'
import { layer1Entry } from './registry'

export type Layer1AdapterOptions = {
  call?: Layer1Call
  layer2?: OracleAiAdapter
}

/** Per-unit HTTP ceiling shared with the platform empty-content retry. */
export const LAYER1_HTTP_BUDGET = 2
/** Do not open a fresh call when less than this remains on the unit deadline. */
export const LAYER1_RETRY_MIN_REMAINING_MS = 25_000
export const LAYER1_RUNAWAY_MULTIPLIER = 1.5
export const LAYER1_STRICT_RETRY_INSTRUCTION =
  '\n\nSTRICT RETRY: Output ONLY the JSON object. No preamble, analysis, working, explanation outside fields, or text after the closing brace. Respect every field character limit.'

async function defaultCall(input: Parameters<Layer1Call>[0]): Promise<Layer1CallResult> {
  const { callLayer1Model } = await import('./call')
  return callLayer1Model(input)
}

function failure(
  brand: string,
  model: string,
  status: OracleAiFailure['status'],
  message: string,
  latencyMs: number,
): OracleAiFailure {
  return { ok: false, brand, model, status, message, latencyMs }
}

async function finalizeUnitCost(opts: {
  sessionId: string
  entry: NonNullable<ReturnType<typeof layer1Entry>>
  lastRaw: Layer1CallResult | null
  httpBudget: Layer1HttpBudget
  cumulativeMs: number
  promptTokens: number
  completionTokens: number
  providerCostUsd: number | null
  costIsEstimated: boolean
  errorText?: string
}): Promise<void> {
  try {
    const { logLayer1UnitCost } = await import('./cost-log')
    await logLayer1UnitCost({
      sessionId: opts.sessionId,
      entry: opts.entry,
      promptTokens: opts.promptTokens,
      completionTokens: opts.completionTokens,
      providerCostUsd: opts.providerCostUsd,
      costIsEstimated: opts.costIsEstimated,
      cumulativeMs: opts.cumulativeMs,
      httpBudget: opts.httpBudget,
      errorText: opts.errorText ?? opts.lastRaw?.error ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn('[oracle] layer1 unit cost finalize skipped:', message)
  }
}

export function createLayer1AiAdapter(options: Layer1AdapterOptions = {}): OracleAiAdapter {
  const call = options.call ?? defaultCall
  const layer2 = options.layer2 ?? createStubAiAdapter()

  return {
    async run(request: OracleAiRequest, opts: { timeoutMs: number }): Promise<OracleAiResult> {
      if (request.kind !== 'reading') return layer2.run(request, opts)

      const entry = layer1Entry(request.unit)
      if (!entry) {
        return failure('unknown', 'unknown', 'error', `no layer-1 registry entry for ${request.unit}`, 0)
      }

      const systemPrompt = buildLayer1SystemPrompt(request.locale)
      const userPrompt = buildLayer1UserPrompt(request.payload, request.locale)
      const startedAt = Date.now()
      const deadlineAt = startedAt + opts.timeoutMs
      const httpBudget = createLayer1HttpBudget(LAYER1_HTTP_BUDGET)

      let lastError = 'empty content'
      let lastRaw: Layer1CallResult | null = null
      let strictRetryNext = false
      let totalPromptTokens = 0
      let totalCompletionTokens = 0
      let totalReportedCostUsd = 0
      let allAttemptsPriced = true
      let anyEstimatedCost = false
      for (let attempt = 0; attempt < LAYER1_HTTP_BUDGET; attempt += 1) {
        if (attempt > 0) {
          const remainingMs = deadlineAt - Date.now()
          if (remainingMs < LAYER1_RETRY_MIN_REMAINING_MS) {
            const latencyMs = Date.now() - startedAt
            await finalizeUnitCost({
              sessionId: request.sessionId,
              entry,
              lastRaw,
              httpBudget,
              cumulativeMs: latencyMs,
              promptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              providerCostUsd: allAttemptsPriced ? totalReportedCostUsd : null,
              costIsEstimated: anyEstimatedCost,
              errorText: `insufficient time for retry (${remainingMs}ms < ${LAYER1_RETRY_MIN_REMAINING_MS}ms)`,
            })
            return failure(
              entry.brand,
              entry.model,
              'error',
              `insufficient time for retry (${remainingMs}ms < ${LAYER1_RETRY_MIN_REMAINING_MS}ms)`,
              latencyMs,
            )
          }
          if (httpBudget.remaining < 1) break
        }

        const raw = await call({
          entry,
          systemPrompt,
          userPrompt: strictRetryNext
            ? `${userPrompt}${LAYER1_STRICT_RETRY_INSTRUCTION}`
            : userPrompt,
          timeoutMs: Math.max(1, deadlineAt - Date.now()),
          sessionId: request.sessionId,
          httpBudget,
          strictRetry: strictRetryNext,
        })
        lastRaw = raw
        totalPromptTokens += raw.tokensIn
        totalCompletionTokens += raw.tokensOut
        if (raw.costUsd == null) {
          allAttemptsPriced = false
        } else {
          totalReportedCostUsd += raw.costUsd
          anyEstimatedCost ||= raw.costIsEstimated
        }

        if (raw.error && isEmptyModelText(raw.text) && !raw.emptyContent) {
          lastError = raw.error
          break
        }

        if (raw.emptyContent || isEmptyModelText(raw.text)) {
          lastError = raw.error ?? 'empty content'
          continue
        }

        const runawayThreshold = entry.maxCompletionTokens * LAYER1_RUNAWAY_MULTIPLIER
        if ((raw.contentTokens ?? 0) > runawayThreshold) {
          lastError =
            `runaway visible content (${raw.contentTokens} > ${runawayThreshold} tokens)`
          console.warn(`[oracle] ${entry.system} ${lastError}`)
          if (!strictRetryNext) {
            strictRetryNext = true
            continue
          }
          break
        }

        const parsed = parseLayer1Json(raw.text ?? '')
        if (parsed) {
          const latencyMs = Date.now() - startedAt
          await finalizeUnitCost({
            sessionId: request.sessionId,
            entry,
            lastRaw: raw,
            httpBudget,
            cumulativeMs: latencyMs,
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            providerCostUsd: allAttemptsPriced ? totalReportedCostUsd : null,
            costIsEstimated: anyEstimatedCost,
          })
          return {
            ok: true,
            brand: entry.brand,
            model: entry.model,
            text: parsed.narrative,
            summary: {
              one_line: parsed.one_line,
              direction: parsed.direction,
              focus: parsed.focus,
              axis_emphasis: parsed.axis_emphasis,
            },
            latencyMs,
            tokensIn: raw.tokensIn,
            tokensOut: raw.tokensOut,
          }
        }

        lastError = 'layer-1 JSON parse failed'
      }

      const latencyMs = Date.now() - startedAt
      await finalizeUnitCost({
        sessionId: request.sessionId,
        entry,
        lastRaw,
        httpBudget,
        cumulativeMs: latencyMs,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        providerCostUsd: allAttemptsPriced ? totalReportedCostUsd : null,
        costIsEstimated: anyEstimatedCost,
        errorText: lastError,
      })
      return failure(entry.brand, entry.model, 'error', lastError, latencyMs)
    },
  }
}
