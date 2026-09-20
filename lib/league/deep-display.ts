/**
 * Client-safe deep-analysis display helpers.
 *
 * Generation stores English (models ignore the language lock; analyst prompts
 * even hardcode "## Key findings"). Card rationales already translate on the
 * view/read path; deep analysis did not. These helpers:
 *   1. Swap known English markdown headings for the viewer's locale (no LLM).
 *   2. Overlay cached view-time translations of briefing / per-analyst briefs
 *      / synthesis (and debate prose) without mutating the snapshot.
 * en/pt skip the LLM pass (same as card rationales); heading swap still runs
 * for every non-English locale, including pt.
 */

import type { LeagueLocale } from './i18n/locales'
import { shouldTranslateRationaleLocale } from './rationale-display'
import type {
  DeepAnalysisSnapshot,
  DeepDebateSnapshot,
  DeepOpenSnapshot,
  DeepRoundSnapshot,
  DeepSnapshot,
  DeepTurnSnapshot,
  DeepVerdictSnapshot,
  DeepVoteSnapshot,
} from './deep-snapshot'

export function shouldTranslateDeepLocale(locale: LeagueLocale): locale is Exclude<LeagueLocale, 'en' | 'pt'> {
  return shouldTranslateRationaleLocale(locale)
}

export type DeepSectionHeaderPack = {
  keyFindings: string
  evidence: string
  coreSummary: string
  analystsAgree: string
  analystsDiverge: string
  commentaryOptions: string
  packetGaps: string
  propositionClock: string
  packetsContain: string
  openQuestions: string
  laterWeigh: string
  judgment: string
  keyIssues: string
  minorityReport: string
}

/** English source titles the models are prompted to emit. */
export const DEEP_ENGLISH_SECTION_HEADERS: DeepSectionHeaderPack = {
  keyFindings: 'Key findings',
  evidence: 'Evidence from the packets',
  coreSummary: 'Core summary',
  analystsAgree: 'Where the analysts agree',
  analystsDiverge: 'Where they diverge',
  commentaryOptions: 'Commentary options (A/B/C) — interpretive readings, not trades',
  packetGaps: 'Packet gaps',
  propositionClock: 'Proposition and resolution clock',
  packetsContain: 'What the price/research packets actually contain',
  openQuestions: 'Open questions the packets do not settle',
  laterWeigh: 'What a later analyst should weigh',
  judgment: 'Judgment',
  keyIssues: 'Key issues',
  minorityReport: 'Minority report',
}

