import 'server-only'

import type { AiProviderName } from '@/lib/ai/router'
import { KOREAN_ONLY_DIRECTIVE, TRUTH_SEEKING_DIRECTIVE } from '@/lib/motie/deep'

/**
 * JEJU Mode B — SYNOD debate core, COPIED into lib/jeju and PINNED to Korean +
 * governance "expert" mode.
 *
 * WHY THIS FILE EXISTS (isolation rule):
 *   lib/jeju MUST NEVER depend on app/api/synod/*. The proven SYNOD debate
 *   pieces live inside app/api/synod/route.ts (not in a shared lib), so we COPY
 *   the PURE functions here rather than import them. This keeps lib/jeju liftable
 *   to a standalone /jeju site and avoids any regression risk to the live SYNOD
 *   route (which is intentionally left untouched).
 *
 * WHAT WAS COPIED:
 *   - From app/api/synod/route.ts: parse/JSON helpers, the prompt builders, and
 *     the system-prompt constants.
 *   - From lib/synod/build-memory.ts: the pure memory builders + anonymization
 *     helpers + the SynodTurn / FacilitatorSummary types.
 *
 * PINS APPLIED (governance is Korean-only and always "expert" difficulty):
 *   - mode is hardcoded to 'expert' (the governance register), so the mode
 *     parameter is dropped from the copied signatures.
 *   - isKorean is hardcoded to true.
 *   - Every per-call language instruction is replaced by KOREAN_ONLY_DIRECTIVE
 *     imported from lib/jeju/deep.ts (NOT lib/synod/prompt-language — kept self
 *     contained). The JEJU directive is a hard Korean-only lock.
 *
 * NOT COPIED (by design):
 *   - buildVerdictInput / verdictSystemPrompt — JEJU uses its own chair
 *     (renderChairVerdict in lib/jeju/deep.ts) for the final verdict, so the
 *     SYNOD verdict-input builder is intentionally skipped. VERDICT_SYSTEM_BASE
 *     and the verdict-recovery helpers are copied for completeness only (see
 *     comments at each).
 *   - DB loaders (loadPriorSummaries / loadRoundTurns) and any auth/Supabase
 *     code — the future route owns state; these functions are PURE.
 *
 * PURITY AUDIT: every function below is pure (string/regex/array transforms).
 * None reads a DB, network, env, or route. Confirmed during the copy.
 *
 * NEXT STEPS (not in this file): the route (step 3) prepends the pre-debate
 * report text to the USER prompt before each opening/turn call — see the
 * "REPORT-SEEDING INSERTION POINT" comments below. No report-seeding is wired
 * here.
 */

// ════════════════════════════════════════════════════════════════════════════
// Shared types + identity (copied from lib/synod/build-memory.ts + route.ts)
// ════════════════════════════════════════════════════════════════════════════

/** A single AI's contribution within one deliberation round. */
export type SynodTurn = {
  roundNumber: number
  /** Brand name, e.g. "ChatGPT", "Claude". Anonymized to "Participant X" on demand. */
  aiName: string
  /** Optional stance tag the debater took relative to the prior turns. */
  actionTag?: 'AGREE' | 'CHALLENGE' | 'SUPPLEMENT' | 'REFRAME'
  /** Optional one-line distillation of the turn's core claim. */
  claim?: string
  content: string
  /** True when this turn was assigned the adversarial / devil's-advocate role. */
  isRedTeam?: boolean
}

/** The facilitator's compressed, structured summary of one round. */
export type FacilitatorSummary = {
  roundNumber: number
  consensusPoints: { point: string; agreedBy: string[] }[]
  openIssues: { issue: string; positions: { ai: string; stance: string }[] }[]
  /** 0-100; how close the participants are to a single shared answer. */
  roundConsensusScore: number
  /** What the next round should focus on resolving. */
  nextDirective: string
}

/**
 * The reasoning debaters. Perplexity is excluded from debate by design (it is
 * the search/press specialist — see the route + vote panel). 'meta' (Llama) is
 * an ExtendedAiProviderName, so the debater list is widened beyond the base
 * AiProviderName set with this dedicated type.
 */
export type SynodDebaterProvider = AiProviderName | 'meta'

/**
 * RECOVERABLE FLAG — meta (Llama) is disabled.
 *
 * Despite two Korean-only lock passes, Llama keeps leaking non-Korean fragments
 * (讨論, ですが, 游戏, 中國인, और, 社会经济적, 实施…). This is a model-level
 * limitation, not fixable by prompt, so it is removed from the ACTIVE roster.
 * Flip to `true` to re-enable if Llama's Korean improves later — the meta entries
 * in PROVIDER_TO_BRAND / PERSONA / the vote panel are intentionally kept so this
 * is a one-line revert. Keep in sync with ENABLE_META in lib/jeju/deep.ts.
 */
