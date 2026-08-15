/**
 * Typed errors for the pure calendar engine. Pure module: no DB, no network, no LLM.
 */

export class CalendarRangeError extends Error {
  readonly year: number

  constructor(year: number) {
    super(`calendar engine: year ${year} is outside the supported range 1900-2100`)
    this.name = 'CalendarRangeError'
    this.year = year
  }
}

export class CalendarInputError extends Error {
  constructor(message: string) {
    super(`calendar engine: ${message}`)
    this.name = 'CalendarInputError'
  }
}
