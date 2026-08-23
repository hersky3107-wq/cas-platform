/**
 * Measure ai_payload size before/after labels; capture Gemini request shapes.
 * Offline — no API calls.
 *
 *   npx tsx --import ./scripts/stubs/register-server-only.mjs scripts/oracle-payload-size-probe.mts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRISM_COLORS } from '../lib/oracle/engines/prism'
import { labelForReasonCode, buildLabelledReasons } from '../lib/oracle/axes/reason-labels'
import { SYSTEM_IDS } from '../lib/oracle/axes/types'
import { personalDataFrom, runComputations } from '../lib/oracle/runner/compute'
import { buildLayer1SystemPrompt, buildLayer1UserPrompt } from '../lib/oracle/ai/prompts/layer1'
import { LAYER1_REGISTRY } from '../lib/oracle/ai/registry'
import { makeProfile } from '../lib/oracle/runner/__tests__/fakes'
import type { AxisVote } from '../lib/oracle/axes/types'
import type { JsonObject } from '../lib/oracle/runner/types'
import type { PayloadContext } from '../lib/oracle/runner/payload'

const LOCALE = 'ko'
const AS_OF = '2026-08-23'
const QUESTION = '올해 일의 방향을 어떻게 잡아야 하는가?'

function bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8')
}

/** Rough token estimate: ~4 chars/token for mixed KO+JSON. */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4)
}

function payloadBefore(vote: AxisVote, ctx: PayloadContext): JsonObject {
  return {
    runnerVersion: '1.0.0',
    axesLayerVersion: '1.0.0',
    kind: ctx.kind,
    locale: ctx.locale,
    readingScope: ctx.readingScope,
    system: vote.system,
    engineVersion: vote.engineVersion,
    traits: vote.traits,
    elements: vote.elements,
    phase: vote.phase,
    confidence: vote.confidence,
    reasons: vote.reasons,
    unreadable: vote.unreadable.map((e) => ({ space: e.space, code: e.code })),
    context: { asOfDate: ctx.asOfDate, question: ctx.question },
  }
}

function payloadAfterCurrent(vote: AxisVote, ctx: PayloadContext): JsonObject {
  const labelled = buildLabelledReasons(vote.reasons, ctx.locale)
  return {
    ...payloadBefore(vote, ctx),
    reasons: labelled.reasons,
    labels: labelled.labels,
    unreadable: vote.unreadable.map((entry) => ({
      space: entry.space,
      code: entry.code,
      label: labelForReasonCode(entry.code, ctx.locale),
    })),
  }
}

/** Prior object form {code,label}[] — measured for comparison only. */
function payloadObjectForm(vote: AxisVote, ctx: PayloadContext): JsonObject {
  const mapSpace = (codes: string[] | undefined) =>
    codes?.map((code) => ({ code, label: labelForReasonCode(code, ctx.locale) }))
  return {
    ...payloadBefore(vote, ctx),
    reasons: {
      traits: mapSpace(vote.reasons.traits),
      elements: mapSpace(vote.reasons.elements),
      phase: mapSpace(vote.reasons.phase),
    },
    unreadable: vote.unreadable.map((entry) => ({
      space: entry.space,
      code: entry.code,
      label: labelForReasonCode(entry.code, ctx.locale),
    })),
  }
}