const ENABLE_META = false

/**
 * The reasoning debaters (Perplexity excluded — it searches, not debates).
 * Currently SIX (openai, anthropic, google, xai, deepseek, mistral); meta is
 * appended only when ENABLE_META is true. Consumers MUST read .length, never a
 * hardcoded count.
 */
export const SYNOD_DEBATERS: SynodDebaterProvider[] = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'mistral',
  ...(ENABLE_META ? (['meta'] as SynodDebaterProvider[]) : []),
]

/** Brand names shown in deliberation context / facilitator input. */
export const PROVIDER_TO_BRAND: Record<SynodDebaterProvider, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  meta: 'Llama',
}

export const ACTION_TAGS = ['AGREE', 'CHALLENGE', 'SUPPLEMENT', 'REFRAME'] as const
export type SynodActionTag = (typeof ACTION_TAGS)[number]

/**
 * The governance EXPERT ROLE a debater speaks as (from planJejuMeeting). When
 * supplied to the opening/turn builders, this REPLACES SYNOD's generic consumer
 * PERSONA so the debater argues with professional expertise (전문성) while
 * keeping SYNOD's pointed, named-rebuttal debate mechanics (가독성).
 */
export type DebaterRole = { roleLabel: string; mandate: string }

// ════════════════════════════════════════════════════════════════════════════
// Output parsing helpers (copied verbatim from app/api/synod/route.ts)
// ════════════════════════════════════════════════════════════════════════════

/** Extracts the trailing "CLAIM: <one line>" and returns content without it. */
export function parseClaim(raw: string): { content: string; claim: string | null } {
  const m = raw.match(/^CLAIM:\s*(.+)\s*$/im)
  if (!m) return { content: raw.trim(), claim: null }
  const claim = m[1]!.trim()
  const content = raw.replace(m[0], '').trim()
  return { content, claim: claim || null }
}

/** Extracts a leading "ACTION: <TAG>" line and returns content without it. */
export function parseActionTag(raw: string): { content: string; tag: SynodActionTag | null } {
  const m = raw.match(/^ACTION:\s*(AGREE|CHALLENGE|SUPPLEMENT|REFRAME)\s*$/im)
  if (!m) return { content: raw.trim(), tag: null }
  const tag = m[1]!.toUpperCase() as SynodActionTag
  const content = raw.replace(m[0], '').trim()
  return { content, tag }
}

/** Strips ```json fences and parses JSON; returns null on any failure. */
export function safeParseJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim()
  // Tolerate a missing closing fence (truncated output).
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  // Fall back to the outermost {...} block when the model added prose anyway.
  if (!text.startsWith('{')) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return null
    text = text.slice(start, end + 1)
  }
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Last-resort verdict recovery: when the verdict JSON is truncated/malformed
 * (e.g. long Korean output hits the token cap and the closing brace is lost),
 * salvage the human-readable verdict text instead of failing the session.
 *
 * NOTE: JEJU uses its own chair (renderChairVerdict in lib/jeju/deep.ts); this
 * SYNOD-verdict helper is copied for completeness and may be unused by Mode B.
 */
export function cleanVerdictFallbackText(raw: string): string {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i)
  if (fence && fence[1]) text = fence[1].trim()
  // Pull the "verdict" string value out of a (possibly unterminated) JSON wrapper.
  const m = text.match(/"verdict"\s*:\s*"([\s\S]*?)(?:"\s*,\s*"|"\s*}|$)/)
  if (m && m[1]) {
    return m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim()
  }
  return text
}

/**
 * Replaces EVERY anonymized "Participant X" label anywhere inside a free-text
 * string with its real brand name, using the SAME labelMap that anonymized the
 * verdict input (labelMap maps "Participant A" → "ChatGPT", etc.).
 *
 * NOTE: copied for completeness; JEJU's own chair path may not anonymize.
 */
