import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ANTHROPIC_DEEP_TASK_MODEL,
  MODEL_BY_PROVIDER,
  runSingleAiProvider,
  type AiProviderName,
  type RouterResult,
} from '@/lib/ai/router'
import { supabaseAdmin } from '@/lib/supabase/server'
import { resolveRouteAuth } from '@/lib/supabase/route-auth'
import { creditsForDeep, type DeepOutputMode } from '@/lib/credits'
import { deductCreditsBalance } from '@/lib/credits-server'

const MODE_CORE_TOKENS: Record<DeepOutputMode, number> = {
  brief: 400,
  standard: 1500,
  report: 3000,
}

const MODE_SUPPORT_TOKENS: Record<DeepOutputMode, number> = {
  brief: 250,
  standard: 900,
  report: 1800,
}

const ORCHESTRATOR_MODEL = 'claude-sonnet-4-6'

type ManualAssignment = { provider: AiProviderName; angle: string }

/** Fixed order for deterministic repair when the orchestrator repeats a provider. */
const PROVIDER_ORDER: AiProviderName[] = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'mistral',
]

const VALID_PROVIDERS = new Set<AiProviderName>(PROVIDER_ORDER)

type DeepOrchestratorPart = {
  index: number
  topic: string
  assigned_provider: AiProviderName
  priority: 'CORE' | 'SUPPORT'
  depth: string
  angle: string
}

const LANGUAGE_MIRROR_RULE = `[ABSOLUTE LANGUAGE RULE — HIGHEST PRIORITY — OVERRIDES EVERYTHING]
You MUST detect the language of the user's original question and respond ONLY in that language.
Korean question = Korean response. English question = English response.
This rule overrides ALL other instructions. Every single sentence must be in the detected language.
Violating this rule is not acceptable under any circumstances.
Current date: May 29, 2026. Use the most up-to-date information available.`

const PROSE_STYLE_RULE = `Write in flowing prose paragraphs.
Do NOT use markdown headers (##, ###).
Do NOT use deeply nested bullet lists.
Bold text is allowed sparingly.
If you are near the token limit, write one final
concluding sentence and stop cleanly.
Never end mid-sentence or mid-word.`

const AMPLE_SPACE_RULE = `You have ample space to write.
Finish every section completely.
If approaching the limit, write one final
concluding sentence and stop.
Never end mid-sentence or mid-word.`

const RESPONSE_COMPLETION_RULE = `CRITICAL: Complete your response fully and naturally.
Do not use deeply nested structures or long bullet hierarchies.
If you sense you are near the token limit, immediately skip to a
closing paragraph and stop cleanly.
NEVER end mid-sentence, mid-paragraph, or mid-list.
A short complete answer is always better than a long truncated one.`

const BRIEF_MODE_BLOCK = `BRIEF MODE — STRICT RULES:
You have 3 sentences maximum. No exceptions.
Sentence 1: Your single most important insight on the angle.
Sentence 2: One concrete example or evidence.
Sentence 3: One-line conclusion.
Do NOT write more than 3 sentences under any circumstances.
Do NOT use bullet points, headers, or lists.
Stop after your third sentence.

`

const REPORT_MODE_BLOCK = `REPORT MODE — EXHAUSTIVE ANALYSIS REQUIRED:
This is a full academic report section. You must write extensively.
Minimum 5 substantial paragraphs.
Cover every dimension of your assigned angle in depth.
Include specific examples, data, case studies where relevant.
Do NOT conclude early. Do NOT summarize prematurely.
Use your full token allocation completely.
A short answer in REPORT mode is a failure.

`

const GEMINI_REPORT_MODE_BLOCK = `GEMINI REPORT MODE — CRITICAL:
You are writing a full academic report section.
Your response must be EXHAUSTIVE and COMPREHENSIVE.
You MUST write at least 6 full paragraphs.
Each paragraph must be substantial (minimum 5 sentences).
Do NOT conclude early under any circumstances.
Do NOT write a short summary.
Keep writing until you have fully covered every aspect 
of your assigned angle.
Stopping early is not acceptable in REPORT mode.

`

