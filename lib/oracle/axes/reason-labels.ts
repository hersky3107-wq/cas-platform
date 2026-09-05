/**
 * Display labels for projector machine codes.
 *
 * AxisVote.reasons stays code-only (engines/axis contract unchanged).
 * Labels are attached when building ai_payload for the model, in the
 * session locale. Codes remain authoritative; labels are display only.
 */
export type ReasonLabelEntry = { code: string; label: string }

/** Compact payload shape: reasons stay code string[]; labels aligned by index. */
export type LabelledReasons = {
  reasons: {
    traits?: string[]
    elements?: string[]
    phase?: string[]
  }
  labels: {
    traits?: string[]
    elements?: string[]
    phase?: string[]
  }
}

const KO: Record<string, string> = {
  // ── saju ──
  'saju.tengods.peer_dominant': '비견',
  'saju.tengods.output_dominant': '식상',
  'saju.tengods.wealth_dominant': '재성',
  'saju.tengods.officer_dominant': '관성',
  'saju.tengods.resource_dominant': '인성',
  'saju.elements.four_pillars': '사주 네 기둥',
  'saju.elements.three_pillars': '사주 세 기둥',
  'saju.phase.daewoon_sewoon': '대운·세운',
  'saju.hour_unknown': '출생 시각 미상',
  'saju.no_current_daewoon': '현재 대운 없음',
  'saju.daewoon_unavailable': '대운 산출 불가',
  'saju.no_element_reading': '오행 판독 불가',
  'saju.no_phase_reading': '운세 국면 판독 불가',

  // ── astro ──
  'astro.traits.houses_and_aspects': '하우스·애스펙트',
  'astro.traits.no_houses': '하우스 없음',
  'astro.hour_unknown': '출생 시각 미상',
  'astro.elements.classical_to_oheng': '별자리 원소',
  'astro.phase.applying_transits': '적용 중인 트랜짓',
  'astro.moon_approximate': '달 위치 근사',
  'astro.no_element_reading': '오행 판독 불가',
  'astro.no_transits': '트랜짓 없음',

  // ── prism ──
  'prism.traits.core_matrix': '성향의 결',
  'prism.element.resonance': '같은 결',
  'prism.element.support': '받침',
  'prism.element.output': '밖으로 씀',
  'prism.element.challenge': '부딪침',
  'prism.element.pressure': '압박',
  'prism.cycle.ignition': '점화',
  'prism.cycle.ascent': '상승',
  'prism.cycle.bloom': '개화',
  'prism.cycle.tension': '긴장',
  'prism.cycle.harvest': '수확',
  'prism.cycle.recalibrate': '재조정',
  'prism.cycle.breakthrough': '돌파',
  'prism.cycle.bond': '유착',
  'prism.cycle.command': '결단',
  'prism.cycle.restore': '회복',
  'prism.cycle.distill': '정제',
  'prism.cycle.threshold': '문턱',
  'prism.no_element_reading': '오행 판독 불가',
  'prism.no_phase_reading': '주기 판독 불가',

  // ── ziwei ──
  'ziwei.traits.ming_shen_major_stars': '명궁·신궁 주성',
  'ziwei.elements.wuxingju_and_palace_stars': '오행국·궁성',
  'ziwei.elements.year_stem_only': '년간만으로 오행',
  'ziwei.phase.daxian_and_liunian_sihua': '대한·유년 사화',
  'ziwei.no_birth_time': '출생 시각 미상',
  'ziwei.no_current_daxian': '현재 대한 없음',

  // ── numerology ──
  'numerology.traits.lifepath_expression_blend': '라이프패스·표현수 혼합',
  'numerology.traits.lifepath_only': '라이프패스만',
  'numerology.no_latin_name': '로마자 이름 없음',
  'numerology.no_wuxing_mapping': '오행 매핑 없음',

  // ── name ──
  'name.traits.gyeok_element_archetype': '격·오행 원형',
  'name.elements.suri_oheng_five_gyeok': '수리오행 오격',
  'name.locale_unsupported': '로케일 미지원',
  'name.no_time_axis': '시간축 없음',
  'name.no_element_reading': '오행 판독 불가',

  // ── iching ──
  'iching.elements.najia_shi_weighted': '납갑·시 가중 오행',
  'iching.phase.changing_lines_relation': '변효 관계',
  'iching.phase.no_changing_lines': '변효 없음',
  'iching.no_trait_reading': '성향 판독 불가',
  'iching.no_element_reading': '오행 판독 불가',

  // ── tarot ──
  'tarot.traits.arcana_and_suit': '메이저·수트',
  'tarot.traits.reversals_reflected': '뒤집힌 카드',
  'tarot.elements.suit_to_classical_to_oheng': '카드의 기운',
  'tarot.phase.card_character': '카드가 가리키는 흐름',
  'tarot.no_minor_cards': '마이너 카드 없음',

  // ── runes ──
  'rune.traits.stave_character': '룬 성향',
  'rune.elements.agreed_associations_only': '합의된 원소 대응만',
  'rune.phase.direction_with_merkstave_flip': '정방향·어두운 면',
  'rune.no_element_consensus': '원소 합의 없음',

  // ── ninestar ──
  'ninestar.traits.honmeisei': '본명성',
  'ninestar.elements.year_month_day_blend': '연·월·일 성 혼합',
  'ninestar.phase.honmeisei_relation': '본명성 관계',
  'ninestar.time_unknown_noon_fallback': '정오 대체 시각',
  'ninestar.no_element_reading': '오행 판독 불가',
  'ninestar.no_phase_reading': '국면 판독 불가',

  // ── sukuyou ──
  'sukuyou.elements.luminary_wuxing': '명성 오행',
  'sukuyou.no_wuxing_for_luminary': '명성 오행 없음',

  // ── maya / tzolkin ──
  'maya.no_wuxing_mapping': '오행 매핑 없음',
}

