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
import { parseSynthesisJson } from './parse-synthesis'
import { buildLayer1SystemPrompt, buildLayer1UserPrompt } from './prompts/layer1'
import { buildSynthesisSystemPrompt, buildSynthesisUserPrompt } from './prompts/synthesis'
import { layer1Entry, layer1EntryForBrand, type Layer1RegistryEntry } from './registry'

export type Layer1AdapterOptions = {
  call?: Layer1Call
  layer2?: OracleAiAdapter
}

/** Per-unit HTTP ceiling shared with the platform empty-content retry. */
export const LAYER1_HTTP_BUDGET = 2
/** Do not open a fresh call when less than this remains on the unit deadline. */
export const LAYER1_RETRY_MIN_REMAINING_MS = 25_000
/**
 * Synthesis contract is longer than a single reading (up to 6 agreements /
 * divergences <=160 chars each + conclusion <=700 + confidence_note <=220
 * => ~1880 chars worst case). Floor the guard here, same pattern as
 * SYNTHESIS_MAX_COMPLETION_TOKENS below — never derived from any reader's
 * maxCompletionTokens.
 */
export const LAYER1_SYNTHESIS_RUNAWAY_CONTENT_TOKENS = 3000

/**
 * Visible-content runaway threshold. Reads the registry entry's own
 * `runawayContentTokens` — deliberately NOT a function of maxCompletionTokens
 * (see the comment on that field in registry.ts). Synthesis floors it to its
 * own longer-contract value regardless of which brand's seat is synthesizing.
 */
export function layer1RunawayContentThreshold(
  entry: Pick<Layer1RegistryEntry, 'runawayContentTokens'>,
  kind: 'reading' | 'synthesis',
): number {
  return kind === 'synthesis'
    ? Math.max(entry.runawayContentTokens, LAYER1_SYNTHESIS_RUNAWAY_CONTENT_TOKENS)
    : entry.runawayContentTokens
}
export const LAYER1_STRICT_RETRY_INSTRUCTION =
  '\n\nSTRICT RETRY: Output ONLY the JSON object. No preamble, analysis, working, explanation outside fields, or text after the closing brace. narrative must be ≤500 Unicode characters (prism target 280–420). Respect every field character limit.'

export const SYNTHESIS_STRICT_RETRY_INSTRUCTION =
  '\n\nSTRICT RETRY: Output ONLY the JSON object. No preamble or text after the closing brace. Hard budgets: ≤6 agreements/divergences; each agreement/divergence ≤160 characters; conclusion ≤700 characters; confidence_note ≤220 characters or null.'

/** Synthesis JSON is longer than a single reading; never inherit prism's 700 ceiling. */
export const SYNTHESIS_MAX_COMPLETION_TOKENS = 1200

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
      if (request.kind === 'verdict') return layer2.run(request, opts)

      const entry =
        request.brand != null
          ? layer1EntryForBrand(request.brand)
          : request.kind === 'reading'
            ? layer1Entry(request.unit)
            : null
      if (!entry) {
        return failure(
          request.brand ?? 'unknown',
          'unknown',
          'error',
          `no live registry entry for ${request.kind}:${request.unit}:${request.brand ?? 'unassigned'}`,
          0,
        )
      }

      const effectiveEntry =
        request.kind === 'synthesis'
          ? {
              ...entry,
              maxCompletionTokens: Math.max(entry.maxCompletionTokens, SYNTHESIS_MAX_COMPLETION_TOKENS),
            }
          : entry

      const systemPrompt =
        request.kind === 'synthesis'
          ? buildSynthesisSystemPrompt(request.locale)
          : buildLayer1SystemPrompt(request.locale, request.unit)
      const userPrompt =
        request.kind === 'synthesis'
          ? buildSynthesisUserPrompt(request.payload)
          : buildLayer1UserPrompt(request.payload, request.locale, request.unit)
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
              entry: effectiveEntry,
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
              effectiveEntry.brand,
              effectiveEntry.model,
              'error',
              `insufficient time for retry (${remainingMs}ms < ${LAYER1_RETRY_MIN_REMAINING_MS}ms)`,
              latencyMs,
            )
          }
          if (httpBudget.remaining < 1) break
        }

        const raw = await call({
          entry: effectiveEntry,
          systemPrompt,
          userPrompt: strictRetryNext
            ? `${userPrompt}${
                request.kind === 'synthesis'
                  ? SYNTHESIS_STRICT_RETRY_INSTRUCTION
                  : LAYER1_STRICT_RETRY_INSTRUCTION
              }`
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

        const runawayThreshold = layer1RunawayContentThreshold(
          effectiveEntry,
          request.kind === 'synthesis' ? 'synthesis' : 'reading',
        )
        if ((raw.contentTokens ?? 0) > runawayThreshold) {
          lastError =
            `runaway visible content (${raw.contentTokens} > ${runawayThreshold} tokens)`
          console.warn(`[oracle] ${effectiveEntry.system} ${lastError}`)
          if (!strictRetryNext) {
            strictRetryNext = true
            continue
          }
          break
        }

        const layer1Parsed = request.kind === 'reading' ? parseLayer1Json(raw.text ?? '') : null
        const synthesisParsed = request.kind === 'synthesis' ? parseSynthesisJson(raw.text ?? '') : null
        if (layer1Parsed || synthesisParsed) {
          const latencyMs = Date.now() - startedAt
          await finalizeUnitCost({
            sessionId: request.sessionId,
            entry: effectiveEntry,
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
            brand: effectiveEntry.brand,
            model: effectiveEntry.model,
            text: layer1Parsed?.narrative ?? synthesisParsed!.conclusion,
            summary: layer1Parsed
              ? {
                  one_line: layer1Parsed.one_line,
                  direction: layer1Parsed.direction,
                  focus: layer1Parsed.focus,
                  axis_emphasis: layer1Parsed.axis_emphasis,
                  parsed: true,
                  finish_reason: raw.finishReason,
                  content_tokens: raw.contentTokens,
                }
              : {
                  ...synthesisParsed!,
                  parsed: true,
                  finish_reason: raw.finishReason,
                  content_tokens: raw.contentTokens,
                },
            latencyMs,
            tokensIn: raw.tokensIn,
            tokensOut: raw.tokensOut,
          }
        }

        lastError = `${request.kind} JSON parse failed`
      }

      const latencyMs = Date.now() - startedAt
      await finalizeUnitCost({
        sessionId: request.sessionId,
        entry: effectiveEntry,
        lastRaw,
        httpBudget,
        cumulativeMs: latencyMs,
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        providerCostUsd: allAttemptsPriced ? totalReportedCostUsd : null,
        costIsEstimated: anyEstimatedCost,
        errorText: lastError,
      })
      return failure(effectiveEntry.brand, effectiveEntry.model, 'error', lastError, latencyMs)
    },
  }
}
