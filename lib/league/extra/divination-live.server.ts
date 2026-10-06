/**
 * Live deps for the divination seat chart.
 *
 * `readLeagueDivinationWithChart` is the oracle adapter with the oracle's own
 * Supabase reading cache and a league reader call that appends the chart
 * lines to the user prompt. Same platform model and request params as the
 * oracle reader. No oracle file changes.
 *
 * `league_divination_subject_cache` holds Wikidata birth/founding months per
 * subject (not readings). Missing table → memory cache only.
 */
import 'server-only'

import { readLeagueDivination } from '@/lib/oracle/league-divination/adapter'
import type {
  LeagueDivinationAdapterInput,
  LeagueDivinationAdapterOutput,
} from '@/lib/oracle/league-divination/adapter-types'
import { createSupabaseLeagueDivinationCache } from '@/lib/oracle/league-divination/cache'
import {
  LEAGUE_READER_EXTRA_REQUEST_PARAMS,
  LEAGUE_READER_PLATFORM_ID,
} from '@/lib/oracle/league-divination/conventions'
import type { LeagueReaderCall } from '@/lib/oracle/league-divination/reader'
import { supabaseAdmin } from '@/lib/supabase/server'
import { chartAwareReaderCall, type DivinationChartDeps } from './divination-chart'
import { parseSubjectBirth, resolveSubjectBirth, type SubjectCacheStore } from './divination-wikidata'

const SUBJECT_TABLE = 'league_divination_subject_cache'

const platformReaderCall: LeagueReaderCall = async (input) => {
  const { callPlatformModel } = await import('@/lib/ai/platform-providers')
  const res = await callPlatformModel({
    id: LEAGUE_READER_PLATFORM_ID,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    maxCompletionTokens: input.maxCompletionTokens,
    extraRequestParams: { ...LEAGUE_READER_EXTRA_REQUEST_PARAMS },
    debugRequestLabel: 'league-divination-reader',
    timeoutMs: input.timeoutMs,
  })
  return {
    text: res.text ?? null,
    error: res.error,
    costUsd: typeof res.costUsd === 'number' ? res.costUsd : null,
    costIsEstimated: res.costIsEstimated ?? false,
  }
}

export async function readLeagueDivinationWithChart(
  input: LeagueDivinationAdapterInput,
  promptLines: readonly string[],
): Promise<LeagueDivinationAdapterOutput> {
  return readLeagueDivination(input, {
    cache: createSupabaseLeagueDivinationCache(supabaseAdmin),
    reader: chartAwareReaderCall(promptLines, platformReaderCall),
  })
}

let warnedSubjectTable = false

function warnSubjectTable(message: string): void {
  if (warnedSubjectTable) return
  warnedSubjectTable = true
  console.warn(`[league-divination] subject cache unavailable (${message}); using memory only`)
}

export const supabaseSubjectCacheStore: SubjectCacheStore = {
  async get(key) {
    const { data, error } = await supabaseAdmin
      .from(SUBJECT_TABLE)
      .select('result, fetched_at')
      .eq('subject_key', key)
      .maybeSingle()
    if (error) {
      warnSubjectTable(error.message)
      return null
    }
    if (!data || typeof data.fetched_at !== 'string') return null
    return { value: parseSubjectBirth(data.result), fetchedAt: data.fetched_at }
  },
  async put(key, label, value) {
    const { error } = await supabaseAdmin.from(SUBJECT_TABLE).upsert(
      { subject_key: key, subject_label: label.slice(0, 200), result: value, fetched_at: new Date().toISOString() },
      { onConflict: 'subject_key' },
    )
    if (error) warnSubjectTable(error.message)
  },
}

export const liveDivinationChartDeps: DivinationChartDeps = {
  resolveSubject: (name, category) => resolveSubjectBirth(name, category, { store: supabaseSubjectCacheStore }),
}