export function deAnonymizeText(text: string, labelMap: Record<string, string>): string {
  if (!text) return text
  let out = text
  const labels = Object.keys(labelMap).sort((a, b) => b.length - a.length)
  for (const label of labels) {
    if (!label) continue
    out = out.split(label).join(labelMap[label]!)
  }
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// System-prompt constants (copied verbatim from app/api/synod/route.ts)
// ════════════════════════════════════════════════════════════════════════════

export const OUTPUT_TAIL_RULE = `End your response with exactly one final line in this format (this line is mandatory):
CLAIM: <one sentence distilling your core claim>`

/**
 * Anti-impersonation rule: a debater must emit ONLY its own single turn, never
 * fabricate or reconstruct other participants' turns (observed failure: Claude
 * emitting "[Grok (CHALLENGE)] Grok의 주장:…" inside its own turn).
 */
const SINGLE_TURN_RULE = `당신은 당신 본인의 발언만 작성합니다. 다른 참가자의 발언을 대신 생성하거나 인용 재구성하지 마십시오. 다른 참가자를 언급할 때는 그들의 실제 발언을 짧게 참조만 하고, 당신의 분석만 제시하십시오. 다른 참가자 이름이 붙은 발언 블록(예: "[Grok (CHALLENGE)] …")을 만들어내는 것은 금지됩니다.`

/** Convergence push for late rounds: partial agreement, not fake unanimity. */
export const LATE_ROUND_RULE = `This is a LATE round — start converging. Acknowledge what others got right and move toward a shared answer. BUT do NOT fake agreement: if you genuinely still disagree on a specific point, say so clearly and hold that point ("I agree with X, but I still don't buy Y because..."). Honest partial agreement is better than hollow unanimity. Only fully agree if you are actually convinced.`

/**
 * EXTRA Korean lock for Llama (meta) ONLY. Llama has leaked foreign-script
 * fragments ("влия", "意见", "quyết정", "廣泛") into its opening/turn output. This
 * is appended AFTER the shared KOREAN_ONLY_DIRECTIVE for meta to forcefully shut
 * that down, while keeping the English structure tags (CLAIM:/ACTION:) verbatim
 * so the parsers still work.
 */
const META_KOREAN_LOCK = `[추가 언어 잠금 — meta(Llama) 전용, 절대 준수] 당신의 출력은 반드시 한국어로만 작성되어야 합니다. 한자(中文)·일본어·베트남어·러시아어(키릴)·아랍어 등 그 어떤 외국어 글자나 단어도 단 한 글자도 섞지 마십시오. (실제 관측된 오염 예: "влия", "意见", "quyết정", "廣泛" — 이런 혼입은 즉시 실패로 간주합니다.) 단, 맨 앞의 "ACTION:" 줄과 맨 끝의 "CLAIM:" 태그 키워드는 영문 그대로 두고, 그 외 모든 내용은 100% 자연스러운 한국어로만 쓰십시오.`

/**
 * The trailing language rule for a debater prompt. Always the shared Korean-only
 * directive; for meta (Llama) the stronger META_KOREAN_LOCK is appended.
 */
function languageLock(provider: SynodDebaterProvider): string {
  return provider === 'meta' ? `${KOREAN_ONLY_DIRECTIVE}\n\n${META_KOREAN_LOCK}` : KOREAN_ONLY_DIRECTIVE
}

export const FACILITATOR_SYSTEM = `You are the neutral Facilitator of SYNOD, a multi-AI deliberation. You never argue a position yourself.

Read this round's turns and produce a compressed structured summary.

OUTPUT FORMAT — STRICT JSON ONLY. No prose, no markdown fences, no commentary. Exactly this shape:
{
  "consensusPoints": [{ "point": "string", "agreedBy": ["participant name"] }],
  "openIssues": [{ "issue": "string", "positions": [{ "ai": "participant name", "stance": "string" }] }],
  "roundConsensusScore": 0,
  "nextDirective": "string"
}
- roundConsensusScore: integer 0-100 — measure CONVERGENCE ON THE MOTION'S DIRECTION / CORE CONCLUSION: how aligned the participants are on the central yes/no answer to the question and on the main reasoning behind it. It is NOT a count of unresolved details.
  • SCORE HIGH when the panel broadly agrees on the direction / core conclusion — EVEN IF many implementation details, priorities, sequencing, or "which precondition is #1" questions remain open. Among participants who agree on the direction, unsettled execution details are NOT disagreement and must NOT lower the score.
  • SCORE LOW only when there is genuine DIRECTIONAL disagreement — participants are split on the yes/no answer itself or on the central reasoning.
  • Do NOT lower the score simply because the debate surfaced MORE sub-issues as it deepened. More open execution details ≠ less consensus; if anything, a panel that agrees on direction while refining details is converging, not diverging.
- openIssues: still list the unresolved items, but understand their TWO kinds — (1) directional dissent (someone rejects the core yes/no or its central reasoning) which DOES lower the score, and (2) execution/priority/sequencing details ("남은 실행·논의 과제") among people who agree on direction, which do NOT lower the score. Phrase the latter as remaining tasks, not as dissent.
- nextDirective: the single most productive focus for the next round.
- Be faithful: only record consensus that actually exists in the turns. Never invent agreement — a genuine directional split must still score low.`

/**
 * COPIED FOR COMPLETENESS ONLY — NOT USED BY JEJU MODE B.
 * JEJU's final verdict is produced by renderChairVerdict in lib/jeju/deep.ts
 * (a 6-section governance verdict), NOT by this SYNOD verdict schema. Kept here
 * so the copy is faithful and the future route can choose, but the default path
 * is JEJU's chair.
 */
export const VERDICT_SYSTEM_BASE = [
  'You are the Verdict Chair of SYNOD, a multi-AI deliberation. You are Claude Opus 4.8.',
  'Participants are anonymized; judge ideas strictly on their merits. Write the final synthesis of the deliberation — the best consensus answer the group reached, strengthened by your own judgment.',
  'You MUST preserve dissent: if any participant maintained a serious unresolved objection, it belongs in the minority report. Erasing dissent is a failure.',
  'OUTPUT FORMAT — STRICT JSON ONLY. No prose outside the JSON, no markdown fences. Exactly this shape:',
  '{ "verdict": "string — full final synthesis in the question\'s language, ending with sign-off: — Claude Opus 4.8", "minorityReport": [{ "ai": "participant label", "dissent": "string", "reason": "string" }], "finalScore": 0 }',
  '- finalScore: integer 0-100 — the final consensus strength. This is the SINGLE authoritative score shown to the user (the gauge reads finalScore, not the last facilitator round score). Set it consistent with the deliberation: it should reflect where the group actually landed and must NOT diverge wildly from the last facilitator roundConsensusScore unless the final round genuinely shifted consensus.',
  '- minorityReport may be an empty array ONLY if no genuine dissent remained.',
].join('\n\n')

/**
 * Per-debater voice. Applies in BOTH easy and expert modes — persona is about
 * voice, not difficulty.
 *
 * TODO(jeju mode B, later step): these persona descriptions are ENGLISH. They
 * only steer debate *voice* (not correctness), and the hard KOREAN_ONLY_DIRECTIVE
 * still forces Korean OUTPUT. A later polish step may translate/adapt these to a
 * Korean governance register. Left verbatim for now per the copy+pin scope.
 */
const PERSONA: Record<SynodDebaterProvider, string> = {
  openai:
    'You explain things like a great teacher — you take whatever others said and make it crystal clear and easy, using simple everyday examples. You are the one who makes the hard stuff click.',
  anthropic:
    'You are the reflective one who questions assumptions — you often step back and ask whether the question itself is framed wrong, and propose a better angle. Thoughtful, a little contrarian about premises.',
  google:
    "You are the balanced mediator — calm, neutral, fact- and evidence-focused. You find the middle ground and point to what's actually known.",
  xai:
    'You are the cool, slightly cheeky rebel — you push back against the forming consensus with a bit of attitude and wit, but you genuinely want the best answer, not just to be difficult.',
  deepseek:
    'You are sharp, efficient, no-fluff. You cut straight to the point with cold logic. Short and incisive.',
  mistral:
    'You are the playful, artistic one — you bring humor, vivid metaphors, and a creative angle others miss.',
  meta:
    'You are pragmatic and systems-minded — you connect the dots across domains and surface second-order effects and trade-offs others miss. Grounded and direct.',
}

// ════════════════════════════════════════════════════════════════════════════
// Prompt builders (copied from route.ts and PINNED: mode='expert', isKorean=true)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Voice rules for all debaters. PINNED isKorean=true (governance is Korean-only),
 * so the Korean stiff-ending + react examples are always used. The "name the
 * other AI by brand" line is omitted in the opening round (hasPriorParticipants
 * = false), where referencing others is forbidden.
 */