function systemPromptForPart(
  priority: 'CORE' | 'SUPPORT',
  angle: string,
  outputMode: DeepOutputMode,
  provider: AiProviderName
): string {
  const a = angle.trim() || 'Analyze your assigned sub-topic with maximum clarity.'
  const modePrefix =
    outputMode === 'brief'
      ? BRIEF_MODE_BLOCK
      : outputMode === 'report'
        ? REPORT_MODE_BLOCK
        : ''
  const geminiReportSuffix =
    outputMode === 'report' && provider === 'google' ? GEMINI_REPORT_MODE_BLOCK : ''
  const fullPrefix = `${modePrefix}${geminiReportSuffix}`
  if (priority === 'CORE') {
    return `${fullPrefix}${LANGUAGE_MIRROR_RULE}

Write in flowing prose only. No markdown headers (##, ###).
No nested bullet lists. Bold sparingly.
STOP RULE — READ FIRST:
You have exactly 1500 tokens. At 1200 tokens you MUST stop your current thought,
write 'In conclusion,' and finish in 2-3 sentences. Do not start any new point after 1200 tokens.
A complete shorter answer is far better than a cut-off longer one.
Never end mid-sentence or mid-word under any circumstances.

You are answering this specific angle: ${a}. Go deep. Be specific. Don't hedge. If the conventional wisdom is wrong, say so.

${PROSE_STYLE_RULE}

${AMPLE_SPACE_RULE}

${RESPONSE_COMPLETION_RULE}`
  }
  return `${fullPrefix}${LANGUAGE_MIRROR_RULE}

You have 900 tokens total. Write your full analysis in the first 700 tokens,
then use the remaining 200 to write one complete concluding sentence and stop.
Never end mid-sentence or mid-word. Pace yourself from the start.

You are answering this specific angle: ${a}. Be sharp and direct. No filler. Make your perspective distinct from what a generic analysis would say.

${PROSE_STYLE_RULE}

${AMPLE_SPACE_RULE}

${RESPONSE_COMPLETION_RULE}`
}

const ORCHESTRATOR_SYSTEM = `You are an expert analyst who breaks down complex questions into distinct intellectual dimensions.

Language: Detect the language of the user's question. All six downstream model assignments must steer those models to answer in that exact same language. Write each "topic" and "angle" entry in that detected language so the assigned AI clearly mirrors the user's language (e.g. Korean question → Korean topics/angles → Korean responses; English → English).

Before assigning sub-topics, first classify the user's question:

DEBATE type: questions with no clear answer, involving ethics, politics, philosophy, social controversy, or competing values.
→ Assign CORE to angles that carry the sharpest clash of perspectives.
→ Include critical, contrarian, or ethical angles naturally.

EXPLORATION type: questions about a specific subject, place, person, structure, phenomenon, or field — where the goal is deep multi-lens understanding, not debate.
→ Assign CORE to the 2 most essential expert lenses for that subject.
→ Do NOT force contrarian or critical angles.
→ Instead, maximize diversity of expertise: architecture, economics, history, engineering, culture, environment, design, geopolitics — whatever fits best.

Examples:
"Is democracy the best system?" → DEBATE
"What makes the Burj Khalifa remarkable?" → EXPLORATION
"Can AI replace human creativity?" → DEBATE
"How does the James Webb Telescope work?" → EXPLORATION

After choosing DEBATE vs EXPLORATION, split the user's question into exactly 6 sub-topics that together give a COMPLETE understanding for that classification. Within EXPLORATION, avoid artificial debate framings where they do not fit; within DEBATE, lean into ideological tension responsibly.

Then assign each sub-topic to the AI best suited for that angle:
- openai (gpt-4o): structured logic, data frameworks, step-by-step reasoning
- anthropic (claude-opus-4-6): ethics, philosophy, human nuance, uncomfortable truths
- google (gemini-2.5-flash): factual grounding, scientific evidence, real-world synthesis
- xai (grok-3): cultural pulse, what people actually think, trend instinct
- deepseek (deepseek-chat): academic depth, specialist rigor, historical precedent
- mistral (mistral-large-latest): cross-cultural lens, practical utility, concise clarity

Mark 1-2 sub-topics as CORE (where the real answer lives) and the rest as SUPPORT.

Return ONLY this JSON:
{
  "parts": [
    {
      "index": 1,
      "topic": "sub-topic title",
      "assigned_provider": "anthropic",
      "priority": "CORE",
      "depth": "deep",
      "angle": "one sentence describing the specific intellectual angle this AI should take"
    }
  ]
}

Rules:
- Exactly 6 parts
- Each of the 6 providers appears exactly once
- 1-2 parts marked CORE, rest SUPPORT
- Sub-topics must represent genuinely different angles, not variations of the same angle

Do not wrap the response in markdown code fences or add any text before or after the JSON object.`

