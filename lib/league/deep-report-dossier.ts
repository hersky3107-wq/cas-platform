/**
 * Evidence dossier assembly. Findings are filtered with the same rules as
 * the official research packet, then written with locale headings.
 */
import { scrubAnalystDisclosure } from './analyst-disclosure'
import { omitThirdPartyPredictionText } from './research-merge'
import type { LeagueLocale } from './i18n/locales'
import { RESEARCH_ANGLES, type ResearchAngle } from './deep-report-policy'

export type SourceTier = 'official' | 'regulator' | 'major_outlet' | 'rumor' | 'other'

export type EvidenceFinding = {
  angle: ResearchAngle
  claim: string
  url: string | null
  date: string | null
  tier: SourceTier
  provider: string
}

const TIER_RANK: Record<SourceTier, number> = {
  official: 0,
  regulator: 1,
  major_outlet: 2,
  other: 3,
  rumor: 4,
}

const MAJOR = /(reuters|bloomberg|wsj|nytimes|bbc|ft\.com|apnews|yonhap|yna\.co|hankyung|chosun|joongang|khan\.co)/i
const OFFICIAL = /(\.gov\b|\.go\.kr|sec\.gov|krx\.co|dart\.fss|federalreserve|ecb\.europa|bls\.gov|imf\.org|worldbank)/i
const REGULATOR = /(sec\.gov|fca\.org|fsc\.go|cftc\.gov|finra|금융위|금융감독)/i
const RUMOR = /\b(rumou?r|unconfirmed|카더라|찌라시|소문)\b/i

const HEADING: Record<LeagueLocale, {
  title: string
  none: string
  agree: string
  contradict: string
  fallback: string
  tier: Record<SourceTier, string>
}> = {
  en: {
    title: 'Evidence dossier',
    none: 'none found',
    agree: 'Agreement',
    contradict: 'Contradictions',
    fallback: 'Research cost cap was exceeded, so this dossier used multi-query standard search instead of sonar-deep-research.',
    tier: { official: 'official', regulator: 'regulator', major_outlet: 'major outlet', rumor: 'rumor', other: 'other' },
  },
  ko: {
    title: '근거 자료집',
    none: '없음',
    agree: '일치',
    contradict: '충돌',
    fallback: '조사 비용 한도를 넘겨, sonar-deep-research 대신 일반 다중 검색으로 이 자료집을 만들었습니다.',
    tier: { official: '공식', regulator: '규제기관', major_outlet: '주요 매체', rumor: '소문', other: '기타' },
  },
  ja: {
    title: '証拠資料',
    none: '該当なし',
    agree: '一致',
    contradict: '矛盾',
    fallback: '調査コスト上限を超えたため、sonar-deep-research ではなく通常の複数検索でこの資料を作りました。',
    tier: { official: '公式', regulator: '規制当局', major_outlet: '主要媒体', rumor: '噂', other: 'その他' },
  },
  'zh-TW': {
    title: '證據卷宗',
    none: '未找到',
    agree: '一致',
    contradict: '矛盾',
    fallback: '已超過調查成本上限，因此改以一般多重搜尋而非 sonar-deep-research 撰寫本卷宗。',
    tier: { official: '官方', regulator: '監管機關', major_outlet: '主要媒體', rumor: '傳聞', other: '其他' },
  },
  fr: {
    title: 'Dossier de preuves',
    none: 'rien trouvé',
    agree: 'Accord',
    contradict: 'Contradictions',
    fallback: 'Le plafond de coût est dépassé : ce dossier utilise la recherche standard multi-requêtes, pas sonar-deep-research.',
    tier: { official: 'officiel', regulator: 'régulateur', major_outlet: 'grand média', rumor: 'rumeur', other: 'autre' },
  },
  es: {
    title: 'Dossier de pruebas',
    none: 'no se encontró',
    agree: 'Acuerdo',
    contradict: 'Contradicciones',
    fallback: 'Se superó el tope de coste: este dossier usa búsqueda estándar de varias consultas, no sonar-deep-research.',
    tier: { official: 'oficial', regulator: 'regulador', major_outlet: 'medio principal', rumor: 'rumor', other: 'otro' },
  },
  ar: {
    title: 'ملف الأدلة',
    none: 'لا يوجد',
    agree: 'اتفاق',
    contradict: 'تعارض',
    fallback: 'تجاوز البحث سقف التكلفة، لذا استُخدم بحث عادي متعدد بدل sonar-deep-research.',
    tier: { official: 'رسمي', regulator: 'جهة تنظيم', major_outlet: 'وسيلة كبرى', rumor: 'شائعة', other: 'أخرى' },
  },
  pt: {
    title: 'Dossiê de evidências',
    none: 'nada encontrado',
    agree: 'Concordância',
    contradict: 'Contradições',
    fallback: 'O teto de custo foi ultrapassado: este dossiê usou busca padrão em várias consultas, não sonar-deep-research.',
    tier: { official: 'oficial', regulator: 'regulador', major_outlet: 'veículo grande', rumor: 'rumor', other: 'outro' },
  },
}

