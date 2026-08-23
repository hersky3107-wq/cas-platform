/**
 * Gemini tarot reliability A/B: current thinking vs thinkingLevel=minimal.
 *
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-gemini-reliability.mts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LAYER1_REGISTRY } from '../lib/oracle/ai/registry'
import { parseLayer1Json } from '../lib/oracle/ai/parse-layer1'
import { buildLayer1SystemPrompt, buildLayer1UserPrompt } from '../lib/oracle/ai/prompts/layer1'
import { personalDataFrom, runComputations } from '../lib/oracle/runner/compute'
import { makeProfile } from '../lib/oracle/runner/__tests__/fakes'

const MODEL = LAYER1_REGISTRY.tarot.model
const MAX_OUT = LAYER1_REGISTRY.tarot.maxCompletionTokens
const RUNS = 20
const LOCALE = 'ko'
const QUESTION = '올해 일의 방향을 어떻게 잡아야 하는가?'
const AS_OF = '2026-08-23'
const OUT = join(process.cwd(), 'docs', 'oracle-gemini-reliability.md')

type Arm = 'current' | 'minimal'
type RunRow = {
  arm: Arm
  run: number
  parsed: boolean
  contentTokens: number | null
  thoughtsTokens: number | null
  promptTokens: number | null
  totalTokens: number | null
  finishReason: string | null
  rawBodyBytes: number
  textChars: number
  error: string | null
  usageRaw: unknown
}

function getApiKey(): string {
  const key = process.env.GOOGLE_API_KEY?.trim()
  if (!key) throw new Error('GOOGLE_API_KEY missing')
  return key
}

async function listModels(apiKey: string): Promise<{
  sentId: string
  resolves: boolean
  match: { name: string; displayName?: string; version?: string } | null
  newerAliases: string[]
  sampleIds: string[]
}> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url)
  const json = (await res.json()) as {
    models?: Array<{ name?: string; displayName?: string; version?: string; supportedGenerationMethods?: string[] }>
  }
  if (!res.ok) throw new Error(`models list HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`)
  const models = json.models ?? []
  const ids = models.map((m) => (m.name ?? '').replace(/^models\//, '')).filter(Boolean)
  const match = models.find((m) => (m.name ?? '').replace(/^models\//, '') === MODEL)
  const flashFamily = ids.filter((id) => /gemini-3.*flash/i.test(id)).sort()
  return {
    sentId: MODEL,
    resolves: Boolean(match),
    match: match
      ? {
          name: (match.name ?? '').replace(/^models\//, ''),
          displayName: match.displayName,
          version: match.version,
        }
      : null,
    newerAliases: flashFamily.filter((id) => id !== MODEL),
    sampleIds: flashFamily,
  }
}

function buildGenerationConfig(arm: Arm): Record<string, unknown> {
  const base = { maxOutputTokens: MAX_OUT }
  if (arm === 'current') {
    // Matches production allowGeminiThinking:true — omit thinkingConfig (model default).
    return base
  }
  // Gemini 3 Flash: thinkingLevel minimal ≈ "no thinking" for most queries.
  // thinkingBudget:0 is rejected for gemini-3.6-flash (TRAP d).
  return { ...base, thinkingConfig: { thinkingLevel: 'minimal' } }
}

async function callOnce(
  apiKey: string,
  arm: Arm,
  systemPrompt: string,
  userPrompt: string,
  run: number,
): Promise<RunRow> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    MODEL,
  )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
    ],
    generationConfig: buildGenerationConfig(arm),
  }
  const rawChunks: string[] = []
  let aggregated = ''
  let usageRaw: unknown = null
  let finishReason: string | null = null
  let error: string | null = null

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const textBody = await res.text()
    rawChunks.push(textBody)
    if (!res.ok) {
      error = `HTTP ${res.status}: ${textBody.slice(0, 500)}`
    } else {
      for (const line of textBody.split(/\r?\n/)) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const data = t.startsWith('data: ') ? t.slice(6) : t.slice(5)
        if (!data || data === '[DONE]') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(data)
        } catch {
          continue
        }
        const items = Array.isArray(parsed) ? parsed : [parsed]
        for (const item of items) {
          if (!item || typeof item !== 'object') continue
          const root = item as Record<string, unknown>
          if (root.usageMetadata) usageRaw = root.usageMetadata
          const candidates = root.candidates
          if (!Array.isArray(candidates) || !candidates[0]) continue
          const cand = candidates[0] as Record<string, unknown>
          if (typeof cand.finishReason === 'string') finishReason = cand.finishReason
          const content = cand.content as { parts?: Array<{ text?: string; thought?: boolean }> } | undefined
          for (const part of content?.parts ?? []) {
            if (part.thought) continue
            if (typeof part.text === 'string') aggregated += part.text
          }
        }
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }

  const rawBody = rawChunks.join('')
  const usage = (usageRaw ?? {}) as Record<string, number | undefined>
  const parsed = !error && aggregated ? parseLayer1Json(aggregated) != null : false

  console.log(
    `  [${arm}] run=${run} parsed=${parsed} content=${usage.candidatesTokenCount ?? '—'} thoughts=${usage.thoughtsTokenCount ?? '—'} finish=${finishReason ?? '—'} chars=${aggregated.length}`,
  )

  return {
    arm,
    run,
    parsed,
    contentTokens: usage.candidatesTokenCount ?? null,
    thoughtsTokens: usage.thoughtsTokenCount ?? null,
    promptTokens: usage.promptTokenCount ?? null,
    totalTokens: usage.totalTokenCount ?? null,
    finishReason,
    rawBodyBytes: Buffer.byteLength(rawBody, 'utf8'),
    textChars: aggregated.length,
    error,
    usageRaw,
  }
}

async function runArm(
  apiKey: string,
  arm: Arm,
  systemPrompt: string,
  userPrompt: string,
): Promise<RunRow[]> {
  console.log(`\n=== arm=${arm} (${RUNS} runs) ===`)
  const rows: RunRow[] = []
  for (let i = 1; i <= RUNS; i += 1) {
    rows.push(await callOnce(apiKey, arm, systemPrompt, userPrompt, i))
  }
  return rows
}

function summarize(rows: RunRow[]): {
  parsed: number
  total: number
  failIndexes: number[]
  clusterNote: string
} {
  const ok = rows.filter((r) => r.parsed)
  const fails = rows.filter((r) => !r.parsed)
  const failIndexes = fails.map((r) => r.run)
  let clusterNote = 'no failures'
  if (fails.length) {
    const early = failIndexes.filter((n) => n <= 5).length
    const late = failIndexes.filter((n) => n > 15).length
    const mid = fails.length - early - late
    clusterNote = `fails at runs [${failIndexes.join(', ')}] — early(1-5)=${early}, mid(6-15)=${mid}, late(16-20)=${late}`
  }
  return { parsed: ok.length, total: rows.length, failIndexes, clusterNote }
}

async function main() {
  const apiKey = getApiKey()
  const catalog = await listModels(apiKey)
  console.log('Model catalog check:', JSON.stringify(catalog, null, 2))

  const profile = makeProfile({ user_id: 'gemini-reliability' })
  const computed = runComputations({
    profile,
    systems: ['tarot'],
    kind: 'personal',
    locale: LOCALE,
    question: QUESTION,
    asOfDate: AS_OF,
    seed: 'oracle-quality-bakeoff-v2',
    sessionInputs: {},
    personalData: personalDataFrom([profile]),
  })
  const tarot = computed.systems.find((s) => s.system === 'tarot')
  if (!tarot?.aiPayload) throw new Error('tarot payload missing')
  const payload = { ...tarot.aiPayload }
  const systemPrompt = buildLayer1SystemPrompt(LOCALE, 'tarot')
  const userPrompt = buildLayer1UserPrompt(payload, LOCALE, 'tarot')

  // Probe thinkingBudget:0 once (expected reject for 3.6 flash)
  console.log('\n=== probe thinkingBudget:0 ===')
  let budget0Result = 'not run'
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      MODEL,
    )}:generateContent?key=${encodeURIComponent(apiKey)}`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with OK only.' }] }],
        generationConfig: { maxOutputTokens: 32, thinkingConfig: { thinkingBudget: 0 } },
      }),
    })
    const t = await res.text()
    budget0Result = `HTTP ${res.status}: ${t.slice(0, 300)}`
  } catch (e) {
    budget0Result = e instanceof Error ? e.message : String(e)
  }
  console.log(budget0Result)

  const currentRows = await runArm(apiKey, 'current', systemPrompt, userPrompt)
  const minimalRows = await runArm(apiKey, 'minimal', systemPrompt, userPrompt)

  const currentSum = summarize(currentRows)
  const minimalSum = summarize(minimalRows)
  const winningArm: Arm | null =
    minimalSum.parsed >= 19 ? 'minimal' : currentSum.parsed >= 19 ? 'current' : null

  const oneOk = [...minimalRows, ...currentRows].find((r) => r.parsed && r.usageRaw)
  const oneFail = [...minimalRows, ...currentRows].find((r) => !r.parsed && r.usageRaw)

  const lines: string[] = [
    '# Gemini tarot reliability (thinking-budget hypothesis)',
    '',
    '## Call-site comparison (bakeoff vs smoke)',
    '',
    '| knob | bakeoff (Google×tarot) | smoke (Google×tarot) |',
    '| --- | --- | --- |',
    '| entry point | `callLayer1Model` direct | `layer1-adapter` → `callLayer1Model` |',
    '| HTTP | `streamGenerateContent?alt=sse` (streaming) | same |',
    '| allowGeminiThinking | `true` (registry.tarot) | `true` (registry.tarot) |',
    '| temperature | unset (provider default) | unset (provider default) |',
    '| concurrency | sequential solo brand loops | parallel with other systems in `advance` chunk |',
    '| request pacing | immediate back-to-back | burst with other 11 units |',
    '| maxCompletionTokens | 1200 | 1200 |',
    '',
    'This script matches bakeoff pacing (sequential, frozen payload, same prompts).',
    '',
    '## 1. Model id check',
    '',
    `- **Sent id:** \`${catalog.sentId}\``,
    `- **Resolves in Google models list:** ${catalog.resolves ? 'yes' : 'NO'}`,
    `- **Catalog match:** ${catalog.match ? JSON.stringify(catalog.match) : '(none)'}`,
    `- **Other gemini-3 flash aliases in catalog:** ${catalog.sampleIds.join(', ') || '(none)'}`,
    '',
    'Naming is ruled out if resolves=yes — failures are not a stale model id.',
    '',
    '## thinkingBudget:0 probe',
    '',
    '```',
    budget0Result,
    '```',
    '',
    '## 2. Raw usage samples',
    '',
    '### Successful call usageMetadata',
    '```json',
    JSON.stringify(oneOk?.usageRaw ?? null, null, 2),
    '```',
    '',
    '### Truncated/failed call usageMetadata',
    '```json',
    JSON.stringify(oneFail?.usageRaw ?? null, null, 2),
    '```',
    '',
    '## 3. Arm A — CURRENT (allowGeminiThinking default / no thinkingConfig)',
    '',
    `- **Parse success: ${currentSum.parsed}/${currentSum.total}**`,
    `- Cluster: ${currentSum.clusterNote}`,
    '',
    '| run | parsed | content | thoughts | finish | textChars | rawBodyBytes |',
    '| ---: | --- | ---: | ---: | --- | ---: | ---: |',
  ]

  for (const r of currentRows) {
    lines.push(
      `| ${r.run} | ${r.parsed} | ${r.contentTokens ?? '—'} | ${r.thoughtsTokens ?? '—'} | ${r.finishReason ?? '—'} | ${r.textChars} | ${r.rawBodyBytes} |`,
    )
  }

  lines.push(
    '',
    '## 3. Arm B — thinkingLevel=minimal',
    '',
    `- **Parse success: ${minimalSum.parsed}/${minimalSum.total}**`,
    `- Cluster: ${minimalSum.clusterNote}`,
    '',
    '| run | parsed | content | thoughts | finish | textChars | rawBodyBytes |',
    '| ---: | --- | ---: | ---: | --- | ---: | ---: |',
  )
  for (const r of minimalRows) {
    lines.push(
      `| ${r.run} | ${r.parsed} | ${r.contentTokens ?? '—'} | ${r.thoughtsTokens ?? '—'} | ${r.finishReason ?? '—'} | ${r.textChars} | ${r.rawBodyBytes} |`,
    )
  }

  lines.push('', '## Failed-run raw body byte lengths', '')
  for (const r of [...currentRows, ...minimalRows].filter((x) => !x.parsed)) {
    lines.push(
      `- arm=${r.arm} run=${r.run}: rawBodyBytes=${r.rawBodyBytes}, finish=${r.finishReason}, thoughts=${r.thoughtsTokens}, content=${r.contentTokens}, error=${r.error ?? '—'}`,
    )
  }

  lines.push(
    '',
    '## Decision',
    '',
    `- Current arm: **${currentSum.parsed}/20**`,
    `- Minimal arm: **${minimalSum.parsed}/20**`,
    `- Threshold to keep Google on tarot: **≥19/20** in the winning arm`,
    `- Winning arm: **${winningArm ?? 'NONE — Google does not stay on tarot'}**`,
    '',
  )

  writeFileSync(OUT, lines.join('\n'), 'utf8')
  writeFileSync(
    join(process.cwd(), 'docs', 'oracle-gemini-reliability.json'),
    JSON.stringify({ catalog, budget0Result, currentRows, minimalRows, currentSum, minimalSum, winningArm }, null, 2),
    'utf8',
  )
  console.log(`\nWrote ${OUT}`)
  console.log(`CURRENT ${currentSum.parsed}/20 | MINIMAL ${minimalSum.parsed}/20 | win=${winningArm}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