async function insertUserDebateEntry(supabase: SupabaseClient, sessionId: string, prompt: string) {
  const a = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, role: 'user', message_text: prompt }])
  if (!a.error) return
  const b = await supabase
    .from('debate_logs')
    .insert([{ session_id: sessionId, content: prompt, speaker: 'user' }])
  if (b.error) console.warn('[deep] debate_logs user insert:', b.error.message)
}

async function insertRowsWithFallback(
  table: string,
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>
) {
  const first = await supabaseAdmin.from(table).insert([primary])
  if (!first.error) return
  const second = await supabaseAdmin.from(table).insert([fallback])
  if (second.error) console.warn(`[deep] ${table} insert:`, second.error.message)
}

function stripJsonFences(raw: string) {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  }
  return t.trim()
}

/** Structural validation (indices, CORE count, fields). Does not enforce provider uniqueness. */
function parsePlanPayloadStructural(text: string): { parts: DeepOrchestratorPart[] } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFences(text))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const root = parsed as Record<string, unknown>
  const partsRaw = root.parts
  if (!Array.isArray(partsRaw) || partsRaw.length !== 6) return null

  const out: DeepOrchestratorPart[] = []
  for (const item of partsRaw) {
    if (!item || typeof item !== 'object') return null
    const row = item as Record<string, unknown>
    const index = row.index
    const topic = row.topic
    const ap = row.assigned_provider
    const pr = row.priority
    const depth = row.depth
    const angle = row.angle

    if (typeof index !== 'number' || index < 1 || index > 6) return null
    if (typeof topic !== 'string' || !topic.trim()) return null
    if (typeof ap !== 'string' || !VALID_PROVIDERS.has(ap as AiProviderName)) return null
    const priority =
      typeof pr === 'string' && pr.toUpperCase() === 'CORE'
        ? 'CORE'
        : typeof pr === 'string' && pr.toUpperCase() === 'SUPPORT'
          ? 'SUPPORT'
          : null
    if (!priority) return null
    if (typeof depth !== 'string' || !depth.trim()) return null
    if (typeof angle !== 'string' || !angle.trim()) return null

    out.push({
      index,
      topic: topic.trim(),
      assigned_provider: ap as AiProviderName,
      priority,
      depth: depth.trim(),
      angle: angle.trim(),
    })
  }

  const indices = new Set(out.map((p) => p.index))
  if (indices.size !== 6) return null
  const coreCount = out.filter((p) => p.priority === 'CORE').length
  if (coreCount < 1 || coreCount > 2) return null

  out.sort((a, b) => a.index - b.index)
  return { parts: out }
}

function eachProviderExactlyOnce(parts: DeepOrchestratorPart[]): boolean {
  const counts = new Map<AiProviderName, number>()
  for (const p of PROVIDER_ORDER) counts.set(p, 0)
  for (const part of parts) {
    counts.set(part.assigned_provider, (counts.get(part.assigned_provider) ?? 0) + 1)
  }
  return PROVIDER_ORDER.every((p) => (counts.get(p) ?? 0) === 1)
}