export function classifySourceTier(url: string | null, claim: string): SourceTier {
  const blob = `${url ?? ''} ${claim}`
  if (RUMOR.test(blob)) return 'rumor'
  if (REGULATOR.test(blob)) return 'regulator'
  if (OFFICIAL.test(blob)) return 'official'
  if (MAJOR.test(blob)) return 'major_outlet'
  return 'other'
}

const STOCKISH = new Set(['stock', 'stocks'])

/** Drop tips/odds and scrub KR-equity broker residue. Empty string means drop. */
export function admitEvidenceClaim(claim: string, category: string | null | undefined): string | null {
  const trimmed = claim.trim()
  if (!trimmed) return null
  if (omitThirdPartyPredictionText(trimmed, category)) return null
  if (STOCKISH.has((category ?? '').trim())) {
    return scrubAnalystDisclosure(trimmed)
  }
  return trimmed
}

function normalizeClaim(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').slice(0, 180)
}

export function renderEvidenceDossier(input: {
  locale: LeagueLocale
  category: string | null | undefined
  findings: EvidenceFinding[]
  fallback: boolean
}): string {
  const copy = HEADING[input.locale]
  const kept: EvidenceFinding[] = []
  for (const row of input.findings) {
    const claim = admitEvidenceClaim(row.claim, input.category)
    if (!claim) continue
    kept.push({ ...row, claim, tier: row.tier || classifySourceTier(row.url, claim) })
  }
  kept.sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier])

  const lines: string[] = [`# ${copy.title}`]
  if (input.fallback) lines.push(copy.fallback)

  for (const angle of RESEARCH_ANGLES) {
    const rows = kept.filter((row) => row.angle === angle)
    lines.push('', `## ${angle}`)
    if (rows.length === 0) {
      lines.push(copy.none)
      continue
    }
    const counts = new Map<string, number>()
    for (const row of rows) {
      const key = normalizeClaim(row.claim)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const row of rows) {
      const n = counts.get(normalizeClaim(row.claim)) ?? 1
      const date = row.date ?? copy.none
      const url = row.url ?? copy.none
      lines.push(`- ${row.claim} | ${date} | ${copy.tier[row.tier]} | ${url} | ${copy.agree}: ${n} | ${row.provider}`)
    }
  }

  const yes = kept.filter((row) => row.angle === 'strongest_yes')
  const no = kept.filter((row) => row.angle === 'strongest_no')
  lines.push('', `## ${copy.contradict}`)
  if (yes.length === 0 && no.length === 0) lines.push(copy.none)
  else {
    lines.push(`YES: ${yes.map((row) => row.claim).join(' / ') || copy.none}`)
    lines.push(`NO: ${no.map((row) => row.claim).join(' / ') || copy.none}`)
  }
  return lines.join('\n')
}
