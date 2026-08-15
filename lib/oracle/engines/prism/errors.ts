export type PrismErrorCode =
  | 'duplicate_colors'
  | 'invalid_mbti'
  | 'invalid_color'
  | 'invalid_date'
  | 'invalid_micro_check'

export class PrismInputError extends Error {
  readonly code: PrismErrorCode

  constructor(code: PrismErrorCode, message: string) {
    super(`prism engine: ${message}`)
    this.name = 'PrismInputError'
    this.code = code
  }
}
