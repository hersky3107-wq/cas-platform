/**
 * Namespace: `oracle.profile`
 *
 * Every user-facing string on `/modes/oracle/profile` lives here. Korean is
 * filled; the other seven locales currently alias the Korean pack so a later
 * translation pass only replaces values, not call sites.
 *
 * Engine terms (오격, 시진, 십신, 성명학, 수비학, 강희자전) are left in
 * Korean on purpose — they are the systems' own names, not UI chrome.
 */
import type { ProfileField } from '../system-requirements'
import type { OracleUiLocale } from './locales'
import { ORACLE_UI_DEFAULT_LOCALE } from './locales'

export const ORACLE_PROFILE_I18N_NAMESPACE = 'oracle.profile' as const

export const ORACLE_PROFILE_SURVEY_IDS = [
  'q1',
  'q2',
  'q3',
  'q4',
  'q5',
  'q6',
  'q7',
  'q8',
  'q9',
  'q10',
  'q11',
  'q12',
  'q13',
  'q14',
  'q15',
] as const
export type OracleProfileSurveyId = (typeof ORACLE_PROFILE_SURVEY_IDS)[number]

export const ORACLE_PROFILE_MBTI_IDS = [
  'ei1',
  'ei2',
  'sn1',
  'sn2',
  'tf1',
  'tf2',
  'jp1',
  'jp2',
] as const
export type OracleProfileMbtiId = (typeof ORACLE_PROFILE_MBTI_IDS)[number]

export type OracleProfileSurveyQuestionCopy = {
  text: string
  choices: readonly string[]
}

export type OracleProfileMbtiQuestionCopy = {
  prompt: string
  choices: readonly [string, string]
}

export type OracleProfileCopy = {
  backToLobby: string
  backToReading: string
  titleFull: string
  titleForSystem: (systemName: string) => string
  introFull: string
  introPartial: string
  loading: string
  dobLabel: string
  dobHint: string
  dobMonthAria: string
  dobDayAria: string
  dobYearAria: string
  monthPlaceholder: string
  months: readonly string[]
  dayPlaceholder: string
  yearPlaceholder: string
  dobInvalid: string
  cityLabel: string
  cityPlaceholder: string
  cityHint: string
  cityRequired: string
  genderLabel: string
  genderFemale: string
  genderMale: string
  genderPreferNot: string
  nameLabel: string
  nameScriptLabel: string
  nameUsedBy: string
  nameScriptHangul: string
  nameScriptHanja: string
  nameScriptJa: string
  nameScriptLatin: string
  nameFamily: string
  nameGiven: string
  nameNeedBoth: string
  nameMethodHangul: string
  nameMethodHanja: string
  nameMethodJa: string
  nameMethodLatin: string
  mbtiRequired: string
  mbtiCurrent: (type: string, estimated: boolean) => string
  timeLegend: string
  timeExact: string
  timeUnknown: string
  timeApproxOnFile: (midpoint: string) => string
  surveyIntro: string
  inferBusy: string
  inferDone: string
  inferNeedAll: string
  inferFailed: string
  inferRequestFailed: string
  saveFailed: string
  saveGenericError: string
  saving: string
  saveFull: string
  savePartial: string
  fieldReason: Record<ProfileField, string>
  survey: Record<OracleProfileSurveyId, OracleProfileSurveyQuestionCopy>
  mbti: {
    label: string
    help: string
    known: string
    unknown: string
    pickType: string
    useType: string
    useEstimate: (type: string) => string
    completeHint: string
    questions: Record<OracleProfileMbtiId, OracleProfileMbtiQuestionCopy>
  }
}

