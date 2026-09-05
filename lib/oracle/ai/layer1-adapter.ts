/**
 * Live layer-1 + layer-2 adapter. Implements OracleAiAdapter so swapping the
 * stub is a one-line change at the route. Readings, synthesis, and seer
 * verdicts all run through the same call/retry/cost loop — what differs per
 * kind is the prompt pair, the parser, and the completion ceiling.
 *
 * Network clients are constructed only when `call` is omitted; tests inject
 * a fake so this file stays offline.
 */
import type { JsonObject, OracleAiAdapter, OracleAiFailure, OracleAiRequest, OracleAiResult } from '../runner/types'
import type { Layer1Call, Layer1CallResult } from './call'
import { createLayer1HttpBudget, type Layer1HttpBudget } from './http-budget'
import {
  isEmptyModelText,
  LAYER1_NARRATIVE_MAX,
  LAYER1_NARRATIVE_MIN,
  LAYER1_NARRATIVE_TARGET,
  parseLayer1Json,
} from './parse-layer1'
import { parseSynthesisJson, SYNTHESIS_CONCLUSION_MAX } from './parse-synthesis'
import { parseVerdictJson, verdictDirectionMismatch, type VerdictJson } from './parse-verdict'
import { buildLayer1SystemPrompt, buildLayer1UserPrompt } from './prompts/layer1'
import { buildSynthesisSystemPrompt, buildSynthesisUserPrompt } from './prompts/synthesis'
import {
  buildVerdictSystemPrompt,
  buildVerdictUserPrompt,
  VERDICT_DIRECTION_RETRY_INSTRUCTION,
  VERDICT_MAX_COMPLETION_TOKENS,
  VERDICT_STRICT_RETRY_INSTRUCTION,
} from './prompts/verdict'
import { layer1Entry, layer1EntryForBrand, type Layer1RegistryEntry } from './registry'

export type Layer1AdapterOptions = {
  call?: Layer1Call
}

/** Per-unit HTTP ceiling shared with the platform empty-content retry. */
export const LAYER1_HTTP_BUDGET = 2
/** Do not open a fresh call when less than this remains on the unit deadline. */
export const LAYER1_RETRY_MIN_REMAINING_MS = 25_000
/**
 * Synthesis contract worst case (FIX 3 budgets): up to 6 agreements /
 * divergences <=160 chars each + conclusion <=900 + confidence_note <=220
 * => ~3040 chars ≈ ~2400 tokens CJK. Floor the guard here with headroom,
 * same pattern as SYNTHESIS_MAX_COMPLETION_TOKENS below — never derived
 * from any reader's maxCompletionTokens.
 */
export const LAYER1_SYNTHESIS_RUNAWAY_CONTENT_TOKENS = 3600

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
  `\n\nSTRICT RETRY: Output ONLY the JSON object. No preamble, analysis, working, explanation outside fields, or text after the closing brace. narrative must be ${LAYER1_NARRATIVE_MIN}–${LAYER1_NARRATIVE_MAX} Unicode characters (aim ${LAYER1_NARRATIVE_TARGET}) — plain language, no raw numeric scores. Respect every field character limit.`

export const SYNTHESIS_STRICT_RETRY_INSTRUCTION =
  `\n\nSTRICT RETRY: Output ONLY the JSON object. No preamble or text after the closing brace. Hard budgets: ≤6 agreements/divergences; each agreement/divergence ≤160 characters; conclusion 600–${SYNTHESIS_CONCLUSION_MAX} characters; confidence_note ≤220 characters or null.`

/**
 * Synthesis JSON is longer than a single reading; never inherit a reader's
 * ceiling. Sized for the FIX 3 contract (~3040 chars ≈ ~2400 tokens CJK).
 */
export const SYNTHESIS_MAX_COMPLETION_TOKENS = 2600

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

/** Panel size travels inside the verdict payload (reader.of). */
function verdictReaderCount(payload: JsonObject): number {
  const reader = payload.reader
  if (reader && typeof reader === 'object' && !Array.isArray(reader)) {
    const of = (reader as JsonObject).of
    if (typeof of === 'number' && Number.isFinite(of) && of > 0) return of
  }
  // Tightest line budget — a malformed payload must not loosen the contract.
  return 9
}

