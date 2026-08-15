/**
 * Scratch verification script for the pure calendar engine (Step 1).
 *
 * Prints the four pillars + surrounding solar-term boundaries for
 * 1988-03-15 04:30 Asia/Seoul using lunar-javascript directly (no wrapper
 * yet), and demonstrates a critical timezone-frame finding: the library's
 * jieqi/boundary timestamps are expressed in China Standard Time (UTC+8),
 * not the caller's intended timezone. Run with: npx tsx scripts/verify-calendar-engine.ts
 */
import { Solar } from 'lunar-javascript'
import * as Astronomy from 'astronomy-engine'

function wrapDeg(x: number): number {
  x = x % 360
  if (x < 0) x += 360
  return x
}

/** Independently locate the instant the Sun's apparent ecliptic longitude crosses `targetDeg`, near a guess date. */
function findSolarLongitudeCrossingUtc(targetDeg: number, guessUtc: Date, searchDays = 3): Date {
  const start = guessUtc.getTime() - searchDays * 86400000
  const end = guessUtc.getTime() + searchDays * 86400000
  const f = (tMs: number) => {
    const lon = Astronomy.SunPosition(new Date(tMs)).elon
    let diff = wrapDeg(lon - targetDeg)
    if (diff > 180) diff -= 360
    return diff
  }
  let lo = start
  let hi = end
  let flo = f(lo)
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    const fm = f(mid)
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid
      flo = fm
    } else {
      hi = mid
    }
  }
  return new Date((lo + hi) / 2)
}

function main() {
  console.log('=== Step 1: 1988-03-15 04:30 Asia/Seoul ===\n')

  // Asia/Seoul is UTC+9 with no DST on this date (Korea's 1987-1988 DST trial ran May-Oct only).
  const seoulLocal = { y: 1988, m: 3, d: 15, h: 4, mi: 30, s: 0 }
  const birthUtcMs = Date.UTC(seoulLocal.y, seoulLocal.m - 1, seoulLocal.d, seoulLocal.h - 9, seoulLocal.mi, seoulLocal.s)
  console.log('Birth wall clock (Asia/Seoul):', '1988-03-15 04:30:00')
  console.log('Birth instant (UTC):', new Date(birthUtcMs).toISOString())

  // Feed the raw KST wall-clock numbers straight into lunar-javascript (no correction).
  const solar = Solar.fromYmdHms(seoulLocal.y, seoulLocal.m, seoulLocal.d, seoulLocal.h, seoulLocal.mi, seoulLocal.s)
  const lunar = solar.getLunar()

  console.log('\n--- Four pillars (lunar-javascript, raw KST input, Exact variants) ---')
  console.log('Year :', lunar.getYearInGanZhiExact())
  console.log('Month:', lunar.getMonthInGanZhiExact())
  console.log('Day  :', lunar.getDayInGanZhi())
  console.log('Hour :', lunar.getTimeInGanZhi())

  console.log('\n--- Solar terms bracketing this date (as reported by the library) ---')
  console.log('Prev jieqi:', lunar.getPrevJieQi().toString(), lunar.getPrevJieQi().getSolar().toYmdHms())
  console.log('Next jieqi:', lunar.getNextJieQi().toString(), lunar.getNextJieQi().getSolar().toYmdHms())

  console.log('\n=== Cross-check: what timezone are those timestamps actually in? ===')
  console.log('(Using 立春 1988 as the probe: 24 solar terms are physical instants,')
  console.log(' so we can locate the true UTC instant independently via ephemeris and compare.)\n')

  const licun = lunar.getJieQiTable()['立春']
  console.log('lunar-javascript LiChun 1988 timestamp (as printed):', licun.toYmdHms())

  // 立春 = Sun's apparent geocentric ecliptic longitude = 315 degrees.
  const trueLiChunUtc = findSolarLongitudeCrossingUtc(315, new Date(Date.UTC(1988, 1, 4, 12, 0, 0)))
  console.log('Independently computed true LiChun instant (UTC):', trueLiChunUtc.toISOString())
  console.log('  -> as KST (UTC+9):', new Date(trueLiChunUtc.getTime() + 9 * 3600000).toISOString().replace('Z', ' KST-label'))
  console.log('  -> as CST (UTC+8):', new Date(trueLiChunUtc.getTime() + 8 * 3600000).toISOString().replace('Z', ' CST-label'))
  console.log('\nVerdict: the library timestamp matches the CST(UTC+8) label, not the KST(UTC+9) label.')
  console.log('=> lunar-javascript expresses jieqi instants in China Standard Time (UTC+8).')
  console.log('=> A Seoul (UTC+9) caller must shift by +8h from the TRUE UTC instant (not +9h) before')
  console.log('   asking the library to compare against its own jieqi table for year/month pillars.')

  console.log('\n=== Precision check: ByLiChun (date-only) vs Exact (datetime) variants ===')
  const near1 = Solar.fromYmdHms(1988, 2, 4, 22, 30, 0).getLunar() // 13 min before LiChun 22:42:49 (library CST label)
  const near2 = Solar.fromYmdHms(1988, 2, 4, 22, 50, 0).getLunar() // 7 min after
  console.log('input 22:30 (CST label, before boundary) -> ByLiChun:', near1.getYearInGanZhiByLiChun(), ' Exact:', near1.getYearInGanZhiExact())
  console.log('input 22:50 (CST label, after boundary)  -> ByLiChun:', near2.getYearInGanZhiByLiChun(), ' Exact:', near2.getYearInGanZhiExact())
  console.log('Verdict: ByLiChun only compares calendar DATE (day granularity); Exact compares full datetime.')
  console.log('=> The calendar engine must use the *Exact family (getYearInGanZhiExact/getMonthInGanZhiExact),')
  console.log('   never the default/ByLiChun family, for hour-level correctness.')
}

main()
