export type Gender = 'male' | 'female' | 'prefer_not_to_say'

export type ApproxBirthBand =
  | 'EARLY_MORNING'
  | 'MORNING'
  | 'MIDDAY'
  | 'AFTERNOON'
  | 'EVENING'
  | 'NIGHT'

export type OracleBirthProfileV1 = {
  version: 1
  /** YYYY-MM-DD */
  dob: string
  birth_city: string
  gender: Gender
  birth_time_known: boolean
  /** HH:mm 24h when known */
  birth_time_24h: string | null
  /** When user picks a band instead of exact time */
  time_approx_band?: ApproxBirthBand | null
  /** When infer-time-from-survey was used */
  time_from_survey?: boolean
  /** q1-q15 index selections (integer option index per question) */
  survey_selections?: Partial<Record<`q${number}`, number>>
  resolved_sijin_kr?: string | null
  completed_at?: string
}