function voiceRules(hasPriorParticipants: boolean): string {
  const stiffRule = `- Write in a lively, human, spoken voice. NO report/essay tone (ban stiff endings like "~할 수 있습니다", "~한 측면이 있습니다", "~한 편이 더 정확합니다").`
  const reactRule = hasPriorParticipants
    ? `- When reacting, name the other AI by brand and hit their point directly: e.g. "GPT는 X라고 했는데, 그건 핵심을 놓쳤어 — 왜냐면...".\n`
    : ''
  return `VOICE RULES (all modes):
${stiffRule}
- Use concrete examples and real situations, not abstract generalities.
- You must sound DIFFERENT from the other participants — that is the point of personas. Sounding identical = failure.
${reactRule}- IMPORTANT: personas add flavor but everyone still argues toward the BEST answer. This is a cooperative search for truth, not a fight. Push back with wit, never hostility.`
}

/**
 * Writing-style block. PINNED to EXPERT mode (the governance register).
 * `hasPriorParticipants` is false for the opening round, where the "react to a
 * prior participant" line would contradict the opening's "do not reference
 * others" rule — that single line is omitted there.
 */
function modeStyleBlock(hasPriorParticipants: boolean): string {
  return `WRITING STYLE (EXPERT MODE):
- Technical depth and academic concepts are allowed; argue rigorously.
- But control length: 8–10 sentences max. Do NOT turn this into an essay with many headings.
- No dry report tone — keep your persona's voice while arguing rigorously.
${hasPriorParticipants ? `- React directly to a specific prior participant's claim first, before adding anything new.\n` : ''}- HALLUCINATION GUARD (critical in this mode): do NOT invent study names, author names, journal names, years, or precise numbers (effect sizes, sample sizes, percentages). Cite specifics ONLY if you are certain. When uncertain, write "a study suggests" without fake citations. Fabricated citations are a serious failure.
- 구체 예산 규모·기간·수치를 단정하지 마십시오. 출처 없는 숫자는 "[추정]"으로 표기하거나 "상당 규모"처럼 정성적으로 표현하고, 검색 결과·공공데이터에 실제 근거가 있을 때만 구체 수치를 제시하십시오.`
}

/**
 * The speaker's IDENTITY block. When a governance `role` is supplied (Mode B),
 * the debater speaks AS that professional expert — this REPLACES the generic
 * consumer PERSONA so debate content is expert-grade. With no role, the original
 * SYNOD persona block is used (backward-compatible). The lively voice/rebuttal
 * mechanics below are unchanged in both cases.
 */
function identityBlock(provider: SynodDebaterProvider, role?: DebaterRole): string {
  if (role) {
    return `전문가 정체성 — 당신은 이 심의에서 다음 전문가 역할을 맡습니다:
- 역할: ${role.roleLabel}
- 임무: ${role.mandate}
이 역할의 전문성과 관점에서 논증하세요 — 일반 소비자의 일상적 감상이 아니라, 해당 분야 전문가로서 데이터·근거로 말합니다. (단, 말투는 아래 규칙대로 생생하고 직설적으로. 전문가의 품격은 유지하되 딱딱한 보고서 문체는 금지.)`
  }
  return `PERSONA — your voice (stay in character while arguing substantively):
${PERSONA[provider]}`
}

/**
 * Opening-round system prompt for one debater. PINNED: mode='expert',
 * isKorean=true, and the trailing language rule is KOREAN_ONLY_DIRECTIVE.
 *
 * `role` (Mode B): the governance expert role this brand was assigned by
 * planJejuMeeting — injected as the speaker's identity (replaces PERSONA).
 *
 * REPORT-SEEDING INSERTION POINT (handled later, in the route — NOT here):
 *   The pre-debate governance report is prepended to the USER prompt (the
 *   message passed to runSingleAiProvider), so this SYSTEM prompt is unchanged
 *   by seeding. Do not add report text inside this function.
 */
export function openingSystemPrompt(provider: SynodDebaterProvider, role?: DebaterRole): string {
  return `You are participating in SYNOD, a structured multi-AI deliberation. You are ${PROVIDER_TO_BRAND[provider]}.

${TRUTH_SEEKING_DIRECTIVE}

${identityBlock(provider, role)}

This is the OPENING round. Give your own independent, well-reasoned opinion on the user's question.
Rules:
- Do NOT reference, imagine, or speculate about any other participant's answer. You have not seen any.
- Take a clear position. Hedging on every point is a failure.
- Respond in the same language as the question.
- Keep it focused: your strongest reasoning only, no filler.

${voiceRules(false)}

${modeStyleBlock(false)}

${OUTPUT_TAIL_RULE}

${languageLock(provider)}`
}

/**
 * Per-round debate-turn system prompt. PINNED: mode='expert', isKorean=true,
 * trailing language rule = KOREAN_ONLY_DIRECTIVE. Red-team branch is preserved.
 *
 * REPORT-SEEDING INSERTION POINT (handled later, in the route — NOT here):
 *   same as openingSystemPrompt — the report is prepended to the USER prompt.
 */
export function turnSystemPrompt(
  provider: SynodDebaterProvider,
  isRedTeam: boolean,
  roundNumber: number,
  role?: DebaterRole
): string {
  // Convergence push engages from round 3 — JEJU Mode B converges/stops within a
  // 3–5 round window (vs SYNOD's later cap), so the late-round rule must be live
  // during the rounds that actually decide the outcome, not only from round 4.
  const lateBlock = roundNumber >= 3 ? `\n${LATE_ROUND_RULE}\n` : ''
  if (isRedTeam) {
    return `You are participating in SYNOD, a structured multi-AI deliberation. You are ${PROVIDER_TO_BRAND[provider]}. This round you are the STRESS-TESTER (quality control).

${TRUTH_SEEKING_DIRECTIVE}

${identityBlock(provider, role)}

Your job this round is QUALITY CONTROL, NOT opposition. You are NOT assigned to argue for or against the motion, and you must NOT perform a stance. Pressure-test the OTHERS' reasoning for genuine weaknesses — unexamined assumptions, missing evidence, weak logic, overlooked risks or second-order effects — and press the single most important real weakness precisely.
Rules:
- You MUST begin your response with exactly one line: "ACTION: CHALLENGE"
- If, after honest scrutiny, the reasoning is actually sound, SAY SO and help sharpen it — do NOT manufacture a disagreement. Inventing opposition for its own sake is a failure.
- Target the reasoning on its merits — evidence, logic, blind spots — never the style, and never a conclusion you feel you "should" reach.
- Respond in the same language as the question.
${SINGLE_TURN_RULE}
${lateBlock}
${voiceRules(true)}

${modeStyleBlock(true)}

${OUTPUT_TAIL_RULE}

${languageLock(provider)}`
  }
  return `You are participating in SYNOD, a structured multi-AI deliberation. You are ${PROVIDER_TO_BRAND[provider]}. Other participants have spoken; their positions and the facilitator's summary are in the context. Address them by brand name.

${TRUTH_SEEKING_DIRECTIVE}

${identityBlock(provider, role)}

You MUST begin your response with exactly one line declaring your move:
"ACTION: AGREE" | "ACTION: CHALLENGE" | "ACTION: SUPPLEMENT" | "ACTION: REFRAME"
- AGREE: you endorse the forming consensus (say precisely what convinced you).
- CHALLENGE: you attack a specific claim (quote or paraphrase it, then refute it).
- SUPPLEMENT: you add a materially new argument, evidence, or dimension.
- REFRAME: you argue the question itself is being approached wrongly and propose a better frame.

Decide 찬성/반대/유보 honestly from the data and your domain — do not perform a side. Be STUBBORN about your own reasoning: do not abandon a position you previously took unless the context contains a genuinely stronger argument — and if you do concede, name exactly which argument changed your mind. Drifting toward the majority without cause is a failure; so is clinging to a position the evidence has refuted.
Respond in the same language as the question.
${SINGLE_TURN_RULE}
${lateBlock}
${voiceRules(true)}

${modeStyleBlock(true)}

${OUTPUT_TAIL_RULE}

${languageLock(provider)}`
}

/**
 * Facilitator system prompt. PINNED with KOREAN_ONLY_DIRECTIVE. The language
 * rule applies to the JSON STRING VALUES (point/issue/stance/nextDirective); the
 * JSON FIELD NAMES stay in English exactly as the schema specifies.
 */
export function facilitatorSystemPrompt(): string {
  return `${FACILITATOR_SYSTEM}

${KOREAN_ONLY_DIRECTIVE}
NOTE: This language rule applies to the STRING VALUES inside the JSON (e.g. each "point", "issue", "stance", "nextDirective"). The JSON FIELD NAMES must stay in English exactly as specified above.`
}

// ════════════════════════════════════════════════════════════════════════════
// Anonymization helpers (copied verbatim from lib/synod/build-memory.ts) — PURE
// ════════════════════════════════════════════════════════════════════════════

type Labeler = {
  /** Maps a real brand name to its display name (label when anonymizing, else itself). */
  disp: (aiName: string) => string
  /** label -> real aiName, e.g. { "Participant A": "Claude" }. Empty when not anonymizing. */
  labelMap: Record<string, string>
}

/** Stable label for the Nth distinct participant: A, B, ... Z, then Participant 27+. */
function labelForIndex(i: number): string {
  if (i < 26) return `Participant ${String.fromCharCode(65 + i)}`
  return `Participant ${i + 1}`
}

/**
 * Builds a labeler. When `anonymize` is false it is the identity mapping with an
 * empty labelMap. When true, distinct names are assigned Participant A/B/C... in
 * order of first appearance in `names`, so the same call produces a stable map.
 */
function makeLabeler(names: string[], anonymize: boolean): Labeler {
  if (!anonymize) {
    return { disp: (n) => n, labelMap: {} }
  }
  const ordered: string[] = []
  for (const n of names) {
    if (n && !ordered.includes(n)) ordered.push(n)
  }
  const realToLabel = new Map<string, string>()
  const labelMap: Record<string, string> = {}
  ordered.forEach((real, i) => {
    const label = labelForIndex(i)
    realToLabel.set(real, label)
    labelMap[label] = real
  })
  return {
    disp: (n) => realToLabel.get(n) ?? n,
    labelMap,
  }
}

/** Collects every brand name referenced by a set of turns, in appearance order. */
function namesFromTurns(turns: SynodTurn[]): string[] {
  return turns.map((t) => t.aiName)
}

/** Collects every brand name referenced inside facilitator summaries, in order. */
function namesFromSummaries(summaries: FacilitatorSummary[]): string[] {
  const out: string[] = []
  for (const s of summaries) {
    for (const cp of s.consensusPoints) out.push(...cp.agreedBy)
    for (const oi of s.openIssues) for (const p of oi.positions) out.push(p.ai)
  }
  return out
}

// ════════════════════════════════════════════════════════════════════════════
// Rendering helpers (copied verbatim from lib/synod/build-memory.ts) — PURE
// ════════════════════════════════════════════════════════════════════════════

/** Full, human-readable rendering of a facilitator summary (names via `disp`). */
function renderSummaryFull(s: FacilitatorSummary, disp: (n: string) => string): string {
  const lines: string[] = []
  lines.push(`Round ${s.roundNumber} facilitator summary — consensus score ${s.roundConsensusScore}/100`)

  if (s.consensusPoints.length) {
    lines.push('Consensus points:')
    for (const cp of s.consensusPoints) {
      const by = cp.agreedBy.map(disp).join(', ') || 'unspecified'
      lines.push(`  - ${cp.point} (agreed by: ${by})`)
    }
  } else {
    lines.push('Consensus points: none yet.')
  }

  if (s.openIssues.length) {
    lines.push('Open issues:')
    for (const oi of s.openIssues) {
      lines.push(`  - ${oi.issue}`)
      for (const p of oi.positions) {
        lines.push(`      • ${disp(p.ai)}: ${p.stance}`)
      }
    }
  } else {
    lines.push('Open issues: none.')
  }

  lines.push(`Next directive: ${s.nextDirective}`)
  return lines.join('\n')
}

/**
 * One-line collapse of an OLD facilitator summary — the token-saving form.
 * Only the consensus-point headlines + the score survive; open issues, agreedBy
 * lists, positions, and the directive are intentionally dropped.
 */
function renderSummaryOneLine(s: FacilitatorSummary): string {
  const headlines = s.consensusPoints.map((cp) => cp.point).join('; ') || '(no consensus recorded)'
  return `Round ${s.roundNumber} (score ${s.roundConsensusScore}/100): ${headlines}`
}

/** Renders a single debate turn with its tags (names via `disp`). */
function renderTurn(t: SynodTurn, disp: (n: string) => string): string {
  const tags: string[] = []
  if (t.isRedTeam) tags.push('STRESS-TEST')
  if (t.actionTag) tags.push(t.actionTag)
  const tagStr = tags.length ? ` (${tags.join(' · ')})` : ''
  const head = `[${disp(t.aiName)}${tagStr}]`
  const claimLine = t.claim ? `\nClaim: ${t.claim}` : ''
  return `${head}${claimLine}\n${t.content.trim()}`
}

// ════════════════════════════════════════════════════════════════════════════
// Public memory builders (copied verbatim from lib/synod/build-memory.ts) — PURE
// ════════════════════════════════════════════════════════════════════════════

/**
 * Rough token estimate for debugging / context-size logging.
 * Uses the common ~4-chars-per-token heuristic. Intentionally cheap and pure.
 */
export function countApproxTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/**
 * Builds the context injected into each debater's prompt for the current round.
 *
 * COMPRESSION CORE (do not weaken):
 *   • priorSummaries are sorted by round; the LATEST one is rendered IN FULL.
 *   • EVERY OLDER summary is collapsed to a single headline line.
 *   • Raw prior-round transcripts are NEVER included — only summaries.
 *
 * `currentRoundTurns` are the turns already spoken THIS round (serial flow), so
 * the next speaker can react; these are shown in full because they are the live,
 * not-yet-summarized state.
 *
 * Returns `{ text, labelMap }`. When `anonymize` is true, every aiName is
 * replaced with a stable "Participant X" label and `labelMap` maps each label
 * back to the real brand name; otherwise `labelMap` is empty.
 */
export function buildDeliberationContext(params: {
  question: string
  priorSummaries: FacilitatorSummary[]
  currentRoundTurns: SynodTurn[]
  anonymize: boolean
}): { text: string; labelMap: Record<string, string> } {
  const { question, priorSummaries, currentRoundTurns, anonymize } = params

  const allNames = [...namesFromTurns(currentRoundTurns), ...namesFromSummaries(priorSummaries)]
  const { disp, labelMap } = makeLabeler(allNames, anonymize)

  const sorted = [...priorSummaries].sort((a, b) => a.roundNumber - b.roundNumber)

  const sections: string[] = []
  sections.push(`QUESTION:\n${question.trim()}`)

  if (sorted.length) {
    const historyLines: string[] = [
      'DELIBERATION HISTORY (compressed to control token cost: older rounds are one',
      'line each; ONLY the most recent facilitator summary is shown in full):',
      '',
    ]

    const older = sorted.slice(0, -1)
    for (const s of older) {
      historyLines.push(renderSummaryOneLine(s))
    }

    const latest = sorted[sorted.length - 1]!
    if (older.length) historyLines.push('')
    historyLines.push(renderSummaryFull(latest, disp))

    sections.push(historyLines.join('\n'))
  } else {
    sections.push('DELIBERATION HISTORY:\n(This is the first round — no prior summaries.)')
  }

  if (currentRoundTurns.length) {
    const turnLines = ['THIS ROUND SO FAR (serial — read and react to what was already said):']
    for (const t of currentRoundTurns) {
      turnLines.push('')
      turnLines.push(renderTurn(t, disp))
    }
    sections.push(turnLines.join('\n'))
  } else {
    sections.push('THIS ROUND SO FAR:\n(You are the first to speak this round.)')
  }

  return { text: sections.join('\n\n'), labelMap }
}

/**
 * Builds the input the facilitator reads to produce a FacilitatorSummary for
 * `roundNumber`. Prior rounds are given ONLY as a one-line score recap; this
 * round's turns are included IN FULL because the facilitator compresses them.
 * Names are kept real here — the facilitator is neutral and benefits from identity.
 */
export function buildFacilitatorInput(params: {
  question: string
  roundNumber: number
  allTurnsThisRound: SynodTurn[]
  priorSummaries: FacilitatorSummary[]
}): string {
  const { question, roundNumber, allTurnsThisRound, priorSummaries } = params
  const disp = (n: string) => n // facilitator sees real brand names

  const sections: string[] = []
  sections.push(`QUESTION:\n${question.trim()}`)

  const sorted = [...priorSummaries].sort((a, b) => a.roundNumber - b.roundNumber)
  if (sorted.length) {
    const recap = sorted
      .map((s) => `Round ${s.roundNumber}: consensus score ${s.roundConsensusScore}/100`)
      .join('\n')
    sections.push(`PRIOR ROUNDS (score recap only):\n${recap}`)
  } else {
    sections.push('PRIOR ROUNDS (score recap only):\n(None — this is round 1.)')
  }

  const turnLines = [`ROUND ${roundNumber} — ALL TURNS (full text, summarize these):`]
  for (const t of allTurnsThisRound) {
    turnLines.push('')
    turnLines.push(renderTurn(t, disp))
  }
  sections.push(turnLines.join('\n'))

  sections.push(
    [
      'TASK:',
      'Produce a FacilitatorSummary for this round: list consensusPoints (with who',
      "agreed), openIssues (with each participant's stance), a roundConsensusScore",
      '(0-100), and a nextDirective for the following round.',
      '',
      'SCORING REMINDER: roundConsensusScore reflects convergence on the MOTION\'S',
      'DIRECTION / core yes-no conclusion — NOT whether every implementation detail is',
      'settled. If the participants agree on the direction but each pushes a different',
      'priority / precondition / sequencing (e.g. "which precondition is #1"), that is',
      'AGREED DIRECTION WITH OPEN EXECUTION DETAILS → keep the score HIGH and list those',
      'as remaining tasks. Lower the score ONLY for genuine directional disagreement',
      '(split on yes vs no or the central reasoning). Do not let the score fall just',
      'because more sub-issues surfaced as the debate deepened.',
    ].join('\n')
  )

  return sections.join('\n\n')
}
