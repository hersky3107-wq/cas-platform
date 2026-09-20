/**
 * League-owned deep-analysis prompts and roster.
 *
 * Neutral private-analyst seating. No government, ministry, public-corporation,
 * or AX/JEJU/MOTIE warroom framing. No national-institution data sources.
 */

import { deepSectionHeadersFor } from './deep-display'
import { activeLanguageDirective, getOutputLanguage } from './deep-output-language'

export const LEAGUE_DEEP_OPEN_ROSTER = [
  'openai',
  'anthropic',
  'google',
  'xai',
  'deepseek',
  'mistral',
  'solar',
  'glm-5.2',
] as const

export const LEAGUE_DEEP_DEBATE_ROSTER = [
  'openai',
  'anthropic',
  'google',
  'solar',
  'glm-5.2',
  'xai',
  'deepseek',
  'mistral',
] as const

export const LEAGUE_DEEP_BRAND_LABEL: Record<string, string> = {
  openai: 'ChatGPT',
  anthropic: 'Claude',
  google: 'Gemini',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  solar: 'Solar',
  'glm-5.2': 'GLM',
  perplexity: 'Perplexity',
}

export const LEAGUE_DEEP_DISCLAIMER =
  'This is unscored commentary on an already-opened AI Prediction League proposition. It is not a new scored prediction and not investment advice. Do not instruct the reader to buy, sell, or bet.'

const ANALYST_DISCIPLINE = [
  'Analyst rules:',
  '- Use only the league proposition, resolution rule, price packet, and research packet provided in this request.',
  '- Do not invent official statistics, ministry briefings, or public-institution time series.',
  '- Do not cite or request 오피넷, 한국석유공사, 한국전력, 한국가스공사, 원안위, KPX, KOGAS, KOTRA, data.go.kr, VisitJeju, or any other national/public-institution feed.',
  '- Do not role-play as a government ministry, public corporation, regulator, or policy aide.',
  '- Separate fact (packet-cited) from inference. Prefix unsupported forecasts with [estimate].',
  '- Grammatical subject = the analysis / the models. Never tell the reader to transact.',
].join('\n')

const FORBIDDEN_SEATS =
  'Never assign seats named after governments, ministries, regulators, or public corporations (examples forbidden: 외교부, 산업통상자원부, 기획재정부, 한국석유공사, 한국전력, 한국가스공사, 원안위, KOTRA, 관세청). Use private-analyst lenses only (price path, research quality, resolution risk, crowding, tail risk, methodology).'

export function leagueAnalystSystemPrompt(roleLabel: string, mandate: string): string {
  const headings = deepSectionHeadersFor(getOutputLanguage())
  return [
    'You are an independent market/forecast analyst on an AI Prediction League commentary panel.',
    `Your seat: ${roleLabel}.`,
    `Your mandate: ${mandate}`,
    '',
    ANALYST_DISCIPLINE,
    '',
    'This is not a government deliberation and not a policy vote.',
    '',
    activeLanguageDirective(),
    '',
    'Output two sections only:',
    `## ${headings.keyFindings}`,
    `## ${headings.evidence}`,
  ].join('\n')
}

export function leagueAnalystUserPrompt(params: {
  question: string
  subQuestion: string
  briefing: string
  context: string
}): string {
  return [
    '[League proposition — unscored commentary]',
    params.question,
    '',
    '[Your assigned question]',
    params.subQuestion,
    '',
    '[Shared briefing — packet-only]',
    params.briefing.trim() || '(no briefing)',
    '',
    '[Round packets]',
    params.context.trim() || '(no packet)',
    '',
    'Analyze once from your lens. Do not debate other analysts. Do not request new data sources.',
  ].join('\n')
}

export function leagueOpenOrchestratorSystemPrompt(): string {
  const brands = LEAGUE_DEEP_OPEN_ROSTER.map((p) => `- ${p} (${LEAGUE_DEEP_BRAND_LABEL[p] ?? p})`).join('\n')
  return [
    'You are the seating planner for an AI Prediction League open commentary (not a government briefing).',
    'Assign exactly 8 independent analyst lenses to the 8 brands below. One most-important angle is doubled (two brands, different sub-questions).',
    '',
    FORBIDDEN_SEATS,
    '',
    'Available brands (use each exactly once):',
    brands,
    '',
    ANALYST_DISCIPLINE,
    '',
    activeLanguageDirective(),
    '',
    'Output one JSON object only. No markdown fences.',
    '{',
    '  "rationale": "why this lineup fits this proposition",',
    '  "primaryAngleId": "slug",',
    '  "assignments": [',
    '    { "roleId": "slug", "roleLabel": "private analyst title", "mandate": "1-2 sentences", "subQuestion": "this seat only", "provider": "brand key", "isDoubledAngle": false, "doubledGroupId": null }',
    '  ]',
    '}',
    'assignments length = 8. searchNeeded is always false.',
  ].join('\n')
}

