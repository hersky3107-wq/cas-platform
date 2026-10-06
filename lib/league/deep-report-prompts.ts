/**
 * Prompt builders for the deep report. Every seat replies with one JSON
 * object. Debaters never receive the 40-seat vote aggregate. The chair does.
 */
import type { LeagueLocale } from './i18n/locales'
import { OUTPUT_LANGUAGE_NAME } from './output-language-name'
import { RESEARCH_ANGLES, languageLockLine, type DebateSide, type PlannedQuery } from './deep-report-policy'
import { REPORT_TEXT_LIMITS as L } from './deep-report-structured'

export type SideWords = { yes: string; no: string }

function sideLine(words: SideWords): string {
  return `YES means "${words.yes}". NO means "${words.no}".`
}

/** Text fields reach readers verbatim. */
function readerRule(words: SideWords): string {
  return `Every text field is shown to readers as written: name the sides only as "${words.yes}" / "${words.no}" (never YES/NO), never write evidence ids (E1, E2, …) inside text — put them only in "ref" — and use no markdown.`
}

export const RESEARCH_SYSTEM_PROMPT =
  'You are a research assistant. Search the web, then reply with ONE JSON object only. Never invent a date, a number, or a source.'

export function researchSeatPrompt(input: {
  locale: LeagueLocale
  proposition: string
  sideWords: SideWords
  queries: PlannedQuery[]
}): string {
  const language = OUTPUT_LANGUAGE_NAME[input.locale]
  return [
    languageLockLine(input.locale),
    `Proposition: ${input.proposition}`,
    sideLine(input.sideWords),
    '',
    'Run every query below. Return ONLY this JSON object:',
    '{"findings":[{"claim":"…","date":"YYYY-MM-DD"|null,"source_title":"…","source_url":"https://…"|null,"tier":"official|regulator|major_outlet|rumor|other","side":"yes|no|context","query_key":"…"}]}',
    'Rules:',
    `- One verifiable fact per finding: one complete sentence, at most 200 characters, in ${language}.`,
    '- claim is the fact itself. Never put headings, query labels, table rows, or "none found" in claim. A query that finds nothing adds no finding.',
    '- source_title names the publisher or document (e.g. "Bloomberg", "Samsung Newsroom"). Skip any fact you cannot attribute to a real source.',
    '- source_url is the page URL when you have it, else null.',
    '- date is the event or publication date as YYYY-MM-DD (or YYYY-MM) when stated, else null.',
    '- tier: official = the company or organizer itself; regulator = a government body or regulator; major_outlet = national or wire press; rumor = leaks, tipsters, unconfirmed reports; other = everything else.',
    '- side: yes when the fact makes YES more likely, no when it makes NO more likely, context otherwise.',
    `- query_key: the id of the query that found it (${RESEARCH_ANGLES.join(', ')}).`,
    '- At most 25 findings, no duplicates. No prose outside the JSON.',
    '',
    'Queries:',
    ...input.queries.map((row) => `- ${row.angle} (${row.lang}): ${row.text}`),
  ].join('\n')
}

export const DEBATER_SYSTEM_PROMPT =
  'You are one debater on a six-AI panel. Use only the material you are given. Reply with ONE JSON object only — no markdown, no prose outside it.'

export const CHAIR_SYSTEM_PROMPT =
  'You chair a six-AI debate. Judge it fairly and reply with ONE JSON object only — no markdown, no prose outside it.'

function probabilityRule(): string {
  return 'final_probability is the chance (50–100) that YOUR final_side is right. final_side is your own honest view after weighing everything — it may differ from the side you were assigned.'
}

