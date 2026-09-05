import type { SystemId } from './axes/types'

export type SingleSystemId = SystemId

export type SingleSystemCopy = {
  id: SingleSystemId
  name: string
  shortName: string
  symbol: string
  explanation: readonly [string, string, string, string]
}

export const SINGLE_SYSTEMS: readonly SingleSystemCopy[] = [
  {
    id: 'saju',
    name: '사주명리',
    shortName: '사주',
    symbol: '四',
    explanation: [
      '태어난 연·월·일·시를 네 개의 기둥으로 읽습니다.',
      '오행의 균형과 십성의 관계로 타고난 성향을 살핍니다.',
      '대운과 세운의 흐름을 더해 지금의 시기를 해석합니다.',
      '출생 시간을 모르면 시주가 빠져 일부 판단의 비중이 낮아집니다.',
    ],
  },
  {
    id: 'astro',
    name: '서양 점성술',
    shortName: '점성술',
    symbol: '✦',
    explanation: [
      '태어난 순간의 태양·달·행성 위치를 별자리로 펼칩니다.',
      '행성 간 각도와 별자리 배치로 성향과 관계를 읽습니다.',
      '현재 행성의 이동을 출생 차트와 겹쳐 변화의 시기를 봅니다.',
      '출생 시간을 모르면 상승궁과 하우스 없이 축소해 해석합니다.',
    ],
  },
  {
    id: 'prism',
    name: 'PRISM-5',
    shortName: 'PRISM',
    symbol: '◆',
    explanation: [
      '생년월일과 MBTI, 세 가지 색 선택으로 지금의 상태를 읽습니다.',
      '충동·필요·정체성의 색이 겹치지 않게 골라 성향의 결을 봅니다.',
      '색의 조합과 성격 유형이 만드는 긴장과 조화를 함께 살핍니다.',
      '색을 고르지 않으면 이 체계는 결과를 내지 않습니다.',
    ],
  },
  {
    id: 'ziwei',
    name: '자미두수',
    shortName: '자미두수',
    symbol: '紫',
    explanation: [
      '동양의 별들을 열두 궁에 배치해 삶의 구조를 읽습니다.',
      '명궁·재백궁·관록궁처럼 주제별 궁의 힘을 비교합니다.',
      '주성과 보조성의 밝기, 변화하는 사화를 함께 살핍니다.',
      '출생 시간이 없으면 궁 배치가 제한되어 낮은 비중으로 참여합니다.',
    ],
  },
  {
    id: 'numerology',
    name: '수비학',
    shortName: '수비학',
    symbol: '№',
    explanation: [
      '생년월일을 핵심 숫자로 환산해 삶의 기본 리듬을 읽습니다.',
      '라이프 패스와 생일 수가 반복되는 선택의 경향을 보여 줍니다.',
      '개인 연도 수로 올해의 주제와 속도를 함께 살핍니다.',
      '이름 정보가 없을 때는 생년월일 숫자만으로 해석합니다.',
    ],
  },
  {
    id: 'name',
    name: '성명학',
    shortName: '성명학',
    symbol: '名',
    explanation: [
      '이름의 글자 구조와 음양·오행 배치를 분석합니다.',
      '성씨와 이름이 만드는 격을 나누어 성향과 관계를 봅니다.',
      '한글·한자·로마자 가운데 저장된 이름 정보를 사용합니다.',
      '읽을 수 있는 이름 정보가 없으면 이 체계는 결과를 내지 않습니다.',
    ],
  },
  {
    id: 'iching',
    name: '주역',
    shortName: '주역',
    symbol: '易',
    explanation: [
      '여섯 효로 이루어진 괘를 뽑아 현재 상황의 구조를 봅니다.',
      '본괘는 지금의 상태, 변효와 변괘는 변화의 방향을 나타냅니다.',
      '질문이 구체적일수록 상징을 현실의 선택에 연결하기 쉽습니다.',
      '정답을 단정하기보다 움직일 때와 멈출 때를 비교하는 방식입니다.',
    ],
  },
  {
    id: 'tarot',
    name: '타로',
    shortName: '타로',
    symbol: '✧',
    explanation: [
      '여러 장의 카드를 한 번의 배열로 뽑아 흐름을 읽습니다.',
      '각 카드의 상징과 놓인 위치가 서로 어떤 이야기를 만드는지 봅니다.',
      '현재 상황, 방해 요소, 조언과 가능한 결과를 나누어 살핍니다.',
      '질문이 없으면 지금 가장 두드러진 삶의 주제를 중심으로 읽습니다.',
    ],
  },
  {
    id: 'runes',
    name: '룬',
    shortName: '룬',
    symbol: 'ᚱ',
    explanation: [
      '북유럽 문자 룬을 뽑아 지금 작동하는 힘을 살핍니다.',
      '각 룬은 행동, 제약, 변화 같은 원형적 주제를 담고 있습니다.',
      '여러 룬의 순서와 방향을 연결해 상황의 진행을 읽습니다.',
      '간결한 상징 체계라 질문의 핵심을 선명하게 비추는 데 적합합니다.',
    ],
  },
  {
    id: 'ninestar',
    name: '구성기학',
    shortName: '구성기학',
    symbol: '九',
    explanation: [
      '생년월일로 본명성·월명성·일명성을 계산합니다.',
      '아홉 별과 오행의 관계로 기본 기질과 반응 방식을 봅니다.',
      '현재의 별 흐름을 출생 별과 비교해 시기의 분위기를 읽습니다.',
      '출생 시간이 없으면 일부 계산에 정오 기준을 쓰고 비중을 낮춥니다.',
    ],
  },
  {
    id: 'sukuyou',
    name: '숙요점성술',
    shortName: '숙요',
    symbol: '宿',
    explanation: [
      '달의 주기에서 태어난 날의 숙을 찾아 성향을 읽습니다.',
      '스물일곱 숙의 관계로 사람 사이의 거리와 역할을 살핍니다.',
      '현재 날짜의 숙과 겹쳐 오늘의 흐름과 주의점을 봅니다.',
      '날짜 중심 체계라 출생 시간을 몰라도 기본 계산이 가능합니다.',
    ],
  },
  {
    id: 'tzolkin',
    name: '마야 촐킨',
    shortName: '촐킨',
    symbol: '◉',
    explanation: [
      '생년월일을 260일의 마야 신성력 좌표로 바꿉니다.',
      '스무 개의 문양과 열세 개의 톤이 만드는 조합을 읽습니다.',
      '타고난 역할과 현재 날짜의 에너지가 만나는 지점을 살핍니다.',
      '시간과 장소보다 달력의 순환을 중심으로 보는 체계입니다.',
    ],
  },
] as const

export const SINGLE_SYSTEM_BY_ID = Object.fromEntries(
  SINGLE_SYSTEMS.map((system) => [system.id, system]),
) as Record<SingleSystemId, SingleSystemCopy>
