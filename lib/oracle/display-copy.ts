/**
 * Korean labels for engine strings that surface on the reading result screen.
 * Engines stay English internally; this is the only layer that talks to the user.
 */

export const SIGN_KO: Record<string, string> = {
  Aries: '양자리',
  Taurus: '황소자리',
  Gemini: '쌍둥이자리',
  Cancer: '게자리',
  Leo: '사자자리',
  Virgo: '처녀자리',
  Libra: '천칭자리',
  Scorpio: '전갈자리',
  Sagittarius: '사수자리',
  Capricorn: '염소자리',
  Aquarius: '물병자리',
  Pisces: '물고기자리',
}

export const BODY_KO: Record<string, string> = {
  Sun: '태양',
  Moon: '달',
  Mercury: '수성',
  Venus: '금성',
  Mars: '화성',
  Jupiter: '목성',
  Saturn: '토성',
  Uranus: '천왕성',
  Neptune: '해왕성',
  Pluto: '명왕성',
  NorthNode: '승교점',
  SouthNode: '강교점',
  Chiron: '키론',
}

export const ELEMENT_KO: Record<string, string> = {
  wood: '목',
  fire: '화',
  earth: '토',
  metal: '금',
  water: '수',
  air: '풍',
  WOOD: '목',
  FIRE: '화',
  EARTH: '토',
  METAL: '금',
  WATER: '수',
}

export const ELEMENT_HANJA: Record<string, string> = {
  wood: '木',
  fire: '火',
  earth: '土',
  metal: '金',
  water: '水',
}

export function elementKoHanja(element: string): string {
  const ko = ELEMENT_KO[element]
  const hanja = ELEMENT_HANJA[element]
  if (ko && hanja) return `${ko}(${hanja})`
  return ko ?? element
}

export const EOKBU_STRENGTH_KO: Record<string, string> = {
  weak: '신약',
  balanced: '중화',
  strong: '신강',
}

export const EOKBU_DEUKRYEONG_KO: Record<string, string> = {
  wang: '왕',
  sheng: '상생',
  none: '없음',
}

export const EOKBU_ROOT_ROLE_KO: Record<string, string> = {
  yu: '여기',
  zhong: '중기',
  ben: '정기',
}

export const EOKBU_PILLAR_KO: Record<string, string> = {
  year: '년',
  month: '월',
  day: '일',
  hour: '시',
}

export function formatEokbuSummary(input: {
  strength: string | null
  yongsin: string | null
  deukryeongRelation: string
  deukji: number
  deukse: number
  inapplicable: { element: string; count: number; chars: number } | null
}): string {
  const deukryeong =
    input.deukryeongRelation === 'wang' || input.deukryeongRelation === 'sheng'
      ? `득령 ${EOKBU_DEUKRYEONG_KO[input.deukryeongRelation] ?? input.deukryeongRelation}`
      : '득령 없음'
  const parts = `${deukryeong}, 득지 ${input.deukji}, 득세 ${input.deukse}`
  if (input.inapplicable) {
    return `억부 판정불가 · 편왕 (${elementKoHanja(input.inapplicable.element)} ${input.inapplicable.count}/${input.inapplicable.chars}자) · AI 판단 요청`
  }
  if (!input.yongsin || !input.strength || input.strength === 'balanced') {
    const label = input.strength ? EOKBU_STRENGTH_KO[input.strength] ?? input.strength : '중화'
    return `${label} · 억부법 계산 (${parts})`
  }
  const strength = EOKBU_STRENGTH_KO[input.strength] ?? input.strength
  return `용신 ${elementKoHanja(input.yongsin)} · 억부법 계산 · ${strength} (${parts})`
}

export type EokbuNativeChart = {
  강약: string
  득령: { 여부: boolean; 점수: number; 월지: string; 관계: string }
  득지: { 점수: number; 통근: string[] }
  득세: { 점수: number; 조력: string[] }
  종합: number
  용신: string
  희신: string
  기신: string
  판정불가: string
  편왕: { 오행: string; 개수: number; 글자: number } | '없음'
  출처: '억부법 계산' | 'AI 판단 요청'
  안내: string
  시주없음: boolean
  시주없음약화: string
  요약: string
  학교: '억부법'
}

function recUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function strUnknown(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numUnknown(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Korean native-chart / UI shape from the English engine `eokbu` object. */
export function eokbuNativeChart(value: unknown): EokbuNativeChart | null {
  const row = recUnknown(value)
  if (!row) return null
  const deukryeong = recUnknown(row.deukryeong) ?? {}
  const deukji = recUnknown(row.deukji) ?? {}
  const deukse = recUnknown(row.deukse) ?? {}
  const inapplicable = recUnknown(row.inapplicable)
  const strength = strUnknown(row.strength)
  const yongsin = strUnknown(row.yongsin)
  const roots = (Array.isArray(deukji.roots) ? deukji.roots : []).map((root) => {
    const cell = recUnknown(root) ?? {}
    const pillar = EOKBU_PILLAR_KO[strUnknown(cell.pillar)] ?? strUnknown(cell.pillar)
    const role = EOKBU_ROOT_ROLE_KO[strUnknown(cell.role)] ?? strUnknown(cell.role)
    return `${pillar}지 ${strUnknown(cell.branchHanja)} (${role})`
  })
  const helpers = (Array.isArray(deukse.helpers) ? deukse.helpers : []).map((helper) => {
    const cell = recUnknown(helper) ?? {}
    const pillar = EOKBU_PILLAR_KO[strUnknown(cell.pillar)] ?? strUnknown(cell.pillar)
    const kind = strUnknown(cell.kind) === 'benqi' ? '지본기' : '간'
    return `${pillar}${kind} ${strUnknown(cell.hanja)}`
  })
  const hourUnknown = row.hourUnknown === true
  const 판정불가 = inapplicable
    ? `편왕 (${elementKoHanja(strUnknown(inapplicable.element))} ${numUnknown(inapplicable.count) ?? '?'}/${numUnknown(inapplicable.chars) ?? '?'}자)`
    : '없음'
  const 편왕 = inapplicable
    ? {
        오행: elementKoHanja(strUnknown(inapplicable.element)),
        개수: numUnknown(inapplicable.count) ?? 0,
        글자: numUnknown(inapplicable.chars) ?? 0,
      }
    : ('없음' as const)
  const inferenceRequested = inapplicable != null
  return {
    강약: strength ? EOKBU_STRENGTH_KO[strength] ?? strength : '없음',
    득령: {
      여부: deukryeong.has === true,
      점수: numUnknown(deukryeong.score) ?? 0,
      월지: strUnknown(deukryeong.monthBranchHanja),
      관계: EOKBU_DEUKRYEONG_KO[strUnknown(deukryeong.relation)] ?? strUnknown(deukryeong.relation),
    },
    득지: { 점수: numUnknown(deukji.score) ?? 0, 통근: roots },
    득세: { 점수: numUnknown(deukse.score) ?? 0, 조력: helpers },
    종합: numUnknown(row.total) ?? 0,
    용신: yongsin ? elementKoHanja(yongsin) : '없음',
    희신: strUnknown(row.huisin) ? elementKoHanja(strUnknown(row.huisin)) : '없음',
    기신: strUnknown(row.gisin) ? elementKoHanja(strUnknown(row.gisin)) : '없음',
    판정불가,
    편왕,
    출처: inferenceRequested ? 'AI 판단 요청' : '억부법 계산',
    안내: inferenceRequested
      ? '억부로는 판정되지 않음 — AI 판단 요청. 일간·득령·득지·득세·편왕 오행·십신분포·대운을 근거로 이 사주가 무엇을 필요로 하는지 말하라.'
      : '없음',
    시주없음: hourUnknown,
    시주없음약화: hourUnknown ? '시주가 없어 득지·득세는 연월일만으로 계산했다' : '없음',
    요약: formatEokbuSummary({
      strength: strength || null,
      yongsin: yongsin || null,
      deukryeongRelation: strUnknown(deukryeong.relation) || 'none',
      deukji: numUnknown(deukji.score) ?? 0,
      deukse: numUnknown(deukse.score) ?? 0,
      inapplicable: inapplicable
        ? {
            element: strUnknown(inapplicable.element),
            count: numUnknown(inapplicable.count) ?? 0,
            chars: numUnknown(inapplicable.chars) ?? 0,
          }
        : null,
    }),
    학교: '억부법',
  }
}

export const DOMAIN_KO: Record<string, string> = {
  work: '일',
  money: '재물',
  love: '관계',
  social: '사람',
  energy: '기운',
}

export const PRISM_CYCLE_KO: Record<string, { name: string; lucky: string; taboo: string }> = {
  Ignition: {
    name: '점화',
    lucky: '정오 전에 남들이 볼 수 있는 일 하나를 시작하세요.',
    taboo: '새 일을 하나 더 쌓지 마세요.',
  },
  Ascent: {
    name: '상승',
    lucky: '이미 움직이는 지표 하나에 힘을 모으세요.',
    taboo: '계획 전체를 다시 협상하지 마세요.',
  },
  Bloom: {
    name: '개화',
    lucky: '따뜻한 말을 소리 내어 하세요.',
    taboo: '한 주 내내 “생각부터” 하며 물러나지 마세요.',
  },
  Tension: {
    name: '긴장',
    lucky: '마찰을 한 문장으로 이름 붙이세요.',
    taboo: '억지로 밝은 척하지 마세요.',
  },
  Harvest: {
    name: '수확',
    lucky: '이미 받을 몫을 거두세요.',
    taboo: '남은 여유를 새 도박에 쓰지 마세요.',
  },
  Recalibrate: {
    name: '재조정',
    lucky: '반복되는 소모 하나를 끊으세요.',
    taboo: '새 습관 더미를 올리지 마세요.',
  },
  Breakthrough: {
    name: '돌파',
    lucky: '반쯤 끝난 초안을 내보내세요.',
    taboo: '더 깨끗한 기분을 기다리지 마세요.',
  },
  Bond: {
    name: '유착',
    lucky: '한 사람에게 온전한 시간을 주세요.',
    taboo: '대화에서 점수를 매기지 마세요.',
  },
  Command: {
    name: '결단',
    lucky: '남들이 맴도는 그 전화를 당신이 하세요.',
    taboo: '후속까지 일일이 통제하지 마세요.',
  },
  Restore: {
    name: '회복',
    lucky: '진짜 빈 시간을 지키세요.',
    taboo: '쉼을 벌어야 하는 보상으로 두지 마세요.',
  },
  Distill: {
    name: '정제',
    lucky: '이미 살아온 규칙을 글로 남기세요.',
    taboo: '새 정체성을 선언하지 마세요.',
  },
  Threshold: {
    name: '문턱',
    lucky: '다음이 열리도록 문 하나를 닫으세요.',
    taboo: '세 번째 정체성 프로젝트를 시작하지 마세요.',
  },
}

export const PRISM_RELATION_KO: Record<string, string> = {
  SUPPORT: '흐름을 받침',
  RESONANCE: '같은 결',
  OUTPUT: '밖으로 씀',
  CHALLENGE: '부딪침',
  PRESSURE: '압박',
}

export const TAROT_POSITION_KO: Record<string, string> = {
  "Today's message": '오늘의 메시지',
  Past: '과거',
  Present: '현재',
  Future: '미래',
  Situation: '상황',
  Obstacle: '방해',
  Advice: '조언',
  External: '외부',
  Outcome: '결과',
  'The Present': '현재',
  'The Challenge': '과제',
  'The Past': '과거',
  'The Future': '미래',
  'Above (Conscious)': '의식',
  'Below (Unconscious)': '무의식',
  'External Influences': '외부 영향',
  'Hopes and Fears': '희망과 두려움',
}

const TAROT_MAJOR_KO = [
  '바보',
  '마법사',
  '여사제',
  '여황제',
  '황제',
  '교황',
  '연인',
  '전차',
  '힘',
  '은둔자',
  '운명의 수레바퀴',
  '정의',
  '매달린 사람',
  '죽음',
  '절제',
  '악마',
  '탑',
  '별',
  '달',
  '태양',
  '심판',
  '세계',
] as const

const TAROT_SUIT_KO: Record<string, string> = {
  Cups: '컵',
  Swords: '검',
  Wands: '지팡이',
  Pentacles: '펜타클',
}

const TAROT_RANK_KO: Record<string, string> = {
  Ace: '에이스',
  Two: '2',
  Three: '3',
  Four: '4',
  Five: '5',
  Six: '6',
  Seven: '7',
  Eight: '8',
  Nine: '9',
  Ten: '10',
  Page: '시종',
  Knight: '기사',
  Queen: '여왕',
  King: '왕',
}

export function tarotCardNameKo(englishName: string, id: number): string {
  if (id >= 0 && id < TAROT_MAJOR_KO.length) return TAROT_MAJOR_KO[id]!
  const match = /^(Ace|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Page|Knight|Queen|King) of (Cups|Swords|Wands|Pentacles)$/.exec(
    englishName,
  )
  if (!match) return englishName
  return `${TAROT_SUIT_KO[match[2]!]} ${TAROT_RANK_KO[match[1]!]}`
}

export function tarotPositionKo(label: string): string {
  return TAROT_POSITION_KO[label] ?? label
}

export const GYEOK_KO: Record<string, string> = {
  cheon: '천격',
  in: '인격',
  ji: '지격',
  oe: '외격',
  chong: '총격',
}

export const PALACE_KO: Record<string, string> = {
  命: '명궁',
  兄弟: '형제궁',
  夫妻: '부부궁',
  子女: '자녀궁',
  財帛: '재백궁',
  疾厄: '질액궁',
  遷移: '천이궁',
  交友: '교우궁',
  官祿: '관록궁',
  田宅: '전택궁',
  福德: '복덕궁',
  父母: '부모궁',
}

export const RUNE_KO: Record<string, string> = {
  Fehu: '페후',
  Uruz: '우루즈',
  Thurisaz: '투리사즈',
  Ansuz: '안수즈',
  Raidho: '라이도',
  Kenaz: '케나즈',
  Gebo: '게보',
  Wunjo: '운요',
  Hagalaz: '하갈라즈',
  Nauthiz: '나우디즈',
  Isa: '이사',
  Jera: '예라',
  Eihwaz: '에이와즈',
  Perthro: '페르트로',
  Algiz: '알기즈',
  Sowilo: '소비로',
  Tiwaz: '티와즈',
  Berkano: '베르카노',
  Ehwaz: '에와즈',
  Mannaz: '만나즈',
  Laguz: '라구즈',
  Ingwaz: '잉와즈',
  Dagaz: '다가즈',
  Othala: '오달라',
}

/** Rune spread position labels (engine RUNE_SPREAD_LABELS keys → Korean). */
export const RUNE_POSITION_KO: Record<string, string> = {
  "Today's rune": '오늘의 룬',
  Past: '과거',
  Present: '현재',
  Future: '미래',
  Situation: '상황',
  Obstacle: '방해',
  Advice: '조언',
  External: '외부',
  Outcome: '결과',
}

export function runePositionKo(label: string): string {
  return RUNE_POSITION_KO[label] ?? label
}

/** One line per stave for the drawn-rune display — keywords, not a reading. */
export const RUNE_MEANING_KO: Record<string, string> = {
  Fehu: '재물과 소득 — 손에 잡히는 결실',
  Uruz: '원초적 힘과 체력 — 밀고 나가는 기세',
  Thurisaz: '가시와 시련 — 방어와 돌파의 갈림',
  Ansuz: '전언과 통찰 — 귀 기울여야 할 말',
  Raidho: '여정과 리듬 — 움직임 속의 질서',
  Kenaz: '횃불과 기술 — 밝혀지는 앎',
  Gebo: '선물과 교환 — 주고받음의 균형',
  Wunjo: '기쁨과 화합 — 무리 안의 안온함',
  Hagalaz: '우박과 붕괴 — 통제 밖의 급변',
  Nauthiz: '결핍과 제약 — 필요가 가르치는 것',
  Isa: '얼음과 정지 — 멈춰서 지키는 시간',
  Jera: '수확과 주기 — 제철에 맺히는 결실',
  Eihwaz: '주목나무 — 끝과 시작을 잇는 축',
  Perthro: '운명의 잔 — 감춰진 것과 우연',
  Algiz: '엘크의 뿔 — 보호와 경계 태세',
  Sowilo: '태양 — 방향이 분명한 성공의 힘',
  Tiwaz: '전사의 별 — 원칙과 정당한 승부',
  Berkano: '자작나무 — 돌봄과 새로 자람',
  Ehwaz: '말(馬) — 신뢰로 함께 나아감',
  Mannaz: '사람 — 자기 자리와 공동체',
  Laguz: '물 — 직관과 흐름에 맡김',
  Ingwaz: '씨앗 — 안에서 무르익는 완성',
  Dagaz: '새벽 — 확연한 전환과 깨어남',
  Othala: '유산과 터전 — 물려받고 지키는 것',
}

export function oneDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export const ASPECT_KO: Record<string, string> = {
  conjunction: '합',
  opposition: '충',
  trine: '삼분',
  square: '사분',
  sextile: '육분',
}

export const WEEKDAY_KO = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'] as const

export const TRIGRAM_KO: Record<string, string> = {
  乾: '건',
  兑: '태',
  离: '이',
  震: '진',
  巽: '손',
  坎: '감',
  艮: '간',
  坤: '곤',
}

export const RELATIVE_KO: Record<string, string> = {
  兄弟: '형제',
  子孙: '자손',
  妻财: '처재',
  官鬼: '관귀',
  父母: '부모',
}

/** 월령 왕상휴수사. Hangul plus hanja so 수(囚) is not read as 오행 수. */
export const MONTH_PHASE_KO: Record<string, string> = {
  旺: '왕(旺)',
  相: '상(相)',
  休: '휴(休)',
  囚: '수(囚)',
  死: '사(死)',
}

export const BEAST_KO: Record<string, string> = {
  青龙: '청룡',
  朱雀: '주작',
  勾陈: '구진',
  螣蛇: '등사',
  白虎: '백호',
  玄武: '현무',
}

export const STAR_CATEGORY_KO: Record<string, string> = {
  major: '주성',
  lucky: '길성',
  malefic: '살성',
  minor: '소성',
}

export const COMPASS_KO: Record<string, string> = {
  north: '북',
  northeast: '북동',
  east: '동',
  southeast: '남동',
  south: '남',
  southwest: '남서',
  west: '서',
  northwest: '북서',
  center: '중앙',
}

export const DUN_KO: Record<string, string> = {
  yang: '양둔',
  yin: '음둔',
}

/** 三九の秘法 names, Korean readings. */
export const SUKUYOU_NAME_KO: Record<string, string> = {
  命: '명',
  業: '업',
  胎: '태',
  栄: '영',
  衰: '쇠',
  安: '안',
  危: '위',
  成: '성',
  壊: '괴',
  友: '우',
  親: '친',
}

/** Five 三九 groups: 命業胎 / 栄親 / 友衰 / 安壊 / 危成. */
export const SUKUYOU_SAN_KU_GROUP_KO: Record<string, string> = {
  命業胎: '명업태 (命業胎)',
  栄親: '영친 (栄親)',
  友衰: '우쇠 (友衰)',
  安壊: '안괴 (安壊)',
  危成: '위성 (危成)',
}

/** 궁합 관계 copy — two people, not natal-vs-today. */
export const SUKUYOU_PAIR_RELATION_KO: Record<string, string> = {
  命: '명 — 같은 자리, 거울 같은 사이',
  業胎: '업태 — 오래 이어진 인연의 사이',
  栄親: '영친 — 서로 살리고 북돋는 사이',
  友衰: '우쇠 — 벗처럼 편안한 사이',
  安壊: '안괴 — 강하게 끌리나 흔들리는 사이',
  危成: '위성 — 서로 자극하고 밀어붙이는 사이',
}

export function sukuyouSanKuGroup(name: string, pair: string): string {
  if (name === '命' || name === '業' || name === '胎' || pair === '命' || pair === '業胎') {
    return SUKUYOU_SAN_KU_GROUP_KO['命業胎']!
  }
  return SUKUYOU_SAN_KU_GROUP_KO[pair] ?? pair
}

export function sukuyouRelationNativeChart(relation: { name: string; pair: string }): {
  관계: string
  분류: string
} {
  return {
    관계: `${relation.name} (${SUKUYOU_NAME_KO[relation.name] ?? relation.name})`,
    분류: sukuyouSanKuGroup(relation.name, relation.pair),
  }
}