export function openingUserPrompt(input: {
  locale: LeagueLocale
  proposition: string
  packet: string
  evidence: string
  side: DebateSide
  sideWords: SideWords
  model: string
}): string {
  const word = input.side === 'yes' ? input.sideWords.yes : input.sideWords.no
  return [
    languageLockLine(input.locale),
    `Round 1. You are ${input.model}. You are assigned to argue the ${input.side.toUpperCase()} side ("${word}"). Make the strongest honest case for it.`,
    sideLine(input.sideWords),
    probabilityRule(),
    'Use only the closed-book packet and the evidence list. Cite evidence by its id (E1, E2, …) in "ref". Do not invent facts, dates, or numbers.',
    readerRule(input.sideWords),
    'Do not mention league ballots or other seats outside this debate.',
    'Return ONLY this JSON:',
    `{"headline":"<one line, at most ${L.headline} characters>","points":[{"text":"<at most ${L.point} characters>","ref":"E1"|null},{"text":"…","ref":…},{"text":"…","ref":…}],"final_side":"yes|no","final_probability":50-100}`,
    'Exactly 3 points, strongest first. Plain sentences, no markdown.',
    '',
    '[Proposition]',
    input.proposition,
    '',
    '[Closed-book packet]',
    input.packet,
    '',
    '[Evidence list]',
    input.evidence,
  ].join('\n')
}

export function rebuttalUserPrompt(input: {
  locale: LeagueLocale
  proposition: string
  packet: string
  evidence: string
  side: DebateSide
  sideWords: SideWords
  ownOpening: string
  opponentName: string
  opponentModel: string
  opponentOpening: string
}): string {
  const word = input.side === 'yes' ? input.sideWords.yes : input.sideWords.no
  return [
    languageLockLine(input.locale),
    `Round 2. You argued the ${input.side.toUpperCase()} side ("${word}"). You are paired with ${input.opponentName} (${input.opponentModel}).`,
    `Quote ONE specific claim from that opponent's opening, at most ${L.quotedClaim} characters, copied from their words. Then rebut that claim.`,
    `target_model must be "${input.opponentModel}" or "${input.opponentName}".`,
    sideLine(input.sideWords),
    'Put evidence ids (E1, E2, …) only in evidence_refs. Do not invent facts, dates, or numbers.',
    readerRule(input.sideWords),
    'Do not mention league ballots or other seats outside this pair.',
    'Return ONLY this JSON:',
    `{"target_model":"${input.opponentModel}","quoted_claim":"<at most ${L.quotedClaim} characters, copied from their opening>","rebuttal":"<at most ${L.rebuttalBody} characters>","evidence_refs":["E1"]}`,
    'evidence_refs has at least one id from the evidence list. Plain sentences, no markdown.',
    '',
    '[Proposition]',
    input.proposition,
    '',
    '[Closed-book packet]',
    input.packet,
    '',
    '[Evidence list]',
    input.evidence,
    '',
    '[Your opening]',
    input.ownOpening,
    '',
    `[${input.opponentName} opening]`,
    input.opponentOpening,
  ].join('\n')
}

export function counterUserPrompt(input: {
  locale: LeagueLocale
  proposition: string
  packet: string
  evidence: string
  side: DebateSide
  sideWords: SideWords
  opponentName: string
  opponentModel: string
  quotedClaim: string
  rebuttal: string
}): string {
  const word = input.side === 'yes' ? input.sideWords.yes : input.sideWords.no
  return [
    languageLockLine(input.locale),
    `Round 3. You argued the ${input.side.toUpperCase()} side ("${word}"). ${input.opponentName} (${input.opponentModel}) rebutted one claim of yours.`,
    'Answer that rebuttal in at most two sentences. stance is "concede" when you accept the point, "partial" when you accept part of it, or "defend" when you hold your claim.',
    'A concede or partial reply should say so in the reply itself. A defend or partial reply must cite evidence ids in evidence_refs.',
    sideLine(input.sideWords),
    probabilityRule(),
    `If the debate moved you to the other side, set changed_mind true and say why in why_changed (at most ${L.whyChanged} characters); otherwise changed_mind false and why_changed null.`,
    readerRule(input.sideWords),
    `replies_to_model must be "${input.opponentModel}" or "${input.opponentName}".`,
    'Return ONLY this JSON:',
    `{"replies_to_model":"${input.opponentModel}","stance":"concede|partial|defend","reply":"<at most ${L.reply} characters>","evidence_refs":["E1"],"final_side":"yes|no","final_probability":50-100,"changed_mind":true|false,"why_changed":"…"|null}`,
    '',
    '[Proposition]',
    input.proposition,
    '',
    '[Closed-book packet]',
    input.packet,
    '',
    '[Evidence list]',
    input.evidence,
    '',
    '[The claim they quoted]',
    input.quotedClaim,
    '',
    '[Their rebuttal]',
    input.rebuttal,
  ].join('\n')
}

