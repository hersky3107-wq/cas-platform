import { writeFileSync } from 'node:fs'
import { supabaseAdmin } from '../lib/supabase/server'

async function main() {
  const id = 'f3752ddd-a0ca-44ab-9a38-3ae0d590d512'
  const { data, error } = await supabaseAdmin
    .from('prediction_rounds')
    .select(
      'proposition_text, instrument, category, horizon, resolution_rule, resolves_at, closed_book_packet_text',
    )
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(error?.message ?? 'no row')

  const injection = data.closed_book_packet_text as string
  const full = [
    `Proposition: ${data.proposition_text}`,
    `Instrument: ${data.instrument}`,
    `Category: ${data.category}`,
    `Horizon: ${data.horizon}`,
    `Resolution rule: ${data.resolution_rule}`,
    `Resolves at (UTC): ${data.resolves_at}`,
    '',
    injection,
    '',
    'You have the numeric market data and research above. Make a directional call (up/down/flat) with a probability. Do NOT answer "abstain" for lack of data — the packet above is your data. Prefer the numbered blocks over prose if they disagree.',
    'Respond with the single-line JSON object described in the system message.',
  ].join('\n')

  writeFileSync('docs/_full-closed-book-prompt.txt', full, 'utf8')
  writeFileSync('docs/_injection-only.txt', injection, 'utf8')
  console.log('full_chars', full.length)
  console.log('injection_chars', injection.length)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
