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

export function oneDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
