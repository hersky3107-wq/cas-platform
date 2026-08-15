export type ZiweiErrorCode = 'invalid_date' | 'invalid_time' | 'invalid_sex'

export class ZiweiInputError extends Error {
  readonly code: ZiweiErrorCode

  constructor(code: ZiweiErrorCode, message: string) {
    super(`ziwei engine: ${message}`)
    this.name = 'ZiweiInputError'
    this.code = code
  }
}