/**
 * After the counter-replies. The model is not told which side it was assigned.
 * The transcript passed in must also omit that assignment.
 */
export function blindRevoteUserPrompt(input: {
  locale: LeagueLocale
  proposition: string
  packet: string
  evidence: string
  transcript: string
}): string {
  return [
    languageLockLine(input.locale),
    'You are a neutral referee. Drop every earlier side and judge the proposition only from the transcript and the dossier.',
    'Do not defend a position from the debate. Return the side you now believe, with the chance that side is right.',
    'Return ONLY this JSON:',
    '{"side":"yes|no","probability":50-100,"one_line_reason":"<one sentence>"}',
    '',
    '[Proposition]',
    input.proposition,
    '',
    '[Dossier]',
    input.evidence,
    '',
    '[Closed-book packet]',
    input.packet,
    '',
    '[Full transcript]',
    input.transcript,
  ].join('\n')
}

export function chairUserPrompt(input: {
  locale: LeagueLocale
  proposition: string
  packet: string
  evidence: string
  debate: string
  fortySeatAggregate: string
  categoryNote: string
  sideWords: SideWords
  /** Positions still held at the end of the debate, before the blind re-vote. */
  stanceTally?: string
  /** The blind re-vote, taken after every side assignment was dropped. */
  revoteTally?: string
}): string {
  return [
    languageLockLine(input.locale),
    'You are the chair. Judge the debate below and give the panel verdict. Unscored commentary. Not investment advice.',
    sideLine(input.sideWords),
    'verdict_probability is the chance (50–100) that verdict_side is right.',
    'Refer to debaters by the brand names used in the debate (ChatGPT, Claude, Gemini, Grok, DeepSeek, Mistral).',
    'key_evidence rows must come from the evidence list; keep each row\'s ref. Do not invent dates or numbers.',
    readerRule(input.sideWords),
    'In text fields, call the 40-seat result "the 40 AIs", written in the output language.',
    'vs_40ai.relation: "opposite" when your verdict side differs from the 40-AI side; otherwise "stronger" when your probability is above the 40-AI confidence, else "weaker".',
    input.categoryNote,
    'Return ONLY this JSON:',
    [
      '{',
      '"verdict_side":"yes|no","verdict_probability":50-100,',
      `"one_line":"<the verdict in one plain sentence, at most ${L.oneLine} characters>",`,
      `"vs_40ai":{"ai40_side":"yes|no","ai40_confidence":0-100,"relation":"stronger|weaker|opposite","why":"<only the reason for the difference — do not restate the direction — at most ${L.vsWhy} characters>"},`,
      `"key_evidence":[{"claim":"<at most ${L.evidenceClaim} characters>","source":"<publisher>","date":"YYYY-MM-DD"|null,"tier":"official|regulator|major_outlet|rumor|other","ref":"E1"} — exactly 5],`,
      `"debate_judgment":["<at most ${L.judgment} characters. At least one line must name both debaters in one exchange: who quoted whom, and whether the reply conceded, partly conceded, or held>" — exactly 3],`,
      `"minority_view":"<the best case for the losing side, at most ${L.minority} characters>",`,
      `"flip_triggers":[{"event":"<a concrete event that would flip the verdict, at most ${L.trigger} characters>","by_date":"YYYY-MM-DD"} — exactly 3],`,
      `"scenarios":[{"name":"<at most ${L.scenario} characters>","weight":0-100} — at most 3, weights sum to 100]`,
      '}',
    ].join('\n'),
    '',
    '[Proposition]',
    input.proposition,
    '',
    '[Closed-book packet]',
    input.packet,
    '',
    '[Evidence list]',
    input.evidence,
    '',
    '[Debate]',
    input.debate,
    '',
    '[40-seat aggregate and distribution]',
    input.fortySeatAggregate,
    '',
    '[Positions during the debate]',
    input.stanceTally ?? '(none)',
    '',
    '[Blind re-vote]',
    input.revoteTally ?? '(none)',
  ].join('\n')
}