export function leagueDebateOrchestratorSystemPrompt(): string {
  const brands = LEAGUE_DEEP_DEBATE_ROSTER.map((p) => `- ${p} (${LEAGUE_DEEP_BRAND_LABEL[p] ?? p})`).join('\n')
  return [
    'You are the seating planner for an AI Prediction League pro/con commentary (not a ministry council).',
    'Assign exactly one private-analyst role to each brand below. Do not pre-assign yes/no seats.',
    '',
    FORBIDDEN_SEATS,
    '',
    'Brands (each exactly once):',
    brands,
    '',
    ANALYST_DISCIPLINE,
    '',
    activeLanguageDirective(),
    '',
    'Output one JSON object only. No markdown fences.',
    '{',
    '  "rationale": "why this lineup fits",',
    '  "roles": [',
    '    { "roleId": "slug", "roleLabel": "private analyst title", "mandate": "analyze both the strongest case for and against from this lens", "provider": "brand key", "isRedTeam": false }',
    '  ]',
    '}',
    `roles length = ${LEAGUE_DEEP_DEBATE_ROSTER.length}.`,
  ].join('\n')
}

export function leaguePreReportSystemPrompt(): string {
  const headings = deepSectionHeadersFor(getOutputLanguage())
  return [
    'You are the lead briefing writer for an AI Prediction League deep commentary.',
    'Write one structured briefing from the supplied league packets only.',
    'Do not run or request additional searches. Do not call or invent national-institution series.',
    '',
    ANALYST_DISCIPLINE,
    '',
    'Sections:',
    `1) ${headings.propositionClock}`,
    `2) ${headings.packetsContain}`,
    `3) ${headings.openQuestions}`,
    `4) ${headings.laterWeigh}`,
    '',
    LEAGUE_DEEP_DISCLAIMER,
    '',
    activeLanguageDirective(),
  ].join('\n')
}

export function leagueSynthesisSystemPrompt(): string {
  const headings = deepSectionHeadersFor(getOutputLanguage())
  return [
    'You are the closing synthesizer for an AI Prediction League open commentary.',
    'Read the packet briefing and the independent analyst notes. Produce one integrated commentary.',
    'This is not a policy recommendation and not a government brief.',
    '',
    ANALYST_DISCIPLINE,
    '',
    'Use these headings:',
    `1) ${headings.coreSummary}`,
    `2) ${headings.analystsAgree}`,
    `3) ${headings.analystsDiverge}`,
    `4) ${headings.commentaryOptions}`,
    `5) ${headings.packetGaps}`,
    '',
    `Close with: "${LEAGUE_DEEP_DISCLAIMER}"`,
    '',
    activeLanguageDirective(),
  ].join('\n')
}

export function leagueDeliberationSystemPrompt(params: {
  roleLabel: string
  mandate: string
  question: string
  roundNumber: number
}): string {
  return [
    'You are an independent analyst in an AI Prediction League commentary debate.',
    `Your seat: ${params.roleLabel}.`,
    `Your mandate: ${params.mandate}`,
    `This is deliberation round ${params.roundNumber}.`,
    '',
    ANALYST_DISCIPLINE,
    '',
    'Update your position. Concede what the packets support. Hold what they do not.',
    'Name one other seat and quote one sentence you dispute. No personal attacks.',
    '',
    activeLanguageDirective(),
    '',
    'Output one JSON object only:',
    '{ "position": "updated view (150-300 chars)", "concedes": "what you now accept or empty", "holds": "one named seat + quoted claim + your rebuttal" }',
    '',
    `[Proposition] ${params.question}`,
  ].join('\n')
}

export function leagueConsensusSystemPrompt(): string {
  return [
    'You measure agreement among independent league commentators. You are not a policy clerk.',
    'Score 0–100 how much the live positions converged this round.',
    'Use the actual live-responder count as the denominator.',
    '',
    activeLanguageDirective(),
    '',
    'Output one JSON object only:',
    '{ "score": 0, "agreedPoints": ["..."], "contestedPoints": ["..."], "summary": "one short paragraph" }',
  ].join('\n')
}

export function leagueVoteSystemPrompt(): string {
  return [
    'You are a commentator on an AI Prediction League motion vote.',
    'Vote on the proposition as commentary, not as a government motion and not as a trade order.',
    '',
    ANALYST_DISCIPLINE,
    '',
    activeLanguageDirective(),
    '',
    'Output exactly two lines:',
    '표결: 찬성|조건부 찬성|반대|기권',
    '이유: <one short paragraph>',
    'English sessions may use: Vote: approve|conditional|oppose|abstain',
  ].join('\n')
}

