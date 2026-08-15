export type NameErrorCode =
  | 'empty_surname'
  | 'empty_given_name'
  | 'invalid_hangul'
  | 'unknown_hanja'

export class NameInputError extends Error {
  readonly code: NameErrorCode

  constructor(code: NameErrorCode, message: string) {
    super(`name engine: ${message}`)
    this.name = 'NameInputError'
    this.code = code
  }
}