const EN: Record<string, string> = {
  'saju.tengods.peer_dominant': 'peer (比肩)',
  'saju.tengods.output_dominant': 'output (食傷)',
  'saju.tengods.wealth_dominant': 'wealth (財)',
  'saju.tengods.officer_dominant': 'officer (官)',
  'saju.tengods.resource_dominant': 'resource (印)',
  'saju.elements.four_pillars': 'four pillars',
  'saju.elements.three_pillars': 'three pillars',
  'saju.phase.daewoon_sewoon': 'great luck & annual luck',
  'saju.hour_unknown': 'birth hour unknown',
  'astro.traits.houses_and_aspects': 'houses & aspects',
  'astro.elements.classical_to_oheng': 'classical elements → wuxing',
  'astro.phase.applying_transits': 'applying transits',
  'prism.traits.core_matrix': 'temperament grain',
  'tarot.traits.arcana_and_suit': 'arcana & suit',
  'tarot.traits.reversals_reflected': 'reversed cards',
  'tarot.elements.suit_to_classical_to_oheng': 'card temperament',
  'tarot.phase.card_character': 'what the cards point toward',
  'maya.no_wuxing_mapping': 'no wuxing mapping',
}

const LUMINARY_KO: Record<string, string> = {
  sun: '태양',
  moon: '달',
  mercury: '수성',
  venus: '금성',
  mars: '화성',
  jupiter: '목성',
  saturn: '토성',
}

function humanizeSegment(segment: string): string {
  return segment.replace(/_/g, ' ')
}

/** Resolve a display label for one machine code in the target locale. */
export function labelForReasonCode(code: string, locale: string): string {
  const lang = locale.split('-')[0] ?? locale
  const table = lang === 'ko' ? KO : EN
  if (table[code]) return table[code]
  if (lang === 'ko' && EN[code]) return EN[code]
  if (lang !== 'ko' && KO[code]) return KO[code]

  const mayaNawal = code.match(/^maya\.traits\.nawal_(.+)$/)
  if (mayaNawal) {
    const name = mayaNawal[1]!
    return lang === 'ko' ? `나왈 ${name}` : `nawal ${name}`
  }
  const mayaTone = code.match(/^maya\.phase\.tone_(\d+)$/)
  if (mayaTone) {
    return lang === 'ko' ? `${mayaTone[1]}톤` : `tone ${mayaTone[1]}`
  }
  const sukuyouLum = code.match(/^sukuyou\.traits\.luminary_(.+)$/)
  if (sukuyouLum) {
    const key = sukuyouLum[1]!
    if (lang === 'ko') return `${LUMINARY_KO[key] ?? key} 명성`
    return `${key} luminary`
  }
  const sukuyouPhase = code.match(/^sukuyou\.phase\.sanku_(.+)$/)
  if (sukuyouPhase) {
    return lang === 'ko' ? `삼구 ${sukuyouPhase[1]}` : `sanku ${sukuyouPhase[1]}`
  }

  const last = code.split('.').pop() ?? code
  return humanizeSegment(last)
}

export function labelReasonCodes(codes: readonly string[] | undefined, locale: string): ReasonLabelEntry[] {
  if (!codes?.length) return []
  return codes.map((code) => ({ code, label: labelForReasonCode(code, locale) }))
}

/**
 * Compact labelling for ai_payload: keep reasons as authoritative code
 * string[] (same bytes as pre-label), add parallel label arrays only for
 * codes present on this vote — never the full label table.
 */
export function buildLabelledReasons(
  reasons: { traits?: string[]; elements?: string[]; phase?: string[] },
  locale: string,
): LabelledReasons {
  const labels: LabelledReasons['labels'] = {}
  if (reasons.traits?.length) {
    labels.traits = reasons.traits.map((code) => labelForReasonCode(code, locale))
  }
  if (reasons.elements?.length) {
    labels.elements = reasons.elements.map((code) => labelForReasonCode(code, locale))
  }
  if (reasons.phase?.length) {
    labels.phase = reasons.phase.map((code) => labelForReasonCode(code, locale))
  }
  return { reasons: { ...reasons }, labels }
}

/** @deprecated Prefer buildLabelledReasons for payload size. */
export function labelReasons(
  reasons: { traits?: string[]; elements?: string[]; phase?: string[] },
  locale: string,
): {
  traits?: ReasonLabelEntry[]
  elements?: ReasonLabelEntry[]
  phase?: ReasonLabelEntry[]
} {
  const out: {
    traits?: ReasonLabelEntry[]
    elements?: ReasonLabelEntry[]
    phase?: ReasonLabelEntry[]
  } = {}
  if (reasons.traits) out.traits = labelReasonCodes(reasons.traits, locale)
  if (reasons.elements) out.elements = labelReasonCodes(reasons.elements, locale)
  if (reasons.phase) out.phase = labelReasonCodes(reasons.phase, locale)
  return out
}