const DEEP_SECTION_HEADERS: Record<LeagueLocale, DeepSectionHeaderPack> = {
  en: DEEP_ENGLISH_SECTION_HEADERS,
  ko: {
    keyFindings: '핵심 발견',
    evidence: '패킷 근거',
    coreSummary: '핵심 요약',
    analystsAgree: '분석가들이 일치하는 점',
    analystsDiverge: '분석가들이 갈리는 점',
    commentaryOptions: '해석 선택지 (A/B/C) — 해석이지 매매 지시가 아님',
    packetGaps: '패킷이 비운 부분',
    propositionClock: '명제와 판정 시각',
    packetsContain: '가격·리서치 패킷이 실제로 담은 것',
    openQuestions: '패킷이 결론 내지 못한 질문',
    laterWeigh: '이후 분석가가 저울질할 것',
    judgment: '판정',
    keyIssues: '쟁점',
    minorityReport: '소수 의견',
  },
  ja: {
    keyFindings: '主な発見',
    evidence: 'パケット上の根拠',
    coreSummary: '核心要約',
    analystsAgree: '分析が一致する点',
    analystsDiverge: '見解が分かれる点',
    commentaryOptions: '解釈の選択肢 (A/B/C) — 解釈であり取引指示ではない',
    packetGaps: 'パケットの欠落',
    propositionClock: '命題と判定時刻',
    packetsContain: '価格・リサーチパケットが実際に含むもの',
    openQuestions: 'パケットが決着しない問い',
    laterWeigh: '後続の分析が測るべきこと',
    judgment: '判定',
    keyIssues: '争点',
    minorityReport: '少数意見',
  },
  'zh-TW': {
    keyFindings: '核心發現',
    evidence: '封包依據',
    coreSummary: '核心摘要',
    analystsAgree: '分析師一致之處',
    analystsDiverge: '分析師分歧之處',
    commentaryOptions: '詮釋選項 (A/B/C) — 詮釋而非交易指示',
    packetGaps: '封包缺口',
    propositionClock: '命題與判定時點',
    packetsContain: '價格／研究封包實際包含的內容',
    openQuestions: '封包未能定案的問題',
    laterWeigh: '後續分析應衡量的事項',
    judgment: '判定',
    keyIssues: '爭點',
    minorityReport: '少數意見',
  },
  fr: {
    keyFindings: 'Constats clés',
    evidence: 'Preuves tirées des paquets',
    coreSummary: 'Synthèse principale',
    analystsAgree: 'Points d’accord',
    analystsDiverge: 'Points de divergence',
    commentaryOptions: 'Options de lecture (A/B/C) — interprétations, pas des ordres',
    packetGaps: 'Lacunes des paquets',
    propositionClock: 'Proposition et horloge de résolution',
    packetsContain: 'Ce que contiennent réellement les paquets prix/recherche',
    openQuestions: 'Questions que les paquets ne tranchent pas',
    laterWeigh: 'Ce qu’un analyste ultérieur devrait peser',
    judgment: 'Jugement',
    keyIssues: 'Enjeux',
    minorityReport: 'Rapport minoritaire',
  },
  es: {
    keyFindings: 'Hallazgos clave',
    evidence: 'Evidencia de los paquetes',
    coreSummary: 'Resumen central',
    analystsAgree: 'Donde coinciden los analistas',
    analystsDiverge: 'Donde divergen',
    commentaryOptions: 'Opciones de lectura (A/B/C) — interpretaciones, no órdenes',
    packetGaps: 'Lagunas de los paquetes',
    propositionClock: 'Proposición y reloj de resolución',
    packetsContain: 'Lo que contienen de verdad los paquetes de precio/investigación',
    openQuestions: 'Preguntas que los paquetes no resuelven',
    laterWeigh: 'Lo que un analista posterior debería sopesar',
    judgment: 'Fallo',
    keyIssues: 'Cuestiones clave',
    minorityReport: 'Informe minoritario',
  },
  ar: {
    keyFindings: 'النتائج الرئيسية',
    evidence: 'الأدلة من الحزم',
    coreSummary: 'الملخص الأساسي',
    analystsAgree: 'مواضع اتفاق المحللين',
    analystsDiverge: 'مواضع الاختلاف',
    commentaryOptions: 'خيارات القراءة (أ/ب/ج) — تفسير لا أوامر تداول',
    packetGaps: 'فجوات الحزم',
    propositionClock: 'القضية وساعة الحسم',
    packetsContain: 'ما تحتويه حزم السعر/البحث فعلًا',
    openQuestions: 'أسئلة لا تحسمها الحزم',
    laterWeigh: 'ما ينبغي أن يزنه تحليل لاحق',
    judgment: 'الحكم',
    keyIssues: 'النقاط الخلافية',
    minorityReport: 'تقرير الأقلية',
  },
  pt: {
    keyFindings: 'Principais achados',
    evidence: 'Evidência dos pacotes',
    coreSummary: 'Resumo central',
    analystsAgree: 'Onde os analistas concordam',
    analystsDiverge: 'Onde divergem',
    commentaryOptions: 'Opções de leitura (A/B/C) — interpretações, não ordens',
    packetGaps: 'Lacunas dos pacotes',
    propositionClock: 'Proposição e relógio de resolução',
    packetsContain: 'O que os pacotes de preço/pesquisa realmente contêm',
    openQuestions: 'Perguntas que os pacotes não resolvem',
    laterWeigh: 'O que um analista posterior deve pesar',
    judgment: 'Julgamento',
    keyIssues: 'Questões-chave',
    minorityReport: 'Relatório minoritário',
  },
}

export function deepSectionHeadersFor(locale: LeagueLocale): DeepSectionHeaderPack {
  return DEEP_SECTION_HEADERS[locale]
}

type HeaderAlias = { id: keyof DeepSectionHeaderPack; pattern: RegExp }