const KO: OracleProfileCopy = {
  backToLobby: '신탁으로 돌아가기',
  backToReading: '읽기로 돌아가기',
  titleFull: '출생 정보',
  titleForSystem: (systemName) => `${systemName}에 필요한 정보`,
  introFull:
    '현지 날짜 · 출생지 · 정확한 시각, 또는 15문항으로 시진을 추정합니다. Q1이 하루의 리듬을 잡습니다.',
  introPartial: '이미 저장된 값은 다시 묻지 않습니다. 이 체계에 필요한 항목만 보여 줍니다.',
  loading: '불러오는 중…',
  dobLabel: '생년월일 (현지)',
  dobHint: '월 / 일 / 연',
  dobMonthAria: '출생 월',
  dobDayAria: '출생 일',
  dobYearAria: '출생 연도',
  monthPlaceholder: '월',
  months: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
  dayPlaceholder: '일',
  yearPlaceholder: '연도',
  dobInvalid: '올바른 생년월일을 입력해 주세요.',
  cityLabel: '출생 도시 / 지역',
  cityPlaceholder: '예: 서울, 대한민국 / Tokyo, Japan / Paris, France',
  cityHint: '나라 이름을 함께 적어 주세요. 좌표는 이 도시로 찾으며, 서울로 임의 지정하지 않습니다.',
  cityRequired: '점성술을 위해 출생 도시가 필요합니다.',
  genderLabel: '성별 표현',
  genderFemale: '여성',
  genderMale: '남성',
  genderPreferNot: '응답하지 않음',
  nameLabel: '이름',
  nameScriptLabel: '이름 문자',
  nameUsedBy:
    '성명학이 이 이름을 씁니다. 한글·한자는 오격(획수)으로 읽고, 로마자는 수비학으로 넘깁니다.',
  nameScriptHangul: '한국어(한글)',
  nameScriptHanja: '한자',
  nameScriptJa: '일본어',
  nameScriptLatin: '영어·로마자',
  nameFamily: '성',
  nameGiven: '이름',
  nameNeedBoth: '성과 이름을 모두 적어 주세요.',
  nameMethodHangul: '한글 자모 획수로 성명학 오격을 계산합니다.',
  nameMethodHanja: '한자 강희자전 획수로 성명학 오격을 계산합니다.',
  nameMethodJa: '한자(漢字) 획수로 성명학 오격을 계산합니다.',
  nameMethodLatin: '성명학 대신 수비학으로 읽습니다.',
  mbtiRequired: '유형을 고르거나 추정 문항을 모두 답해 주세요.',
  mbtiCurrent: (type, estimated) => `현재 ${type}${estimated ? ' · 추정' : ''}`,
  timeLegend: '출생 시각 (현지)',
  timeExact: '정확한 시각을 알고 있습니다',
  timeUnknown: '정확한 시각을 모릅니다',
  timeApproxOnFile: (midpoint) =>
    `저장된 대략 시각이 있습니다 (중간값 ${midpoint}). 새 문항으로 시진을 다듬거나, 저장하면 이 시각을 유지합니다.`,
  surveyIntro: '문항을 모두 답하면 시진이 자동으로 추정됩니다. Q1이 하루의 기운을 잡습니다.',
  inferBusy: '답으로 시진을 추정하는 중…',
  inferDone: '시진을 추정해 저장했습니다 ✓',
  inferNeedAll: '열다섯 문항을 모두 답하면 자동으로 추정합니다.',
  inferFailed: '시진을 추정하지 못했습니다.',
  inferRequestFailed: '추정 요청이 실패했습니다.',
  saveFailed: '저장에 실패했습니다.',
  saveGenericError: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  saving: '저장하는 중…',
  saveFull: '출생 정보 저장',
  savePartial: '저장하고 읽기로',
  fieldReason: {
    birth_date: '이 체계는 생년월일이 필요합니다.',
    sex: '사주 대운·자미 대한 방향에 성별이 쓰입니다. 밝히고 싶지 않으면 ‘응답하지 않음’을 고르면 됩니다.',
    birth_place: '점성술은 출생 도시로 좌표를 잡습니다. 서울로 임의 지정하지 않습니다.',
    name: '성명학은 문자(한글·한자·로마자)와 성·이름이 필요합니다.',
    name_latin: '수비학 이름 수는 로마자 이름이 있으면 더해집니다. 없어도 생년월일만으로 읽습니다.',
    mbti: 'PRISM은 MBTI를 씁니다. 모르면 짧은 문항으로 추정할 수 있습니다. 외부 검사는 필요 없습니다.',
  },
  survey: {
    q1: {
      text: 'Q1. 언제 가장 생기 있고 맑은 편인가요?',
      choices: [
        '늦은 밤에서 새벽 (밤 11시–새벽 3시)',
        '이른 아침, 자연스럽게 깬다 (새벽 3시–오전 7시)',
        '오전 중반부터 (오전 7시–11시)',
        '정오 무렵, 한낮에 가장 힘난다 (오전 11시–오후 1시)',
        '오후가 되어서야 제대로 움직인다 (오후 1시–5시)',
        '저녁과 밤이 전성기다 (오후 5시–밤 11시)',
      ],
    },
    q2: {
      text: 'Q2. 어떻게 말하는 편인가요?',
      choices: [
        '빠르고 단정하다 — 바로 본론으로 간다',
        '천천히 꼼꼼하다 — 끝까지 설명한다',
        '상황에 따라 다르다',
      ],
    },
    q3: {
      text: 'Q3. 감정은 어떻게 드러나나요?',
      choices: [
        '얼굴에 바로 드러난다',
        '속에 담고 잘 보이지 않는다',
        '표현하지만 금방 가라앉는다',
      ],
    },
    q4: {
      text: 'Q4. 결정은 어떻게 내리나요?',
      choices: [
        '직감으로 빠르게 — 감을 믿는다',
        '신중하게 — 따져 보고 정한다',
        '다른 사람과 상의한 뒤에 정한다',
      ],
    },
    q5: {
      text: 'Q5. 갈등이 생기면 나는',
      choices: ['바로 맞선다', '한 걸음 물러났다가 나중에 푼다', '중재하며 타협점을 찾는다'],
    },
    q6: {
      text: 'Q6. 기운의 패턴에 가까운 것은?',
      choices: [
        '한 번 시작하면 끝까지 밀어붙인다',
        '시작은 강한데 중간에 힘이 빠진다',
        '시작은 느려도 갈수록 세진다',
      ],
    },
    q7: {
      text: 'Q7. 돈에 대한 태도는?',
      choices: [
        '흐름대로 쓰고 그 흐름을 즐긴다',
        '아껴 모으고 낭비를 싫어한다',
        '필요할 때를 빼면 거의 무심하다',
      ],
    },
    q8: {
      text: 'Q8. 스트레스는 어떻게 푸나요?',
      choices: [
        '몸을 움직이거나 밖으로 나간다',
        '혼자 생각하며 리셋한다',
        '누군가와 이야기한다',
        '먹거나 자며 넘긴다',
      ],
    },
    q9: {
      text: 'Q9. 사람 사이에서는',
      choices: [
        '낯선 이와도 쉽게 빨리 연결된다',
        '여는 데 시간이 걸리지만 깊게 간다',
        '아는 사람은 많지만 얇게 유지한다',
      ],
    },
    q10: {
      text: 'Q10. 가장 두려운 것은?',
      choices: [
        '상황을 통제하지 못하는 것',
        '혼자 남겨지는 것',
        '실패하거나 사람들 앞에서 망신당하는 것',
        '변화와 불확실성',
      ],
    },
    q11: {
      text: 'Q11. 얼굴형',
      choices: [
        '타원·긴 형, 이마가 드러난다',
        '둥글고 볼이 가득하다',
        '네모·각진 형, 광대가 뚜렷하다',
        '역삼각형, 이마가 넓고 턱이 좁다',
      ],
    },
    q12: {
      text: 'Q12. 눈',
      choices: [
        '크고 또렷하다 — 눈빛이 강하다',
        '가늘고 길다 — 꿰뚫는 눈',
        '부드럽다 — 온기가 있다',
        '작지만 깊다 — 조용히 살핀다',
      ],
    },
    q13: {
      text: 'Q13. 체형',
      choices: ['키 크고 가늘다', '단단하고 근육질이다', '부드럽고 풍성하다', '작고 움직임이 빠르다'],
    },
    q14: {
      text: 'Q14. 피부톤',
      choices: [
        '맑고 하얗다',
        '불그스름하거나 홍조가 있다',
        '따뜻한 금빛·갈색',
        '어둡거나 차가운 기운',
      ],
    },
    q15: {
      text: 'Q15. 손',
      choices: ['손가락이 길고 가늘다', '손바닥이 두껍고 넓다', '작고 단단하다', '따뜻하고 붉은 편이다'],
    },
  },
  mbti: {
    label: 'MBTI',
    help: '유형을 알고 있으면 고르고, 모르면 짧은 문항으로 추정합니다. 외부 검사는 필요 없습니다.',
    known: '알고 있어요',
    unknown: '모르겠어요',
    pickType: '유형 선택',
    useType: '이 유형으로 사용',
    useEstimate: (type) => `추정 결과 ${type} 사용`,
    completeHint: '여덟 문항을 모두 답하면 유형이 정해집니다.',
    questions: {
      ei1: {
        prompt: '주말에 에너지가 차는 쪽은?',
        choices: ['사람과 만나고 나서 더 살아난다', '혼자 있거나 가까운 소수와 있을 때 회복된다'],
      },
      ei2: {
        prompt: '생각이 막혔을 때 먼저 하는 일은?',
        choices: ['바로 말해 보며 정리한다', '먼저 혼자 정리한 뒤에 말한다'],
      },
      sn1: {
        prompt: '설명을 들을 때 더 편한 쪽은?',
        choices: ['구체적인 사실과 순서', '큰 그림과 가능성'],
      },
      sn2: {
        prompt: '일을 시작할 때 더 자주 묻는 질문은?',
        choices: ['지금 실제로 무엇이 필요한가', '이게 어디로 이어질 수 있는가'],
      },
      tf1: {
        prompt: '결정을 내릴 때 더 먼저 보는 것은?',
        choices: ['논리와 기준이 맞는지', '사람과의 영향이 어떤지'],
      },
      tf2: {
        prompt: '피드백을 줄 때 더 가까운 태도는?',
        choices: ['정확히 짚어 주는 쪽', '상대가 받을 수 있게 다듬는 쪽'],
      },
      jp1: {
        prompt: '하루를 보내는 방식에 더 가까운 것은?',
        choices: ['정해 두고 끝내는 편이 편하다', '열어 두고 상황에 맞추는 편이 편하다'],
      },
      jp2: {
        prompt: '여행이나 일정을 잡을 때?',
        choices: ['대략의 계획이라도 있어야 마음이 놓인다', '그날의 흐름에 맡기는 쪽이 살아 있다'],
      },
    },
  },
}

/**
 * Eight locale slots. Non-Korean packs alias Korean until they are translated.
 * Assigning `KO` (not a partial) keeps the type a full `OracleProfileCopy`.
 */
export const oracleProfileCopy: Record<OracleUiLocale, OracleProfileCopy> = {
  ko: KO,
  en: KO,
  ja: KO,
  'zh-TW': KO,
  fr: KO,
  ar: KO,
  es: KO,
  pt: KO,
}

export function getOracleProfileCopy(locale: OracleUiLocale = ORACLE_UI_DEFAULT_LOCALE): OracleProfileCopy {
  return oracleProfileCopy[locale] ?? oracleProfileCopy[ORACLE_UI_DEFAULT_LOCALE]
}

/** Leaf-string count helper for the extraction report / i18n test. */
export function countOracleProfileCopyStrings(copy: OracleProfileCopy): number {
  return countLeaves(copy)
}

function countLeaves(value: unknown): number {
  if (typeof value === 'string') return 1
  if (typeof value === 'function') return 1
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countLeaves(item), 0)
  if (value && typeof value === 'object') {
    return Object.values(value).reduce<number>((sum, item) => sum + countLeaves(item), 0)
  }
  return 0
}
