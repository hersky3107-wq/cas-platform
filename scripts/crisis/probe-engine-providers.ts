/**
 * Engine provider diagnostics. Small live calls only.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/probe-engine-providers.ts --only=anthropic
 *   npx tsx --env-file=.env.local scripts/crisis/probe-engine-providers.ts --only=openrouter
 */
import { extractJson } from '../../lib/crisis/engine/parse'
import { hunterSystem, hunterUser } from '../../lib/crisis/engine/prompts'
import { callEngineProvider } from '../../lib/crisis/engine/providers'
import { resolveRoster } from '../../lib/crisis/engine/roster'
import type { EngineCard } from '../../lib/crisis/engine/schema'

const only = process.argv.find((item) => item.startsWith('--only='))?.slice(7)

const CARD: EngineCard = {
  region_id: 0,
  name: 'Badulla',
  country: 'Sri Lanka',
  iso3: 'LKA',
  lat: 6.99,
  lon: 81.06,
  level: 1,
  horizon: '30d',
  components: [{ key: 'rain', value: 0.8, raw: { sum_mm: 210 } }],
  fragility: [{ kind: 'dam', name: 'Ulhitiya Dam' }],
  cascades: [{ id: 'c1', trigger: 'dam_failure', effect: 'flood' }],
  context: ['wiki: Uma Oya tunnel'],
  urban: [{ name: 'Badulla', pop: 47000 }],
}

async function anthropic(): Promise<void> {
  for (const model of ['claude-sonnet-5', 'claude-opus-5-5']) {
    const started = Date.now()
    try {
      const result = await callEngineProvider({
        model,
        provider: 'anthropic',
        system: 'Return JSON only.',
        user: 'Return {"ok":true,"word":"OK"}',
        maxTokens: 60,
        timeoutMs: 60_000,
        jsonMode: true,
      })
      let parsed = 'no'
      try {
        parsed = JSON.stringify(extractJson(result.text))
      } catch {
        parsed = 'parse failed'
      }
      console.log(`anthropic model=${model} status=${result.httpStatus} ms=${Date.now() - started} finish=${result.finishReason} json=${parsed} text_head=${JSON.stringify(result.text.slice(0, 80))}`)
    } catch (error) {
      console.log(`anthropic model=${model} FAIL ms=${Date.now() - started} ${error instanceof Error ? error.message.slice(0, 300) : error}`)
    }
  }
}

async function openrouter(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) throw new Error('OPENROUTER_API_KEY missing')
  const slotFilter = process.argv.find((item) => item.startsWith('--slot='))?.slice(7)
  const reasoningOff = process.argv.includes('--reasoning-off')
  const jsonOnly = process.argv.includes('--json-only')
  const slots = resolveRoster().slots.filter((slot) =>
    slotFilter ? slot.slot === slotFilter : slot.slot === 'hunter-qwen' || slot.slot === 'hunter-deepseek',
  )
  const user = hunterUser(CARD, ['natural-hydro: rain near 200 mm in 7 days'], [], { obvious: ['rain → landslide'], alreadyReported: [] })
  for (const slot of slots) {
    for (const jsonMode of jsonOnly ? [true] : [true, false]) {
      const body: Record<string, unknown> = {
        model: slot.model,
        messages: [
          { role: 'system', content: hunterSystem() },
          { role: 'user', content: user },
        ],
        max_tokens: 3000 + 2000,
        usage: { include: true },
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        ...slot.extraBody,
        ...(reasoningOff ? { reasoning: { enabled: false } } : {}),
      }
      const started = Date.now()
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        })
        const headersMs = Date.now() - started
        const raw = await res.text()
        const bodyMs = Date.now() - started
        const trimmed = raw.trim()
        let content = ''
        let finish = ''
        let provider = ''
        let reasoningLen = 0
        let usage = ''
        try {
          const json = JSON.parse(trimmed) as Record<string, any>
          content = String(json.choices?.[0]?.message?.content ?? '')
          finish = String(json.choices?.[0]?.finish_reason ?? '')
          provider = String(json.provider ?? '')
          reasoningLen = String(json.choices?.[0]?.message?.reasoning ?? '').length
          usage = JSON.stringify({ in: json.usage?.prompt_tokens, out: json.usage?.completion_tokens, reasoning: json.usage?.completion_tokens_details?.reasoning_tokens, cost: json.usage?.cost })
          if (json.error) content = `ERROR ${JSON.stringify(json.error).slice(0, 300)}`
        } catch {
          content = '(not json)'
        }
        let parsed = 'no'
        try {
          const value = extractJson(content) as { hypotheses?: unknown[] }
          parsed = `hypotheses=${Array.isArray(value.hypotheses) ? value.hypotheses.length : 'none'}`
        } catch {
          parsed = 'parse failed'
        }
        console.log(
          `openrouter slot=${slot.slot} json_mode=${jsonMode} status=${res.status} headers_ms=${headersMs} body_ms=${bodyMs} raw_len=${raw.length} leading_ws=${raw.length - raw.trimStart().length} provider=${provider} finish=${finish} reasoning_chars=${reasoningLen} usage=${usage} parsed=${parsed}`,
        )
        console.log(`  body_head=${JSON.stringify(trimmed.slice(0, 200))}`)
        console.log(`  content_head=${JSON.stringify(content.slice(0, 200))}`)
      } catch (error) {
        console.log(`openrouter slot=${slot.slot} json_mode=${jsonMode} FAIL ms=${Date.now() - started} ${error instanceof Error ? `${error.name} ${error.message}` : error}`)
      }
    }
  }
}

async function main(): Promise<void> {
  if (!only || only === 'anthropic') await anthropic()
  if (!only || only === 'openrouter') await openrouter()
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
