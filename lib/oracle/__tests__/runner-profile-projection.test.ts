import { describe, expect, it } from 'vitest'
import { normalizeBirthTime, projectV1ToRunnerProfile } from '../runner-profile-projection'
import type { OracleBirthProfileV1 } from '../types'

function sketch(patch: Partial<OracleBirthProfileV1> = {}): OracleBirthProfileV1 {
  return {
    version: 1,
    dob: '1990-03-04',
    birth_city: 'Seoul, South Korea',
    gender: 'female',
    birth_time_known: true,
    birth_time_24h: '09:05',
    ...patch,
  }
}

describe('projectV1ToRunnerProfile', () => {
  it('carries an exact clock time through as exact', () => {
    expect(projectV1ToRunnerProfile(sketch())).toEqual({
      birth_date: '1990-03-04',
      birth_time: '09:05:00',
      birth_time_source: 'exact',
      sex: 'F',
      birth_place: 'Seoul, South Korea',
      survey_answers: null,
    })
  })

  it('maps a 15-question survey result to estimated and keeps the HH:mm', () => {
    const projected = projectV1ToRunnerProfile(
      sketch({
        birth_time_known: false,
        time_from_survey: true,
        birth_time_24h: '3:30',
        resolved_sijin_kr: '인시',
        survey_selections: { q1: 2, q2: 0 },
      }),
    )
    expect(projected.birth_time).toBe('03:30:00')
    expect(projected.birth_time_source).toBe('estimated')
    expect(projected.survey_answers).toEqual({ q1: 2, q2: 0 })
  })

  it('treats a legacy approximate band as estimated', () => {
    const projected = projectV1ToRunnerProfile(
      sketch({ birth_time_known: false, time_approx_band: 'EVENING', birth_time_24h: '19:30' }),
    )
    expect(projected.birth_time_source).toBe('estimated')
    expect(projected.birth_time).toBe('19:30:00')
  })

  it('reports unknown with a null time when no clock value survives', () => {
    const projected = projectV1ToRunnerProfile(
      sketch({ birth_time_known: false, birth_time_24h: null }),
    )
    expect(projected.birth_time_source).toBe('unknown')
    expect(projected.birth_time).toBeNull()
  })

  it('maps gender to the 대운-direction sex, and nothing else', () => {
    expect(projectV1ToRunnerProfile(sketch({ gender: 'male' })).sex).toBe('M')
    expect(projectV1ToRunnerProfile(sketch({ gender: 'female' })).sex).toBe('F')
    expect(projectV1ToRunnerProfile(sketch({ gender: 'prefer_not_to_say' })).sex).toBeNull()
  })

  it('normalizes a blank birth city to null', () => {
    expect(projectV1ToRunnerProfile(sketch({ birth_city: '   ' })).birth_place).toBeNull()
  })
})

describe('normalizeBirthTime', () => {
  it('pads single-digit hours and rejects nonsense', () => {
    expect(normalizeBirthTime('9:05')).toBe('09:05:00')
    expect(normalizeBirthTime('23:59')).toBe('23:59:00')
    expect(normalizeBirthTime('24:00')).toBeNull()
    expect(normalizeBirthTime('9:5')).toBeNull()
    expect(normalizeBirthTime(null)).toBeNull()
  })
})