const HEADER_ALIASES: HeaderAlias[] = [
  { id: 'keyFindings', pattern: /^key findings$/i },
  { id: 'evidence', pattern: /^evidence from the packets?$/i },
  { id: 'coreSummary', pattern: /^core summary$/i },
  { id: 'analystsAgree', pattern: /^where the analysts agree$/i },
  { id: 'analystsDiverge', pattern: /^where they diverge$/i },
  { id: 'commentaryOptions', pattern: /^commentary options\b.*$/i },
  { id: 'packetGaps', pattern: /^packet gaps$/i },
  { id: 'propositionClock', pattern: /^proposition and resolution clock$/i },
  { id: 'packetsContain', pattern: /^what the price\/research packets actually contain$/i },
  { id: 'openQuestions', pattern: /^open questions the packets do not settle$/i },
  { id: 'laterWeigh', pattern: /^what a later analyst should weigh$/i },
  { id: 'judgment', pattern: /^judgment$/i },
  { id: 'keyIssues', pattern: /^key issues$/i },
  { id: 'minorityReport', pattern: /^minority report$/i },
]

function matchEnglishTitle(title: string): keyof DeepSectionHeaderPack | null {
  const trimmed = title.trim()
  if (!trimmed) return null
  const unbolded = trimmed.replace(/^\*\*(.+)\*\*$/, '$1').trim()
  for (const alias of HEADER_ALIASES) {
    if (alias.pattern.test(unbolded)) return alias.id
  }
  return null
}

/**
 * Replace English markdown section titles on a heading-shaped line.
 * Body lines are untouched. Idempotent once titles are already localized.
 */
export function localizeDeepMarkdownHeaders(text: string, labels: DeepSectionHeaderPack): string {
  if (!text) return text
  return text
    .split('\n')
    .map((line) => localizeHeadingLine(line, labels))
    .join('\n')
}

