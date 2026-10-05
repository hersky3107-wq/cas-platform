import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HOURLY_GRADING_SWEEP_MINUTE_WINDOW, shouldRunHourlyGradingSweep } from '../hourly-sweep'

const ROOT = join(__dirname, '../../..')

describe('hourly grading sweep gate', () => {
  it('runs in the first UTC minutes of the hour and not later', () => {
    expect(shouldRunHourlyGradingSweep(new Date('2026-10-05T04:00:00.000Z'))).toBe(true)
    expect(shouldRunHourlyGradingSweep(new Date('2026-10-05T04:02:59.000Z'))).toBe(true)
    expect(shouldRunHourlyGradingSweep(new Date('2026-10-05T04:03:00.000Z'))).toBe(false)
    expect(shouldRunHourlyGradingSweep(new Date('2026-10-05T04:45:00.000Z'))).toBe(false)
    expect(HOURLY_GRADING_SWEEP_MINUTE_WINDOW).toBe(3)
  })
})

describe('sweep contract — no target selection', () => {
  const recon = readFileSync(join(ROOT, 'lib/prediction/reconciliation.ts'), 'utf8')
  const core = readFileSync(join(ROOT, 'lib/prediction/grading-core.ts'), 'utf8')
  const cron = readFileSync(join(ROOT, 'app/api/cron/league-generate/route.ts'), 'utf8')

  it('gradeAllDueRounds stays a zero-arg verb', () => {
    expect(core).toMatch(/async function gradeAllDueRounds\(\)/)
    expect(recon).toMatch(/export async function gradeAllDueRounds\(\)/)
    expect(recon).toMatch(/export async function maybeGradeDueRoundsHourly\(/)
  })

  it('league-generate calls gradeAllDueRounds() with no selector', () => {
    expect(cron).toContain('shouldRunHourlyGradingSweep')
    expect(cron).toContain('gradeAllDueRounds()')
    expect(cron).not.toMatch(/gradeAllDueRounds\s*\([^)]+\)/)
  })
})