function main() {
  const profile = makeProfile({ user_id: 'probe' })
  const personalData = personalDataFrom([profile])
  const computed = runComputations({
    profile,
    systems: [...SYSTEM_IDS],
    kind: 'personal',
    locale: LOCALE,
    question: QUESTION,
    asOfDate: AS_OF,
    seed: 'oracle-quality-bakeoff-v2',
    sessionInputs: {
      prism: {
        impulse: PRISM_COLORS[0],
        need: PRISM_COLORS[1],
        identity: PRISM_COLORS[2],
        microCheck: [3, 4, 2, 3],
      },
    },
    personalData,
  })

  const ctx: PayloadContext = {
    kind: 'personal',
    locale: LOCALE,
    readingScope: 'question',
    asOfDate: AS_OF,
    question: QUESTION,
  }

  const rows: Array<Record<string, unknown>> = []
  console.log(
    'system'.padEnd(12),
    'beforeB'.padStart(8),
    'afterB'.padStart(8),
    'objectB'.padStart(9),
    'factor'.padStart(7),
    'oFactor'.padStart(8),
    'beforeT'.padStart(8),
    'afterT'.padStart(8),
  )

  for (const system of SYSTEM_IDS) {
    const entry = computed.systems.find((s) => s.system === system)
    if (!entry?.vote) {
      console.log(`${system.padEnd(12)} (no vote)`)
      continue
    }
    const before = JSON.stringify(payloadBefore(entry.vote, ctx))
    const after = JSON.stringify(payloadAfterCurrent(entry.vote, ctx))
    const objectForm = JSON.stringify(payloadObjectForm(entry.vote, ctx))
    const factor = (bytes(after) / bytes(before)).toFixed(2)
    const oFactor = (bytes(objectForm) / bytes(before)).toFixed(2)
    rows.push({
      system,
      beforeBytes: bytes(before),
      afterBytes: bytes(after),
      objectFormBytes: bytes(objectForm),
      growthFactor: Number(factor),
      objectFormGrowthFactor: Number(oFactor),
      beforeApproxTokens: approxTokens(before),
      afterApproxTokens: approxTokens(after),
      reasonCodeCount:
        (entry.vote.reasons.traits?.length ?? 0) +
        (entry.vote.reasons.elements?.length ?? 0) +
        (entry.vote.reasons.phase?.length ?? 0) +
        entry.vote.unreadable.length,
    })
    console.log(
      system.padEnd(12),
      String(bytes(before)).padStart(8),
      String(bytes(after)).padStart(8),
      String(bytes(objectForm)).padStart(9),
      factor.padStart(7),
      oFactor.padStart(8),
      String(approxTokens(before)).padStart(8),
      String(approxTokens(after)).padStart(8),
    )
  }

  // Gemini call shape comparison: smoke (tarot) vs bakeoff (tarot) vs bakeoff (saju with Google entry)
  const tarot = computed.systems.find((s) => s.system === 'tarot')!
  const saju = computed.systems.find((s) => s.system === 'saju')!
  const googleEntry = LAYER1_REGISTRY.tarot

  const smokeSystemPrompt = buildLayer1SystemPrompt(LOCALE, 'tarot')
  const smokeUserPrompt = buildLayer1UserPrompt(payloadAfterCurrent(tarot.vote!, ctx), LOCALE, 'tarot')

  const bakeoffTarotSystem = buildLayer1SystemPrompt(LOCALE, 'tarot')
  const bakeoffTarotUser = buildLayer1UserPrompt(payloadAfterCurrent(tarot.vote!, ctx), LOCALE, 'tarot')

  const bakeoffSajuSystem = buildLayer1SystemPrompt(LOCALE, 'saju')
  const bakeoffSajuUser = buildLayer1UserPrompt(payloadAfterCurrent(saju.vote!, ctx), LOCALE, 'saju')

  // Pre-label smoke equivalent (what production had before DEFECT-1)
  const preLabelUser = buildLayer1UserPrompt(payloadBefore(tarot.vote!, ctx), LOCALE, 'tarot')

  function geminiBody(systemPrompt: string, userPrompt: string) {
    return {
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        max_output_tokens: googleEntry.maxCompletionTokens,
        // allowGeminiThinking:true → thinking config present in real path
        thinkingConfig: { includeThoughts: true },
      },
      model: googleEntry.model,
    }
  }

  const smokeBody = geminiBody(smokeSystemPrompt, smokeUserPrompt)
  const bakeoffTarotBody = geminiBody(bakeoffTarotSystem, bakeoffTarotUser)
  const bakeoffSajuBody = geminiBody(bakeoffSajuSystem, bakeoffSajuUser)
  const preLabelBody = geminiBody(smokeSystemPrompt, preLabelUser)

  const out = {
    sizes: rows,
    gemini: {
      note: 'Same callLayer1Model → runSingleAiProvider(google) path for smoke tarot and bakeoff Google. Differences are prompt text + payload only.',
      smokeTarotBytes: bytes(JSON.stringify(smokeBody)),
      bakeoffTarotBytes: bytes(JSON.stringify(bakeoffTarotBody)),
      bakeoffSajuAsGoogleBytes: bytes(JSON.stringify(bakeoffSajuBody)),
      preLabelTarotBytes: bytes(JSON.stringify(preLabelBody)),
      systemPromptBytes: bytes(smokeSystemPrompt),
      smokeEqualsBakeoffTarot: JSON.stringify(smokeBody) === JSON.stringify(bakeoffTarotBody),
      userPromptDiffBytes: bytes(smokeUserPrompt) - bytes(preLabelUser),
      systemPromptContainsTieRule: smokeSystemPrompt.includes('report the tie as a tie'),
      systemPromptContainsNoMachineCodes: smokeSystemPrompt.includes('Never print machine codes'),
    },
    bodies: {
      smokeTarot: smokeBody,
      bakeoffTarot: bakeoffTarotBody,
      bakeoffSajuAsGoogle: bakeoffSajuBody,
      preLabelTarot: preLabelBody,
    },
  }

  const path = join(process.cwd(), 'docs', 'oracle-payload-size-probe.json')
  writeFileSync(path, JSON.stringify(out, null, 2), 'utf8')
  console.log('\nGemini:')
  console.log(`  smoke tarot body bytes:        ${out.gemini.smokeTarotBytes}`)
  console.log(`  bakeoff tarot body bytes:      ${out.gemini.bakeoffTarotBytes}`)
  console.log(`  smoke===bakeoff tarot:         ${out.gemini.smokeEqualsBakeoffTarot}`)
  console.log(`  pre-label tarot body bytes:    ${out.gemini.preLabelTarotBytes}`)
  console.log(`  bakeoff saju-as-Google bytes:  ${out.gemini.bakeoffSajuAsGoogleBytes}`)
  console.log(`  user prompt growth (labels):   +${out.gemini.userPromptDiffBytes} bytes`)
  console.log(`  wrote ${path}`)
}

main()
