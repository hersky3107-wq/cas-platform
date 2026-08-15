export type NumerologyInput = {
  /** YYYY-MM-DD */
  birthDate: string
  latinName?: string | null
  /** YYYY-MM-DD — personal year/month are relative to this date. */
  atDate: string
}

export type NumerologyResult = {
  lifePath: number
  birthdayNumber: number
  personalYear: number
  personalMonth: number
  expression: number | null
  soulUrge: number | null
  personality: number | null
  limitations: Array<'no_latin_name'>
}
