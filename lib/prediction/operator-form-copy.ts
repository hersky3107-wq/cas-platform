/**
 * Operator-console copy (Korean). Admin-only; not the public card dictionary.
 *
 * Occurrence radios state a fact about the world, tied to the proposition
 * above them. They are not a side pick and not a verdict on the models.
 */

export const OPERATOR_OCCURRENCE_FORM_KO = {
  intro:
    '아래에 고르는 것은 명제가 가리키는 일이 세상에 일어났는지입니다. 모델이 맞았는지 틀렸는지는 고르지 않습니다.',
  propositionLabel: '이 라운드의 명제',
  choiceLegend: '확인한 사실',
  occurred: '명제한 일이 발생했다',
  didNotOccur: '명제한 일이 발생하지 않았다',
  urlLabel: '근거 URL (https)',
  factLabel: '확인한 내용',
  factHint:
    '출처에서 읽은 사실(제목·날짜·공시 번호 등). 실현/불발, yes/no, 정답/오답은 적지 마세요.',
  submit: '근거 제출',
  submitting: '매핑 중…',
} as const

export const OPERATOR_NAME_MATCH_FORM_KO = {
  intro:
    '공개된 https URL과 출처에 적힌 이름(승자·당선인·수상자)을 입력하세요. 프로그램이 라운드 대상과 대조합니다. 승자를 고르지 마세요.',
  urlLabel: '근거 URL (https)',
  factLabel: '확인한 이름',
  factHint: '출처에 인쇄된 이름. yes/no나 정답/오답은 적지 마세요.',
  submit: '근거 제출',
  submitting: '매핑 중…',
} as const

/** Keys the operator API rejects — a side token or a model verdict. */
export const OPERATOR_FORBIDDEN_VERDICT_KEYS = [
  'side',
  'derived_side',
  'winner',
  'correct',
  'incorrect',
  'is_correct',
  'verdict',
] as const
