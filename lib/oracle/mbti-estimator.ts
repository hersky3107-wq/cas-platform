/**
 * Short MBTI estimator for PRISM. Same idea as the 15-question 시진 path:
 * the user who does not already know their type answers here, and we store
 * the result as estimated rather than sending them to an external test.
 *
 * Scoring is local (no model call). Ties lean I / N / F / P.
 */
import { MBTI_TYPES, type MbtiType } from '@/lib/oracle/engines/prism/tables'

export type MbtiPole = 'E' | 'I' | 'S' | 'N' | 'T' | 'F' | 'J' | 'P'

export type MbtiEstimatorChoice = {
  pole: MbtiPole
  label: string
}

export type MbtiEstimatorQuestion = {
  id: string
  prompt: string
  choices: readonly [MbtiEstimatorChoice, MbtiEstimatorChoice]
}

export const MBTI_ESTIMATOR_QUESTIONS: readonly MbtiEstimatorQuestion[] = [
  {
    id: 'ei1',
    prompt: '주말에 에너지가 차는 쪽은?',
    choices: [
      { pole: 'E', label: '사람과 만나고 나서 더 살아난다' },
      { pole: 'I', label: '혼자 있거나 가까운 소수와 있을 때 회복된다' },
    ],
  },
  {
    id: 'ei2',
    prompt: '생각이 막혔을 때 먼저 하는 일은?',
    choices: [
      { pole: 'E', label: '바로 말해 보며 정리한다' },
      { pole: 'I', label: '먼저 혼자 정리한 뒤에 말한다' },
    ],
  },
  {
    id: 'sn1',
    prompt: '설명을 들을 때 더 편한 쪽은?',
    choices: [
      { pole: 'S', label: '구체적인 사실과 순서' },
      { pole: 'N', label: '큰 그림과 가능성' },
    ],
  },
  {
    id: 'sn2',
    prompt: '일을 시작할 때 더 자주 묻는 질문은?',
    choices: [
      { pole: 'S', label: '지금 실제로 무엇이 필요한가' },
      { pole: 'N', label: '이게 어디로 이어질 수 있는가' },
    ],
  },
  {
    id: 'tf1',
    prompt: '결정을 내릴 때 더 먼저 보는 것은?',
    choices: [
      { pole: 'T', label: '논리와 기준이 맞는지' },
      { pole: 'F', label: '사람과의 영향이 어떤지' },
    ],
  },
  {
    id: 'tf2',
    prompt: '피드백을 줄 때 더 가까운 태도는?',
    choices: [
      { pole: 'T', label: '정확히 짚어 주는 쪽' },
      { pole: 'F', label: '상대가 받을 수 있게 다듬는 쪽' },
    ],
  },
  {
    id: 'jp1',
    prompt: '하루를 보내는 방식에 더 가까운 것은?',
    choices: [
      { pole: 'J', label: '정해 두고 끝내는 편이 편하다' },
      { pole: 'P', label: '열어 두고 상황에 맞추는 편이 편하다' },
    ],
  },
  {
    id: 'jp2',
    prompt: '여행이나 일정을 잡을 때?',
    choices: [
      { pole: 'J', label: '대략의 계획이라도 있어야 마음이 놓인다' },
      { pole: 'P', label: '그날의 흐름에 맡기는 쪽이 살아 있다' },
    ],
  },
]

export type MbtiEstimatorAnswers = Record<string, MbtiPole>

const TIE: Record<'EI' | 'SN' | 'TF' | 'JP', MbtiPole> = {
  EI: 'I',
  SN: 'N',
  TF: 'F',
  JP: 'P',
}

function pickPole(
  answers: MbtiEstimatorAnswers,
  a: MbtiPole,
  b: MbtiPole,
  pair: keyof typeof TIE,
): MbtiPole {
  let left = 0
  let right = 0
  for (const question of MBTI_ESTIMATOR_QUESTIONS) {
    const pole = answers[question.id]
    if (pole === a) left += 1
    if (pole === b) right += 1
  }
  if (left > right) return a
  if (right > left) return b
  return TIE[pair]
}

export function answersComplete(answers: Partial<MbtiEstimatorAnswers>): answers is MbtiEstimatorAnswers {
  return MBTI_ESTIMATOR_QUESTIONS.every((question) => typeof answers[question.id] === 'string')
}

export function estimateMbti(answers: MbtiEstimatorAnswers): MbtiType {
  const type = [
    pickPole(answers, 'E', 'I', 'EI'),
    pickPole(answers, 'S', 'N', 'SN'),
    pickPole(answers, 'T', 'F', 'TF'),
    pickPole(answers, 'J', 'P', 'JP'),
  ].join('')
  if (!(MBTI_TYPES as readonly string[]).includes(type)) {
    throw new Error(`estimator produced unknown MBTI "${type}"`)
  }
  return type as MbtiType
}