/** Reassign later duplicate slots so each provider appears exactly once (topics/priorities/angles unchanged). */
function forceUniqueProvidersAcrossParts(parts: DeepOrchestratorPart[]): DeepOrchestratorPart[] {
  const out = [...parts].sort((a, b) => a.index - b.index)
  const count = new Map<AiProviderName, number>()
  for (const p of PROVIDER_ORDER) count.set(p, 0)
  for (const part of out) {
    count.set(part.assigned_provider, (count.get(part.assigned_provider) ?? 0) + 1)
  }

  const seen = new Set<AiProviderName>()
  const duplicatePartIndices: number[] = []

  for (const part of out) {
    if (seen.has(part.assigned_provider)) {
      duplicatePartIndices.push(part.index)
    } else {
      seen.add(part.assigned_provider)
    }
  }

  const missingProviders = PROVIDER_ORDER.filter((p) => (count.get(p) ?? 0) === 0)
  duplicatePartIndices.sort((a, b) => a - b)

  for (let i = 0; i < duplicatePartIndices.length; i++) {
    const ix = duplicatePartIndices[i]
    const newProv = missingProviders[i]
    if (newProv !== undefined && ix !== undefined) {
      const row = out.find((r) => r.index === ix)
      if (row) row.assigned_provider = newProv
    }
  }

  return out.sort((a, b) => a.index - b.index)
}

async function fetchOrchestratorRawText(userQuestion: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured.')
  }

  const body = {
    model: ORCHESTRATOR_MODEL,
    max_tokens: 4096,
    system: ORCHESTRATOR_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `User question/topic:\n${userQuestion}\n\nProduce the JSON plan now.`,
      },
    ],
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Orchestrator HTTP ${res.status}: ${errText.slice(0, 500)}`)
  }

  const json: any = await res.json()
  const text = Array.isArray(json?.content)
    ? json.content.map((b: any) => b?.text).filter(Boolean).join('\n')
    : ''
  return text
}

/**
 * Parses plan; retries orchestrator once when providers are duplicated; otherwise force-fixes.
 */
async function resolveOrchestratorPlan(userQuestion: string): Promise<{
  parts: DeepOrchestratorPart[]
  repairedProviders: boolean
}> {
  let lastStructural: DeepOrchestratorPart[] | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await fetchOrchestratorRawText(userQuestion)
    if (!text.trim()) continue
    const parsed = parsePlanPayloadStructural(text)
    if (!parsed) continue

    lastStructural = parsed.parts
    if (eachProviderExactlyOnce(parsed.parts)) {
      return { parts: parsed.parts, repairedProviders: false }
    }
    // Duplicate providers: retry orchestrator exactly once before force-repair.
  }

  if (!lastStructural) {
    throw new Error('Orchestrator returned an invalid plan.')
  }

  return {
    parts: forceUniqueProvidersAcrossParts(lastStructural),
    repairedProviders: true,
  }
}

function subQuestionPrompt(original: string, topic: string) {
  return `Original question/topic:\n${original}\n\nYour assigned sub-topic (answer only this part):\n${topic}`
}

function modelForAssignedPart(provider: AiProviderName): string {
  if (provider === 'anthropic') return ANTHROPIC_DEEP_TASK_MODEL
  if (provider === 'openai') return 'gpt-4.1'
  return MODEL_BY_PROVIDER[provider]
}

function parseManualAssignments(raw: unknown): ManualAssignment[] | null {
  if (!Array.isArray(raw) || raw.length !== 6) return null
  const seen = new Set<AiProviderName>()
  const out: ManualAssignment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const o = item as Record<string, unknown>
    const provider = o.provider
    const angle = typeof o.angle === 'string' ? o.angle.trim() : ''
    if (typeof provider !== 'string' || !VALID_PROVIDERS.has(provider as AiProviderName)) {
      return null
    }
    const pid = provider as AiProviderName
    if (seen.has(pid)) return null
    seen.add(pid)
    out.push({ provider: pid, angle })
  }
  if (seen.size !== 6) return null
  return out
}

function buildPlanFromManualAssignments(
  assignments: ManualAssignment[]
): DeepOrchestratorPart[] {
  return assignments.map((item, i) => ({
    index: i + 1,
    topic: item.angle || `${item.provider} perspective`,
    assigned_provider: item.provider,
    priority: i < 2 ? 'CORE' : 'SUPPORT',
    depth: 'deep',
    angle: item.angle || `Analyze from the ${item.provider} lens.`,
  }))
}

function pickWinnerAiName(parts: DeepOrchestratorPart[], byIndex: Map<number, RouterResult>): string {
  const core = parts.filter((p) => p.priority === 'CORE')
  const scored = core.map((p) => {
    const r = byIndex.get(p.index)
    const errW = r?.error ? 1e9 : 0
    const len = (r?.text?.length ?? 0) + (r?.completionTokens ?? 0) * 3
    return { provider: p.assigned_provider, score: errW > 0 ? -1e9 : len }
  })
  scored.sort((a, b) => b.score - a.score)
  if (scored[0] && scored[0].score > -1e8) return scored[0].provider
  return core[0]?.assigned_provider ?? parts[0]!.assigned_provider
}

function truncateAtLastSentence(text: string): string {
  if (!text) return text
  const sentenceEnders = /[.!?。]\s/g
  let lastIndex = -1
  let match
  while ((match = sentenceEnders.exec(text)) !== null) {
    lastIndex = match.index
  }
  if (lastIndex === -1) return text
  return text.slice(0, lastIndex + 1).trim()
}

async function runSynthesis(
  originalQuestion: string,
  parts: DeepOrchestratorPart[],
  byIndex: Map<number, RouterResult>
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured')

  const responseSummary = parts
    .map((part) => {
      const result = byIndex.get(part.index)
      const text = result?.text ?? '[no response]'
      return `[${part.assigned_provider.toUpperCase()} — ${part.topic}]\n${text}`
    })
    .join('\n\n---\n\n')

  const systemPrompt = `[ABSOLUTE LANGUAGE RULE] You MUST write your synthesis in the exact same language as the original question. Korean question = Korean synthesis. English question = English synthesis. No exceptions.\n\nYou are a master synthesizer. You have received six different AI perspectives on a single question. Your job is to write a final synthesis that:
