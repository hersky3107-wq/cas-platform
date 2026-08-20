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
import { isEmptyModelText, parseLayer1Json } from './parse-layer1'
import { buildLayer1SystemPrompt, buildLayer1UserPrompt } from './prompts/layer1'
import { layer1Entry } from './registry'

export type Layer1AdapterOptions = {
  call?: Layer1Call
  layer2?: OracleAiAdapter
}

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

      // TRAP (f): HTTP 200 but content empty — retry once (trim-aware), then
      // 결번. The same single retry covers a JSON parse failure. The session
      // continues either way; we never throw out of this adapter.
      let lastError = 'empty content'
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const raw = await call({
          entry,
          systemPrompt,
          userPrompt,
          timeoutMs: opts.timeoutMs,
          sessionId: request.sessionId,
        })

        if (raw.error && isEmptyModelText(raw.text) && !raw.emptyContent) {
          lastError = raw.error
          break
        }

        if (raw.emptyContent || isEmptyModelText(raw.text)) {
          lastError = raw.error ?? 'empty content'
          continue
        }

        const parsed = parseLayer1Json(raw.text ?? '')
        if (parsed) {
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
            latencyMs: Date.now() - startedAt,
            tokensIn: raw.tokensIn,
            tokensOut: raw.tokensOut,
          }
        }

        lastError = 'layer-1 JSON parse failed'
      }

      return failure(entry.brand, entry.model, 'error', lastError, Date.now() - startedAt)
    },
  }
}
