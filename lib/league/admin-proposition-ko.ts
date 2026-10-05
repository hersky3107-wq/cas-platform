import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { sourceHash, translateRoundRationales } from '@/lib/league/rationale-i18n'
import type { RationaleTranslationStore } from '@/lib/league/rationale-i18n-store'

type PropMap = Record<string, string>

function asProps(raw: unknown): PropMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: PropMap = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

export type AdminKoreanCopy = {
  propositionKo: string
  propositionEn: string
  resolutionRuleKo: string
}

/**
 * Admin display copy. Uses propositions.ko when generation already stored it.
 * Otherwise one rationale-translation pass (same model, hash cache on the
 * round's propositions jsonb — not the prediction FK table).
 */
export async function koreanAdminCopyForRounds(
  rows: readonly {
    id: string
    proposition_text: string
    resolution_rule: string
    propositions?: unknown
  }[],
): Promise<Map<string, AdminKoreanCopy>> {
  const propsById = new Map<string, PropMap>()
  for (const row of rows) propsById.set(row.id, asProps(row.propositions))

  const store: RationaleTranslationStore = {
    async loadCached(_locale, ids) {
      const cached = []
      for (const id of ids) {
        const roundId = id.endsWith(':rule') ? id.slice(0, -5) : id
        const props = propsById.get(roundId) ?? {}
        const text = id.endsWith(':rule') ? props.resolution_rule_ko : props.ko
        const hash = id.endsWith(':rule') ? props.resolution_rule_ko_hash : props.ko_hash
        if (text && hash) cached.push({ prediction_id: id, translated_text: text, source_hash: hash })
      }
      return { rows: cached, error: null }
    },
    async upsert(writes) {
      for (const write of writes) {
        const rule = write.prediction_id.endsWith(':rule')
        const roundId = rule ? write.prediction_id.slice(0, -5) : write.prediction_id
        const props = { ...(propsById.get(roundId) ?? {}) }
        if (rule) {
          props.resolution_rule_ko = write.translated_text
          props.resolution_rule_ko_hash = write.source_hash
        } else if (!props.ko) {
          props.ko = write.translated_text
          props.ko_hash = write.source_hash
        }
        propsById.set(roundId, props)
        const { error } = await supabaseAdmin.from('prediction_rounds').update({ propositions: props }).eq('id', roundId)
        if (error) return { error: { message: error.message } }
      }
      return { error: null }
    },
  }

  const propItems = rows
    .filter((row) => !asProps(row.propositions).ko)
    .map((row) => ({ predictionId: row.id, text: row.proposition_text }))
  const ruleItems = rows
    .filter((row) => row.resolution_rule.trim() && !asProps(row.propositions).resolution_rule_ko)
    .map((row) => ({ predictionId: `${row.id}:rule`, text: row.resolution_rule }))

  if (propItems.length || ruleItems.length) {
    await translateRoundRationales([...propItems, ...ruleItems], 'ko', store).catch(() => undefined)
  }

  const out = new Map<string, AdminKoreanCopy>()
  for (const row of rows) {
    const props = propsById.get(row.id) ?? asProps(row.propositions)
    const en = row.proposition_text.trim()
    const ko = props.ko?.trim() || en
    const ruleEn = row.resolution_rule.trim()
    const ruleKo = props.resolution_rule_ko?.trim() || ruleEn
    if (props.ko && !props.ko_hash) {
      props.ko_hash = sourceHash(en)
    }
    out.set(row.id, { propositionKo: ko, propositionEn: en, resolutionRuleKo: ruleKo })
  }
  return out
}
