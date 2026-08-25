/**
 * One-shot verify for a real-DB smoke session id.
 *   npx tsx --env-file=.env.local scripts/oracle-real-db-smoke-verify.mts <sessionId>
 */
const sessionId = process.argv[2]
if (!sessionId) throw new Error('usage: ... <sessionId>')

const { supabaseAdmin } = await import('../lib/supabase/server')

const sessions = await supabaseAdmin
  .from('oracle_job_sessions')
  .select('id,status,scope,systems,reader_roster')
  .eq('id', sessionId)
const readings = await supabaseAdmin
  .from('oracle_readings')
  .select('system,brand,status,model')
  .eq('session_id', sessionId)
const consensus = await supabaseAdmin
  .from('oracle_consensus')
  .select('session_id,domain_stats')
  .eq('session_id', sessionId)
const costs = await supabaseAdmin
  .from('model_cost_logs')
  .select('ai_name,cost_usd,input_tokens,output_tokens')
  .eq('oracle_session_id', sessionId)

const domain = consensus.data?.[0]?.domain_stats as { synthesis?: unknown } | null
const total = (costs.data ?? []).reduce(
  (sum, row) => sum + (Number(row.cost_usd) || 0),
  0,
)

console.log(
  JSON.stringify(
    {
      sessionRows: sessions.data?.length ?? 0,
      session: sessions.data?.[0] ?? null,
      readingRows: readings.data?.length ?? 0,
      readings: readings.data,
      distinctBrands: [...new Set((readings.data ?? []).map((r) => r.brand))],
      consensusRows: consensus.data?.length ?? 0,
      synthesisPresent: domain?.synthesis != null,
      costRows: costs.data?.length ?? 0,
      costs: costs.data,
      totalCostUsd: total,
      errors: {
        sessions: sessions.error?.message ?? null,
        readings: readings.error?.message ?? null,
        consensus: consensus.error?.message ?? null,
        costs: costs.error?.message ?? null,
      },
    },
    null,
    2,
  ),
)
