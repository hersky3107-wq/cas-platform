/**
 * Throwaway probe — resolveFestivalRegion() nationwide sanity check.
 *
 * Run from project root:
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/probe-festival-region.ts
 */

import { resolveFestivalRegion } from '@/lib/festival/connectors'

const INPUTS = [
  '경상북도 경주시',
  '부산광역시 해운대구',
  '경주시',
  '부산',
  '전주시',
  '여수시',
] as const

async function main() {
  console.log('resolveFestivalRegion() — nationwide sanity check\n')

  for (const region of INPUTS) {
    const r = await resolveFestivalRegion(region)
    console.log(`Input: "${region}"`)
    console.log(JSON.stringify(
      {
        ok: r.ok,
        areaCode: r.areaCode,
        areaName: r.areaName,
        sigunguCode: r.sigunguCode,
        sigunguName: r.sigunguName,
        note: r.note,
      },
      null,
      2
    ))
    console.log('')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