1. Identifies the strongest points of agreement across the responses
2. Highlights the sharpest points of disagreement or tension
3. Offers your own integrative conclusion that goes beyond any single perspective
4. Is written in the same language as the original question

Rules:
- Do NOT summarize each AI separately. Synthesize, don't list.
- Be decisive. Take positions. Don't hedge everything.
- Maximum 400 words.
- End with a complete sentence. Never cut off mid-sentence.`

  const userMessage = `Original question: ${originalQuestion}\n\nSix AI perspectives:\n\n${responseSummary}\n\nWrite your synthesis now.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1',
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Synthesis HTTP ${res.status}: ${err.slice(0, 300)}`)
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return json.choices?.[0]?.message?.content ?? ''
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  const token =
    typeof body.supabaseAccessToken === 'string' ? body.supabaseAccessToken : undefined

  const outputMode: DeepOutputMode =
    body.outputMode === 'brief' || body.outputMode === 'report'
      ? body.outputMode
      : 'standard'

  const manualAssignments: ManualAssignment[] | null =
    outputMode !== 'brief' && Array.isArray(body.manualAssignments)
      ? parseManualAssignments(body.manualAssignments)
      : null

  if (!prompt) {
    return new Response(JSON.stringify({ error: 'prompt is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { user, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const cost = creditsForDeep(outputMode)
  const coreMaxTokens = MODE_CORE_TOKENS[outputMode]
  const supportMaxTokens = MODE_SUPPORT_TOKENS[outputMode]

  const deduct = await deductCreditsBalance(supabaseAdmin, user.id, cost)
  if (!deduct.ok) {
    const insufficient = deduct.reason === 'insufficient'
    return new Response(
      JSON.stringify({
        error: insufficient
          ? `This session requires ${cost} credits. You currently have ${deduct.balance}. Top up credits to continue.`
          : 'Could not update credits. Please try again.',
        balance: deduct.balance,
        required: cost,
      }),
      { status: insufficient ? 402 : 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
  const creditsRemaining = deduct.balance

  const ins = await supabaseAdmin
    .from('sessions')
    .insert([{ mode: 'deep', prompt }])
    .select()
    .single()

  if (ins.error || !ins.data?.id) {
    return new Response(
      JSON.stringify({ error: ins.error?.message ?? 'Could not start session' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const sessionId = String(ins.data.id)
  await insertUserDebateEntry(supabaseAdmin, sessionId, prompt)

  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const writeJson = (obj: unknown) => {
        controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`))
      }

      try {
        writeJson({
          type: 'meta',
          sessionId,
          creditsRemaining,
          cost,
          outputMode,
        })

        let plan: { parts: DeepOrchestratorPart[]; repairedProviders: boolean }
        if (manualAssignments) {
          plan = {
            parts: buildPlanFromManualAssignments(manualAssignments),
            repairedProviders: false,
          }
        } else {
          try {
            plan = await resolveOrchestratorPlan(prompt)
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Orchestrator failed'
            writeJson({ type: 'error', error: msg })
            return
          }
        }

        writeJson({
          type: 'plan',
          parts: plan.parts,
          repairedProviders: plan.repairedProviders,
        })

        const byIndex = new Map<number, RouterResult>()

        type Job = { part: DeepOrchestratorPart; promise: Promise<RouterResult> }
        const jobs: Job[] = plan.parts.map((part) => ({
          part,
          promise: runSingleAiProvider({
            supabase: supabaseAdmin,
            sessionId: null,
            userId: null,
            provider: part.assigned_provider,
            prompt: subQuestionPrompt(prompt, part.topic),
            systemPrompt: systemPromptForPart(
              part.priority,
              part.angle,
              outputMode,
              part.assigned_provider
            ),
            maxCompletionTokens:
              part.priority === 'CORE' ? coreMaxTokens : supportMaxTokens,
            modelOverride: modelForAssignedPart(part.assigned_provider),
          }),
        }))

        while (jobs.length) {
          const raced = await Promise.race(
            jobs.map((job, jobIdx) =>
              job.promise.then((r) => ({ jobIdx, part: job.part, r }))
            )
          )
          jobs.splice(raced.jobIdx, 1)

          const { part, r } = raced
          byIndex.set(part.index, r)

          const storedAnswer = r.text ?? (r.error ? `[error] ${r.error}` : null)

          const primaryRow: Record<string, unknown> = {
            session_id: sessionId,
            ai_name: part.assigned_provider,
            target_ai_name: part.assigned_provider,
            model_name: r.model,
            response_text: storedAnswer,
            response_time_ms: r.responseTimeMs,
            token_input: r.promptTokens,
            token_output: r.completionTokens,
            error_text: r.error ?? null,
          }
          const fallbackRow: Record<string, unknown> = {
            session_id: sessionId,
            ai_name: part.assigned_provider,
            target_ai_name: part.assigned_provider,
            model_name: r.model,
            response_text: storedAnswer,
            response_time_ms: r.responseTimeMs,
            prompt_tokens: r.promptTokens,
            completion_tokens: r.completionTokens,
          }
          await insertRowsWithFallback('ai_responses', primaryRow, fallbackRow)

          await insertRowsWithFallback(
            'model_cost_logs',
            {
              session_id: sessionId,
              ai_name: part.assigned_provider,
              model_name: r.model,
              prompt_tokens: r.promptTokens,
              completion_tokens: r.completionTokens,
              total_tokens: r.totalTokens,
              response_time_ms: r.responseTimeMs,
              cost_usd: 0,
              error_text: r.error ?? null,
            },
            {
              session_id: sessionId,
              model_name: r.model,
              total_tokens: r.totalTokens,
            }
          )

          writeJson({
            type: 'part_result',
            index: part.index,
            topic: part.topic,
            priority: part.priority,
            assigned_provider: part.assigned_provider,
            angle: part.angle,
            result: { ...r, text: r.text ? truncateAtLastSentence(r.text) : r.text },
          })
        }

        const winner = pickWinnerAiName(plan.parts, byIndex)
        await insertRowsWithFallback(
          'session_results',
          {
            session_id: sessionId,
            winner_ai_name: winner,
            category: 'deep',
          },
          { session_id: sessionId, winner_ai_name: winner }
        )

        let synthesisText = ''
        try {
          synthesisText = await runSynthesis(prompt, plan.parts, byIndex)
          synthesisText = truncateAtLastSentence(synthesisText)
        } catch (e) {
          console.warn('[deep] synthesis failed:', e)
        }

        writeJson({
          type: 'done',
          winner_ai_name: winner,
          synthesis: synthesisText,
        })
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Unknown error'
        writeJson({ type: 'error', error: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
