import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import {
  envKrManualCloseFlag,
  parseKrManualCloseFlag,
  serializeKrManualCloseFlag,
  type KrManualCloseFlag,
} from './kr-manual-close'
import type { KrElectionAlertStore, KrElectionMilestone } from './kr-election-alerts'

const CLOSE_TABLE = 'league_kr_election_manual_close'
const SENT_TABLE = 'league_kr_election_alert_sent'

export async function loadKrManualCloseFlag(env: NodeJS.ProcessEnv = process.env): Promise<KrManualCloseFlag> {
  try {
    const { data, error } = await supabaseAdmin.from(CLOSE_TABLE).select('value').eq('id', 'default').maybeSingle()
    if (!error && typeof data?.value === 'string' && data.value.trim()) {
      return parseKrManualCloseFlag(data.value)
    }
  } catch {
    /* table may not exist until the SQL editor migration is applied */
  }
  return envKrManualCloseFlag(env)
}

export async function saveKrManualCloseFlag(flag: KrManualCloseFlag, updatedBy?: string | null): Promise<void> {
  const { error } = await supabaseAdmin.from(CLOSE_TABLE).upsert(
    {
      id: 'default',
      value: serializeKrManualCloseFlag(flag),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`league_kr_election_manual_close upsert: ${error.message}`)
}

export function supabaseKrElectionAlertStore(): KrElectionAlertStore {
  return {
    async hasSent(electionId, milestone) {
      try {
        const { data, error } = await supabaseAdmin
          .from(SENT_TABLE)
          .select('election_id')
          .eq('election_id', electionId)
          .eq('milestone', milestone)
          .maybeSingle()
        if (error) return false
        return Boolean(data)
      } catch {
        return false
      }
    },
    async markSent(electionId, milestone: KrElectionMilestone) {
      try {
        await supabaseAdmin.from(SENT_TABLE).upsert(
          { election_id: electionId, milestone, sent_at: new Date().toISOString() },
          { onConflict: 'election_id,milestone' },
        )
      } catch {
        /* next dispatch retries */
      }
    },
  }
}
