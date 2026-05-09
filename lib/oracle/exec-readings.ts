import { supabaseAdmin } from '@/lib/supabase/server'
import type { AiProviderName, RouterResult } from '@/lib/ai/router'
import {
  ANTHROPIC_DEEP_TASK_MODEL,
  MODEL_BY_PROVIDER,
  runSingleAiProvider,
} from '@/lib/ai/router'
import { oracleInsertAiResponse, oracleInsertCostLog } from './oracle-db'
import { oracleGptCompletion } from './openai-gpt'
import {
  displayNameForAi,
  fateReaderUserPrompt,
  oracleSynthesisSystemPrompt,
  westernReaderUserPrompt,
} from './oracle-prompts'
import { ORACLE_READER_ORDER, ORACLE_READER_MAX_TOKENS, ORACLE_SYNTH_MODEL, ORACLE_SYNTH_MAX_TOKENS } from './oracle-constants'

function modelForOracleReader(p: AiProviderName): string {
  if (p === 'anthropic') return ANTHROPIC_DEEP_TASK_MODEL
  return MODEL_BY_PROVIDER[p]
}

type ReaderSlot = AiProviderName

async function runOneOracleReader(
  provider: ReaderSlot,
  sessionId: string,
  readersSystemPromptFn: (provider: ReaderSlot) => string,
  userPrompt: string,
  maxCompletionTokens: number,
  modelOverride?: string
): Promise<{ slot: ReaderSlot; result: RouterResult }> {
  const sys = readersSystemPromptFn(provider)
  const r = await runSingleAiProvider({
    supabase: supabaseAdmin,
    sessionId: null,
    userId: null,
    provider,
    prompt: userPrompt,
    systemPrompt: sys,
    maxCompletionTokens,
    modelOverride: modelOverride ?? modelForOracleReader(provider),
  })
  const storedAnswer = r.text ?? (r.error ? `[error] ${r.error}` : null)

  await oracleInsertAiResponse(sessionId, provider, r.model, {
    responseText: storedAnswer,
    responseTimeMs: r.responseTimeMs,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    errorText: r.error ?? null,
  })

  await oracleInsertCostLog({
    sessionId,
    aiName: provider,
    modelName: r.model,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    totalTokens: r.totalTokens,
    responseTimeMs: r.responseTimeMs,
    errorText: r.error ?? null,
  })

  return { slot: provider, result: r }
}

export async function oracleRunFiveReaders(params: {
  sessionId: string
  readersSystemPromptFn: (provider: ReaderSlot) => string
  userPrompt: string
  providers?: ReaderSlot[]
  maxTokensByProvider?: Partial<Record<ReaderSlot, number>>
  modelOverrideByProvider?: Partial<Record<ReaderSlot, string>>
  /** Fires as each reader finishes (order not fixed). Called after DB rows are written. */
  onReaderDone?: (evt: { slot: ReaderSlot; result: RouterResult }) => void
}): Promise<Array<{ slot: ReaderSlot; result: RouterResult }>> {
  const providers = params.providers ?? ORACLE_READER_ORDER
  const jobs = providers.map((provider) =>
    runOneOracleReader(
      provider,
      params.sessionId,
      params.readersSystemPromptFn,
      params.userPrompt,
      params.maxTokensByProvider?.[provider] ?? ORACLE_READER_MAX_TOKENS,
      params.modelOverrideByProvider?.[provider]
    )
  )

  const out: Array<{ slot: ReaderSlot; result: RouterResult }> = []

  while (jobs.length) {
    const raced = await Promise.race(jobs.map((promise, idx) => promise.then((v) => ({ idx, v }))))
    jobs.splice(raced.idx, 1)
    out.push(raced.v)
    params.onReaderDone?.({ slot: raced.v.slot, result: raced.v.result })
  }

  return out
}

export async function oracleRunSynth(params: {
  sessionId: string
  parts: Array<{ label: string; text: string }>
  birthDataLine: string
  currentDateIso: string
  languageInstruction: string
}): Promise<{
  text: string | null
  rt: number
  promptTokens: number | null
  completionTokens: number | null
}> {
  const started = Date.now()
  let bodyLines = ''
  for (const p of params.parts) {
    bodyLines += `\n–– ${p.label} ––\n${p.text}\n`
  }

  const userPayload = [
    `You have exactly ${params.parts.length} labelled readings (${params.parts.map((p) => p.label).join(', ')}).`,
    'Synthesize as instructed:',
    bodyLines,
  ].join('\n')

  let text: string | null = null
  let pt: number | null = null
  let ct: number | null = null
  try {
    const o = await oracleGptCompletion({
      model: ORACLE_SYNTH_MODEL,
      systemPrompt: oracleSynthesisSystemPrompt({
        readingsCount: params.parts.length,
        birthDataLine: params.birthDataLine,
        currentDateIso: params.currentDateIso,
        languageInstruction: params.languageInstruction,
      }),
      userPrompt: userPayload,
      maxTokens: ORACLE_SYNTH_MAX_TOKENS,
    })
    text = o.text
    pt = o.promptTokens
    ct = o.completionTokens
  } catch (e: any) {
    const msg = e?.message ?? 'Synthesis failed'
    text = null
    const rt = Date.now() - started
    await oracleInsertAiResponse(params.sessionId, 'openai', ORACLE_SYNTH_MODEL, {
      responseText: null,
      responseTimeMs: rt,
      promptTokens: null,
      completionTokens: null,
      errorText: msg,
    })
    await oracleInsertCostLog({
      sessionId: params.sessionId,
      aiName: 'openai',
      modelName: ORACLE_SYNTH_MODEL,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      responseTimeMs: rt,
      errorText: msg,
    })
    return { text: null, rt, promptTokens: null, completionTokens: null }
  }

  const rt = Date.now() - started
  await oracleInsertAiResponse(params.sessionId, 'openai', ORACLE_SYNTH_MODEL, {
    responseText: text,
    responseTimeMs: rt,
    promptTokens: pt,
    completionTokens: ct,
    errorText: null,
  })
  await oracleInsertCostLog({
    sessionId: params.sessionId,
    aiName: 'openai',
    modelName: ORACLE_SYNTH_MODEL,
    promptTokens: pt,
    completionTokens: ct,
    totalTokens: pt != null && ct != null ? pt + ct : null,
    responseTimeMs: rt,
    errorText: null,
  })

  return { text, rt, promptTokens: pt, completionTokens: ct }
}

export function defaultReaderLabels(): Record<AiProviderName, string> {
  return {
    openai: `${displayNameForAi('openai')} (gpt-4o)`,
    anthropic: `${displayNameForAi('anthropic')} (opus)`,
    google: `${displayNameForAi('google')}`,
    xai: displayNameForAi('xai'),
    deepseek: displayNameForAi('deepseek'),
    mistral: displayNameForAi('mistral'),
  }
}

export function readerSideUser(mode: 'fate' | 'astro'): string {
  return mode === 'fate' ? fateReaderUserPrompt() : westernReaderUserPrompt()
}