function localizeHeadingLine(line: string, labels: DeepSectionHeaderPack): string {
  const leading = line.match(/^[ \t]*/)?.[0] ?? ''
  const rest = line.slice(leading.length)
  const hashNumbered = rest.match(/^(#{1,3})[ \t]+(\d+[.)][ \t]+)(.+)$/)
  if (hashNumbered) {
    const id = matchEnglishTitle(hashNumbered[3]!)
    if (id) return `${leading}${hashNumbered[1]} ${hashNumbered[2]}${labels[id]}`
    return line
  }
  const hash = rest.match(/^(#{1,3})[ \t]+(.+)$/)
  if (hash) {
    const id = matchEnglishTitle(hash[2]!)
    if (id) return `${leading}${hash[1]} ${labels[id]}`
    return line
  }
  const numbered = rest.match(/^(\d+[.)][ \t]+)(.+)$/)
  if (numbered) {
    const id = matchEnglishTitle(numbered[2]!)
    if (id) return `${leading}${numbered[1]}${labels[id]}`
    return line
  }
  const bold = rest.match(/^\*\*(.+)\*\*[ \t]*$/)
  if (bold) {
    const id = matchEnglishTitle(bold[1]!)
    if (id) return `${leading}**${labels[id]}**`
  }
  return line
}

export type DeepTranslationPart = { key: string; text: string }

function pushPart(parts: DeepTranslationPart[], key: string, text: string | null | undefined): void {
  const trimmed = text?.trim()
  if (trimmed) parts.push({ key, text: trimmed })
}

/** Flatten snapshot prose that the view-time translator may rewrite. */
export function collectDeepTranslatableParts(snap: DeepSnapshot): DeepTranslationPart[] {
  const parts: DeepTranslationPart[] = []
  pushPart(parts, 'briefing', snap.briefing)
  if (snap.kind === 'open') {
    for (const analysis of snap.analyses) {
      if (analysis.ok) pushPart(parts, `analysis:${analysis.roleId}`, analysis.content)
    }
    pushPart(parts, 'synthesis', snap.synthesis)
    return parts
  }
  for (const round of snap.rounds) {
    pushPart(parts, `debate:r${round.roundNumber}:summary`, round.summary)
    round.turns.forEach((turn, index) => {
      pushPart(parts, `debate:r${round.roundNumber}:t${index}:position`, turn.position)
      pushPart(parts, `debate:r${round.roundNumber}:t${index}:concedes`, turn.concedes)
      pushPart(parts, `debate:r${round.roundNumber}:t${index}:holds`, turn.holds)
    })
  }
  if (snap.vote) {
    pushPart(parts, 'vote:summary', snap.vote.summary)
    snap.vote.votes.forEach((vote, index) => {
      pushPart(parts, `vote:${index}:reason`, vote.reason)
    })
  }
  if (snap.verdict) {
    pushPart(parts, 'verdict:judgment', snap.verdict.judgment)
    pushPart(parts, 'verdict:keyIssues', snap.verdict.keyIssues)
    pushPart(parts, 'verdict:minorityReport', snap.verdict.minorityReport)
  }
  return parts
}

export function deepTranslationFingerprint(snap: DeepSnapshot | null): string {
  if (!snap) return ''
  return collectDeepTranslatableParts(snap)
    .map((part) => `${part.key}:${part.text.length}:${part.text.slice(0, 24)}`)
    .join('\n')
}

export function partitionCachedDeepTranslations(
  parts: DeepTranslationPart[],
  cachedRows: { part_key: string; translated_text: string; source_hash: string }[],
  sourceHash: (text: string) => string
): { translations: Record<string, string>; missing: DeepTranslationPart[] } {
  const cached = new Map(cachedRows.map((row) => [row.part_key, row]))
  const translations: Record<string, string> = {}
  const missing: DeepTranslationPart[] = []
  for (const part of parts) {
    const hit = cached.get(part.key)
    if (hit && hit.source_hash === sourceHash(part.text) && hit.translated_text.trim()) {
      translations[part.key] = hit.translated_text
    } else {
      missing.push(part)
    }
  }
  return { translations, missing }
}

export function overlayDeepTranslations(
  snap: DeepSnapshot,
  translations: Record<string, string> | null,
  opts: { locale: LeagueLocale; showOriginal: boolean }
): DeepSnapshot {
  const headers =
    opts.showOriginal || opts.locale === 'en' ? null : deepSectionHeadersFor(opts.locale)
  const applyCached = !opts.showOriginal && shouldTranslateDeepLocale(opts.locale)

  const field = (key: string, original: string | null | undefined): string | null => {
    if (original == null) return original ?? null
    const translated = applyCached ? translations?.[key]?.trim() : ''
    const body = translated || original
    return headers ? localizeDeepMarkdownHeaders(body, headers) : body
  }

  if (snap.kind === 'open') {
    return overlayOpen(snap, field)
  }
  return overlayDebate(snap, field)
}

function overlayOpen(
  snap: DeepOpenSnapshot,
  field: (key: string, original: string | null | undefined) => string | null
): DeepOpenSnapshot {
  return {
    ...snap,
    briefing: field('briefing', snap.briefing),
    analyses: snap.analyses.map(
      (analysis): DeepAnalysisSnapshot => ({
        ...analysis,
        content: field(`analysis:${analysis.roleId}`, analysis.content),
      })
    ),
    synthesis: field('synthesis', snap.synthesis),
  }
}

function overlayDebate(
  snap: DeepDebateSnapshot,
  field: (key: string, original: string | null | undefined) => string | null
): DeepDebateSnapshot {
  return {
    ...snap,
    briefing: field('briefing', snap.briefing),
    rounds: snap.rounds.map(
      (round): DeepRoundSnapshot => ({
        ...round,
        summary: field(`debate:r${round.roundNumber}:summary`, round.summary) ?? '',
        turns: round.turns.map(
          (turn, index): DeepTurnSnapshot => ({
            ...turn,
            position: field(`debate:r${round.roundNumber}:t${index}:position`, turn.position),
            concedes: field(`debate:r${round.roundNumber}:t${index}:concedes`, turn.concedes),
            holds: field(`debate:r${round.roundNumber}:t${index}:holds`, turn.holds),
          })
        ),
      })
    ),
    vote: snap.vote ? overlayVote(snap.vote, field) : null,
    verdict: snap.verdict ? overlayVerdict(snap.verdict, field) : null,
  }
}

function overlayVote(
  vote: DeepVoteSnapshot,
  field: (key: string, original: string | null | undefined) => string | null
): DeepVoteSnapshot {
  return {
    ...vote,
    summary: field('vote:summary', vote.summary) ?? '',
    votes: vote.votes.map((entry, index) => ({
      ...entry,
      reason: field(`vote:${index}:reason`, entry.reason),
    })),
  }
}

function overlayVerdict(
  verdict: DeepVerdictSnapshot,
  field: (key: string, original: string | null | undefined) => string | null
): DeepVerdictSnapshot {
  return {
    ...verdict,
    judgment: field('verdict:judgment', verdict.judgment),
    keyIssues: field('verdict:keyIssues', verdict.keyIssues),
    minorityReport: field('verdict:minorityReport', verdict.minorityReport),
  }
}
