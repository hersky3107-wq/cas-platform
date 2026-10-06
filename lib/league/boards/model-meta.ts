import { EXTRA_SEAT_IDS, isExtraSeatId } from '../extra/seats'
import { LEAGUE_ROSTER, lookupRosterEntry, type WeightsKind } from '../roster'
import { getAllSeats, seatForModelId } from '../seats'

/**
 * Model metadata for the boards (pure, client-safe): which company a seat
 * belongs to, which product family it is in for sibling battles, and a stable
 * non-performance order for unranked rows.
 */

/** Roster brand → company. Brands not listed are their own company. */
const COMPANY_OF_BRAND: Record<string, string> = {
  'Meta Muse': 'Meta',
  Qwen: 'Alibaba',
}

const COMPANY_LABEL: Record<string, string> = {
  Alibaba: 'Alibaba · Qwen',
}

/** Product family for sibling battles; models not listed are their own family. */
const FAMILY_OF_MODEL: Record<string, string> = {
  'gpt-6-astra': 'GPT-6 Astra',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'claude-fable-5': 'Claude Fable',
  'claude-fable-5.1': 'Claude Fable',
  'claude-sonnet-5': 'Claude Sonnet',
  'claude-haiku-4.5': 'Claude Haiku',
  'gemini-3.1-pro': 'Gemini Pro',
  'gemini-3.6-flash': 'Gemini Flash',
  'gemini-3.5-flash-lite': 'Gemini Flash-Lite',
  'gemma-4-31b-it': 'Gemma',
  'grok-4.7': 'Grok 4.7',
  'grok-4.5': 'Grok 4.5',
  'grok-4.3': 'Grok 4.3',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'deepseek-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v3.2': 'DeepSeek V3.2',
  'mistral-medium-3.5': 'Mistral Medium',
  'mistral-small-3.2-24b': 'Mistral Small',
  'muse-spark-1.2': 'Muse Spark',
  'llama-4-maverick': 'Llama 4 Maverick',
  'qwen3.8-max': 'Qwen Max',
  'qwen3.5-plus': 'Qwen Plus',
  'qwen3.5-flash': 'Qwen Flash',
  'kimi-k3': 'Kimi K3',
  'kimi-k2.6': 'Kimi K2.6',
  'glm-5.3': 'GLM 5.3',
  'glm-5.2': 'GLM 5.2',
  'solar-pro4': 'Solar Pro 4',
  'solar-pro3': 'Solar Pro 3',
}

const ROSTER_INDEX = new Map(LEAGUE_ROSTER.map((entry, index) => [entry.model_id, index]))

const TENURE_LABEL = new Map<string, string>()
for (const seat of getAllSeats()) {
  for (const tenure of seat.tenures) {
    if (!TENURE_LABEL.has(tenure.modelId)) TENURE_LABEL.set(tenure.modelId, tenure.modelLabel)
  }
}

function brandOf(modelId: string, storedBrand: string): string {
  const roster = lookupRosterEntry(modelId)
  if (roster) return roster.brand
  const seat = seatForModelId(modelId)
  if (seat && seat.tier !== 'extra') return seat.brand
  return storedBrand
}

export function companyOf(modelId: string, storedBrand = ''): string {
  const brand = brandOf(modelId, storedBrand)
  return COMPANY_OF_BRAND[brand] ?? brand
}

export function companyLabel(company: string): string {
  return COMPANY_LABEL[company] ?? company
}

export function familyOf(modelId: string): string {
  return FAMILY_OF_MODEL[modelId] ?? modelLabelOf(modelId)
}

/** "Claude Fable 5", "GPT-5.6 Terra". Extras are labelled by the UI copy. */
export function modelLabelOf(modelId: string): string {
  return TENURE_LABEL.get(modelId) ?? modelId
}

/** Retired models that are not on the roster any more have no weights row. */
export function weightsOf(modelId: string): WeightsKind | null {
  return lookupRosterEntry(modelId)?.weights ?? null
}

/** Roster order, then extras, then everything else — never performance. */
export function modelOrderOf(modelId: string): number {
  const roster = ROSTER_INDEX.get(modelId)
  if (roster !== undefined) return roster
  if (isExtraSeatId(modelId)) return LEAGUE_ROSTER.length + EXTRA_SEAT_IDS.indexOf(modelId)
  return LEAGUE_ROSTER.length + EXTRA_SEAT_IDS.length + 1
}
