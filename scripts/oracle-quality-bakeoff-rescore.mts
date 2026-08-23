/**
 * Re-score docs/oracle-quality-bakeoff.md after scorer fixes (no API calls).
 *
 *   npx tsx scripts/oracle-quality-bakeoff-rescore.mts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  rankBrands,
  scoreBrand,
  type BakeoffRunRow,
} from '../lib/oracle/ai/quality-bakeoff-score'

const MD_PATH = join(process.cwd(), 'docs', 'oracle-quality-bakeoff.md')

function parseMarkdown(): { rows: BakeoffRunRow[]; payload: Record<string, unknown>; meta: string[] } {
  const md = readFileSync(MD_PATH, 'utf8')
  const meta = md.split('\n').slice(0, 13)
  const jsonStart = md.indexOf('```json\n', md.indexOf('## Frozen ai_payload'))
  const jsonEnd = md.indexOf('\n```', jsonStart + 8)
  const payload = JSON.parse(md.slice(jsonStart + 8, jsonEnd)) as Record<string, unknown>

  const tableStart = md.indexOf('| Moonshot AI |')
  const tableEnd = md.indexOf('\n\n## Mechanical scores')
  const tableLines = md.slice(tableStart, tableEnd).trim().split('\n')

  const rows: BakeoffRunRow[] = []
  for (const line of tableLines) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').slice(1, -1).map((c) => c.trim())
    if (cells.length < 10) continue
    const [brand, runStr, narrative, one_line, direction, focus, axisRaw, contentRaw, msRaw, costRaw] = cells
    if (brand === 'brand') continue
    rows.push({
      brand,
      run: Number.parseInt(runStr, 10),
      narrative,
      one_line,
      direction: direction === '—' ? null : direction,
      focus: focus === '—' ? null : focus,
      axis_emphasis: axisRaw ? axisRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
      contentTokens: contentRaw === '—' ? null : Number.parseInt(contentRaw, 10),
      ms: Number.parseInt(msRaw, 10),
      costUsd: costRaw === '—' ? null : Number.parseFloat(costRaw),
      parsed: direction !== '—' && narrative.length > 0 && !narrative.startsWith('(error:'),
    })
  }

  return { rows, payload, meta }
}

function fmtUsd(value: number): string {
  return value.toFixed(6)
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function main() {
  const { rows, payload, meta } = parseMarkdown()
  const brands = [...new Set(rows.map((r) => r.brand))]
  const scores = brands.map((brand) => scoreBrand(brand, rows, payload))
  const ranked = rankBrands(scores)

  const lines: string[] = [
    '# Oracle layer-1 quality bakeoff (saju)',
    '',
    ...meta.slice(2),
    '',
    '## Raw outputs',
    '',
    '| brand | run | narrative | one_line | direction | focus | axis_emphasis | content tokens | ms | cost_usd |',
    '| --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: |',
  ]

  for (const row of rows) {
    lines.push(
      `| ${row.brand} | ${row.run} | ${escapeCell(row.narrative)} | ${escapeCell(row.one_line)} | ${row.direction ?? '—'} | ${row.focus ?? '—'} | ${escapeCell(row.axis_emphasis.join(', '))} | ${row.contentTokens ?? '—'} | ${row.ms} | ${row.costUsd == null ? '—' : fmtUsd(row.costUsd)} |`,
    )
  }

  lines.push('', '## Mechanical scores (per brand)', '')
  for (const score of scores) {
    lines.push(`### ${score.brand}`, '')
    lines.push(
      `- **Payload grounding:** ${score.groundingCount} distinct matches — ${score.groundingMatches.join(', ') || '(none)'}`,
    )
    lines.push(`- **Fabrication:** ${score.fabrications.length ? score.fabrications.join('; ') : '(none)'}`)
    lines.push(`- **Genericness:** ${(score.genericShare * 100).toFixed(0)}% of sentences have no payload reference`)
    lines.push(
      `- **Locale compliance:** narrative Korean=${score.localeOk ? 'yes' : 'no'}; one_line ≤80 chars=${score.oneLineBudgetOk ? 'yes' : 'no'}`,
    )
    lines.push(
      `- **Run-to-run consistency:** direction=${score.directionConsistent ? 'match' : 'differ'}; focus=${score.focusConsistent ? 'match' : 'differ'}`,
    )
    lines.push(
      `- **Length:** run1=${score.lengthChars[0]} chars, run2=${score.lengthChars[1]} chars (target 300–500)`,
    )
    lines.push(`- **Total cost (2 runs):** $${score.costUsdTotal.toFixed(6)}`)
    lines.push('')
  }

  lines.push('## Ranking (fabrication ↑, grounding ↓)', '')
  lines.push(
    '| rank | brand | fabrication count | grounding count | generic % | locale ok | dir/focus match | length (r1/r2) | cost_usd (2 runs) |',
  )
  lines.push('| ---: | --- | ---: | ---: | ---: | --- | --- | --- | ---: |')

  ranked.forEach((score, index) => {
    lines.push(
      `| ${index + 1} | ${score.brand} | ${score.fabrications.length} | ${score.groundingCount} | ${(score.genericShare * 100).toFixed(0)} | ${score.localeOk ? 'yes' : 'no'} | ${score.directionConsistent ? 'yes' : 'no'}/${score.focusConsistent ? 'yes' : 'no'} | ${score.lengthChars[0]}/${score.lengthChars[1]} | ${score.costUsdTotal.toFixed(6)} |`,
    )
  })

  lines.push('', '## Frozen ai_payload (authoritative input)', '', '```json', JSON.stringify(payload, null, 2), '```', '')

  writeFileSync(MD_PATH, lines.join('\n'), 'utf8')
  console.log('Re-scored', MD_PATH)
  for (const [index, score] of ranked.entries()) {
    console.log(
      `  ${index + 1}. ${score.brand} fab=${score.fabrications.length} ground=${score.groundingCount} usd=${score.costUsdTotal.toFixed(6)}`,
    )
  }
}

main()