export function leagueChairSystemPrompt(): string {
  const headings = deepSectionHeadersFor(getOutputLanguage())
  return [
    'You are the closing chair of an AI Prediction League commentary panel.',
    'You synthesize the briefing, debate, and advisory ballot into unscored commentary.',
    'You are not a resource/energy policy chair, not a ministry aide, and not an investment adviser.',
    '',
    ANALYST_DISCIPLINE,
    '',
    'Write these headings:',
    `## ${headings.judgment}`,
    `## ${headings.keyIssues}`,
    `## ${headings.minorityReport}`,
    '',
    `Close the judgment with: "${LEAGUE_DEEP_DISCLAIMER}"`,
    '',
    activeLanguageDirective(),
  ].join('\n')
}

export function fallbackOpenRoles(): Array<{
  roleId: string
  roleLabel: string
  mandate: string
  subQuestion: string
  isDoubledAngle: boolean
  doubledGroupId?: string
}> {
  return [
    {
      roleId: 'price-a',
      roleLabel: 'Price-path analyst',
      mandate: 'Read the price packet and state what it does and does not show about the proposition.',
      subQuestion: 'What does the available close/path imply, with timestamps?',
      isDoubledAngle: true,
      doubledGroupId: 'price',
    },
    {
      roleId: 'price-b',
      roleLabel: 'Alternate price reading',
      mandate: 'Give the strongest alternative reading of the same price packet.',
      subQuestion: 'What competing reading of the same prints is still live?',
      isDoubledAngle: true,
      doubledGroupId: 'price',
    },
    {
      roleId: 'research',
      roleLabel: 'Research-packet analyst',
      mandate: 'Extract only what the research packet actually contains.',
      subQuestion: 'Which research claims are sourced, and which are missing?',
      isDoubledAngle: false,
    },
    {
      roleId: 'resolution',
      roleLabel: 'Resolution-rule analyst',
      mandate: 'Map the resolution rule and clock onto the packets.',
      subQuestion: 'What would actually grade this round, and what could block grading?',
      isDoubledAngle: false,
    },
    {
      roleId: 'crowding',
      roleLabel: 'Crowding / consensus critic',
      mandate: 'Challenge the obvious consensus implied by the packets.',
      subQuestion: 'Where is the market or research narrative too crowded?',
      isDoubledAngle: false,
    },
    {
      roleId: 'tail',
      roleLabel: 'Tail-risk analyst',
      mandate: 'List failure modes that would flip the proposition.',
      subQuestion: 'What packet-consistent tail would invalidate the easy story?',
      isDoubledAngle: false,
    },
    {
      roleId: 'cross',
      roleLabel: 'Cross-check analyst',
      mandate: 'Look for internal contradictions between price and research packets.',
      subQuestion: 'Where do the two packets disagree or fail to meet?',
      isDoubledAngle: false,
    },
    {
      roleId: 'method',
      roleLabel: 'Methodology / data-quality analyst',
      mandate: 'Judge packet completeness and what must not be inferred.',
      subQuestion: 'What is missing that a grader would still need?',
      isDoubledAngle: false,
    },
  ]
}

export function fallbackDebateRoles(): Array<{
  roleId: string
  roleLabel: string
  mandate: string
  isRedTeam: boolean
}> {
  return [
    { roleId: 'price', roleLabel: 'Price-path analyst', mandate: 'Argue from the price packet only; weigh both sides.', isRedTeam: false },
    { roleId: 'research', roleLabel: 'Research-packet analyst', mandate: 'Argue from the research packet only; weigh both sides.', isRedTeam: false },
    { roleId: 'resolution', roleLabel: 'Resolution-rule analyst', mandate: 'Argue how the grading rule could go either way.', isRedTeam: false },
    { roleId: 'crowding', roleLabel: 'Crowding critic', mandate: 'Stress-test the crowded reading; concede if packets force it.', isRedTeam: false },
    { roleId: 'tail', roleLabel: 'Tail-risk analyst', mandate: 'Keep the flip scenario honest; drop it if packets close it.', isRedTeam: false },
    { roleId: 'cross', roleLabel: 'Cross-check analyst', mandate: 'Highlight packet contradictions without inventing data.', isRedTeam: false },
    { roleId: 'method', roleLabel: 'Methodology analyst', mandate: 'Police over-claiming from thin packets.', isRedTeam: false },
    { roleId: 'synthesis-seat', roleLabel: 'Integrating analyst', mandate: 'Hold the whole proposition against both packets.', isRedTeam: false },
  ]
}