export function createLayer1AiAdapter(options: Layer1AdapterOptions = {}): OracleAiAdapter {
  const call = options.call ?? defaultCall

  return {
    async run(request: OracleAiRequest, opts: { timeoutMs: number }): Promise<OracleAiResult> {
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
          : request.kind === 'verdict'
            ? {
                ...entry,
                maxCompletionTokens: Math.max(entry.maxCompletionTokens, VERDICT_MAX_COMPLETION_TOKENS),
              }
            : entry

      const readerCount = verdictReaderCount(request.payload)
      const systemPrompt =
        request.kind === 'synthesis'
          ? buildSynthesisSystemPrompt(request.locale)
          : request.kind === 'verdict'
            ? buildVerdictSystemPrompt(request.locale, request.unit, readerCount)
            : buildLayer1SystemPrompt(request.locale, request.unit)
      const userPrompt =
        request.kind === 'synthesis'
          ? buildSynthesisUserPrompt(request.payload)
          : request.kind === 'verdict'
            ? buildVerdictUserPrompt(request.payload, request.locale)
            : buildLayer1UserPrompt(request.payload, request.locale, request.unit)
      const startedAt = Date.now()
      const deadlineAt = startedAt + opts.timeoutMs
      const httpBudget = createLayer1HttpBudget(LAYER1_HTTP_BUDGET)

      let lastError = 'empty content'
      let lastRaw: Layer1CallResult | null = null
      let strictRetryNext = false
      /** FIX 4: one direction-consistency retry, then accept + log. */
      let directionRetryUsed = false
      let directionRetryNext = false
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
          userPrompt:
            strictRetryNext || directionRetryNext
              ? `${userPrompt}${
                  directionRetryNext
                    ? VERDICT_DIRECTION_RETRY_INSTRUCTION
                    : request.kind === 'synthesis'
                      ? SYNTHESIS_STRICT_RETRY_INSTRUCTION
                      : request.kind === 'verdict'
                        ? VERDICT_STRICT_RETRY_INSTRUCTION
                        : LAYER1_STRICT_RETRY_INSTRUCTION
                }`
              : userPrompt,
          timeoutMs: Math.max(1, deadlineAt - Date.now()),
          sessionId: request.sessionId,
          httpBudget,
          strictRetry: strictRetryNext || directionRetryNext,
        })
        directionRetryNext = false
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
        const verdictParsed: VerdictJson | null =
          request.kind === 'verdict' ? parseVerdictJson(raw.text ?? '', readerCount) : null

        // FIX 4: the vote must not contradict its own text. On an obvious
        // keyword-level disagreement, retry ONCE with the direction-criteria
        // instruction; if it persists, accept the ballot but log and mark it —
        // an honest mismatch beats a silently relabelled vote.
        let directionMismatch = false
        if (verdictParsed) {
          const check = verdictDirectionMismatch(verdictParsed)
          if (check.mismatch && !directionRetryUsed) {
            directionRetryUsed = true
            directionRetryNext = true
            lastError = `verdict direction/text mismatch (voted ${verdictParsed.direction}, text reads ${check.textDirection ?? 'unclear'})`
            console.warn(`[oracle] ${request.unit} ${lastError} — retrying once`)
            continue
          }
          if (check.mismatch) {
            directionMismatch = true
            console.warn(
              `[oracle] ${request.unit} verdict direction/text mismatch persisted after retry (voted ${verdictParsed.direction}, text reads ${check.textDirection ?? 'unclear'}) — accepting and logging`,
            )
          }
        }

        if (layer1Parsed || synthesisParsed || verdictParsed) {
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
            text: layer1Parsed?.narrative ?? verdictParsed?.verdict_line ?? synthesisParsed!.conclusion,
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
              : verdictParsed
                ? {
                    // advance.ts reads summary.ballot / summary.dissent when
                    // writing oracle_verdicts; the tally in runner/ballot.ts
                    // reads ballot.direction / focus / domains.
                    ballot: {
                      direction: verdictParsed.direction,
                      focus: verdictParsed.focus,
                      domains: verdictParsed.domains,
                    },
                    dissent: verdictParsed.minority_opinion,
                    // FIX 4: persisted direction/text disagreement, kept honest.
                    ...(directionMismatch ? { direction_text_mismatch: true } : {}),
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
        // The one retry after a parse reject carries the strict instruction —
        // same behavior the onboarding gate and bakeoff scripts reproduce.
        strictRetryNext = true
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
