import { writeFileSync } from 'node:fs'
import { supabaseAdmin } from '../lib/supabase/server'

async function loadRound(prefixOrId: string) {
  if (prefixOrId.length >= 36) {
    const { data, error } = await supabaseAdmin
      .from('prediction_rounds')
      .select(
        'id,instrument,horizon,closed_book_packet_text,anchor_price,created_at,proposition_text',
      )
      .eq('id', prefixOrId)
      .maybeSingle()
    if (error) throw error
    return data
  }
  // uuid prefix: fetch recent AAPL 1d rounds and match in JS (~~* not valid on uuid)
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select(
      'id,instrument,horizon,closed_book_packet_text,anchor_price,created_at,proposition_text',
    )
    .eq('instrument', 'AAPL')
    .eq('horizon', '1d')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []).find((r) => String(r.id).startsWith(prefixOrId)) ?? null
}

async function main() {
  const out: unknown[] = []
  for (const key of ['f3752ddd-a0ca-44ab-9a38-3ae0d590d512', 'fffc1716']) {
    const round = await loadRound(key)
    if (!round) {
      out.push({ key, error: 'not found' })
      continue
    }
    const { data: preds, error } = await supabaseAdmin
      .from('model_predictions')
      .select(
        'model_id,predicted_direction,predicted_value,is_correct,reasoning_snippet,cost_usd',
      )
      .eq('round_id', round.id)
      .order('model_id')
    if (error) throw error
    const packet = (round.closed_book_packet_text as string | null) ?? ''
    const baseMatch = packet.match(/closed higher[^\n]*?(\d+\.\d+)% of the time/)
    const baseRate = baseMatch ? Number(baseMatch[1]) : null
    const hasBaseRate = /BASE RATE/.test(packet) && !/BASE RATE[^\n]*UNAVAILABLE/.test(packet)

    const dirs: Record<string, number> = {}
    const probs: number[] = []
    const rows = (preds ?? []).map((p) => {
      const d = p.predicted_direction ?? 'null'
      dirs[d] = (dirs[d] || 0) + 1
      if (typeof p.predicted_value === 'number') probs.push(p.predicted_value)
      return {
        model_id: p.model_id,
        direction: p.predicted_direction,
        probability: p.predicted_value,
        is_correct: p.is_correct,
        rationale: (p.reasoning_snippet as string | null)?.slice(0, 200) ?? null,
        cites_dispersion:
          typeof p.reasoning_snippet === 'string' &&
          /59\.8|dispersion|analysts disagree|range 185/i.test(p.reasoning_snippet),
      }
    })

    const within2 =
      baseRate == null
        ? null
        : rows.filter(
            (r) =>
              typeof r.probability === 'number' && Math.abs(r.probability - baseRate) <= 2,
          ).length

    const cited = rows.filter((r) => r.cites_dispersion && (r.direction === 'up' || r.direction === 'down'))
    const notCited = rows.filter(
      (r) => !r.cites_dispersion && (r.direction === 'up' || r.direction === 'down'),
    )

    out.push({
      id: round.id,
      instrument: round.instrument,
      horizon: round.horizon,
      has_packet: Boolean(packet),
      has_base_rate: hasBaseRate,
      base_rate_pct: baseRate,
      packet_chars: packet.length,
      dirs,
      n_preds: rows.length,
      prob: probs.length
        ? {
            n: probs.length,
            min: Math.min(...probs),
            max: Math.max(...probs),
            spread: Math.max(...probs) - Math.min(...probs),
            mean: Number((probs.reduce((a, b) => a + b, 0) / probs.length).toFixed(2)),
          }
        : null,
      within_2_of_base_rate: within2,
      dispersion_cite: {
        cited_n: cited.length,
        cited_up: cited.filter((r) => r.direction === 'up').length,
        cited_down: cited.filter((r) => r.direction === 'down').length,
        not_cited_n: notCited.length,
        not_cited_up: notCited.filter((r) => r.direction === 'up').length,
        not_cited_down: notCited.filter((r) => r.direction === 'down').length,
      },
      special: rows.filter((r) => /exaone|hcx/i.test(r.model_id)),
      all: rows,
    })
  }
  writeFileSync('docs/_accuracy-compare.json', JSON.stringify(out, null, 2), 'utf8')
  console.log(JSON.stringify(out.map((o: any) => ({
    id: o.id,
    has_base_rate: o.has_base_rate,
    base_rate_pct: o.base_rate_pct,
    dirs: o.dirs,
    prob: o.prob,
    within_2_of_base_rate: o.within_2_of_base_rate,
    dispersion_cite: o.dispersion_cite,
    special: o.special,
  })), null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
