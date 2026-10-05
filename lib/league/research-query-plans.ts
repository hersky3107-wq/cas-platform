/**
 * Category query plans for the PACKET-stage multi-source research step.
 * Tech (TECH:OPEN / catalog) and ai_models only. Pure — no I/O.
 */

import { AI_VENDOR_BRANDS, brandFromModelName, brandFromOrganization } from '@/lib/league/ai-ranking/brands'
import { decodeAirankInstrument, yyyymmddToYmd, type AirankParts } from '@/lib/league/ai-ranking/instrument'
import { companyById, decodeTechInstrument, objectById } from '@/lib/league/gateway/adapters/tech-catalog'
import { decodeOpenTechInstrument } from '@/lib/league/gateway/adapters/tech-resolve'

export const TECH_SCHEDULED_EVENTS = [
  'CES',
  'WWDC',
  'Google I/O',
  'Galaxy Unpacked',
  'Computex',
  'keynote',
  'launch event',
  'earnings call',
  'trade show',
] as const

export const TECH_CERTIFICATION_SIGNALS = [
  'FCC ID',
  'RRA 적합성 인증',
  'TENAA',
  '3C',
  'EU energy label',
  'Bluetooth SIG',
] as const

export type TechQueryPlanInput = {
  subject: string
  object: string
  deadline: string
  event?: string
  verification?: string
}

export type AirankQueryPlanInput = {
  brands: readonly string[]
  deadline: string
  asOf?: string
}

export type SampleQueryPlan = {
  category: 'tech' | 'ai_models'
  subject?: string
  object?: string
  brands?: string[]
  queries: string[]
}

export type QueryPlanRound = {
  instrument: string
  category?: string
  proposition_text?: string
  resolves_at?: string
}

export function asQueryRecords(queries: readonly string[]): { q: string; lang: string }[] {
  return uniqueQueries(queries).map((q) => ({ q, lang: 'en' }))
}

export function techQueryPlan(input: TechQueryPlanInput): string[] {
  const subject = cleanPhrase(input.subject)
  const object = cleanPhrase(input.object)
  const deadline = input.deadline.trim()
  const event = cleanPhrase(input.event ?? '')
  const eventBit = event ? `${event} ` : ''
  const events = TECH_SCHEDULED_EVENTS.map((e) => `"${e}"`).join(' ')
  const certs = TECH_CERTIFICATION_SIGNALS.map((c) => `"${c}"`).join(' OR ')

  return uniqueQueries([
    `${subject} ${object} ${eventBit}scheduled events before ${deadline} ${events}`,
    `${subject} ${object} certification OR filing before ${deadline} ${certs}`,
    `${subject} ${object} 8-K OR DART OR SEC OR 공시 filing`,
    `${subject} ${object} launch months last 5 years historical cadence product line`,
    `${subject} official statement OR guidance OR delay OR "supply chain" ${object} before ${deadline}`,
    `${subject} ${object} rumor OR report before ${deadline} reputable reporter (label RUMOR)`,
  ])
}

export function aiModelsQueryPlan(input: AirankQueryPlanInput): string[] {
  const brands = input.brands.map(cleanPhrase).filter(Boolean)
  const brandBit = brands.length ? brands.join(' OR ') : 'AI lab'
  const deadline = input.deadline.trim()
  return uniqueQueries([
    `${brandBit} new model release OR announcement last 30 days`,
    `${brandBit} model expected before ${deadline} release OR announcement`,
    `${brandBit} new entry OpenRouter models list`,
    `${brandBit} new Hugging Face repository OR model card from the lab`,
    `${brandBit} anonymous OR unlisted model on LMArena (unconfirmed)`,
  ])
}

export function airankSubjectBrands(parts: AirankParts): string[] {
  if (parts.kind === 'brand_table') {
    return ['OpenAI', 'Google', 'Anthropic', 'xAI', 'Meta', 'DeepSeek']
  }
  if (parts.kind === 'brand_above' && parts.param) {
    return uniqueQueries([parts.subject, parts.param])
  }
  if (parts.kind === 'camp_rank1' || parts.kind === 'camp_topn') {
    return uniqueQueries([parts.subject, ...(parts.param ? [parts.param] : [])])
  }
  const fromOrg = brandFromOrganization(parts.subject)
  return [fromOrg ?? parts.subject]
}

export function techQueryPlanFromRound(round: QueryPlanRound): string[] {
  const deadline = deadlineFromRound(round)
  const open = decodeOpenTechInstrument(round.instrument)
  if (open) {
    return techQueryPlan({
      subject: unslug(open.subjectSlug),
      object: unslug(open.objectSlug),
      event: open.event,
      deadline,
      verification: open.verification,
    })
  }
  const catalog = decodeTechInstrument(round.instrument)
  if (catalog) {
    const company = companyById(catalog.companyId)
    const object = objectById(catalog.objectId)
    return techQueryPlan({
      subject: company?.label_en ?? catalog.companyId,
      object: object?.label_en ?? catalog.objectId,
      event: catalog.claimKind,
      deadline,
    })
  }
  const inferred = inferTechFromPrompt(round.proposition_text ?? '')
  return techQueryPlan({
    subject: inferred.subject,
    object: inferred.object,
    deadline,
  })
}

export function airankQueryPlanFromRound(round: QueryPlanRound): { q: string; lang: string }[] {
  const parts = decodeAirankInstrument(round.instrument)
  const deadline = parts ? parts.deadlineYmd : deadlineFromRound(round)
  const brands = parts ? airankSubjectBrands(parts) : inferAiBrands(round.proposition_text ?? '')
  return asQueryRecords(aiModelsQueryPlan({ brands, deadline }))
}

/**
 * Sample-prompt helper for tests and operator probes.
 * Apple foldable / Samsung tri-fold / Nvidia GPU → tech.
 * GPT-6 release → ai_models.
 */
export function queryPlanFromSamplePrompt(prompt: string, deadline = '2026-12-31'): SampleQueryPlan {
  const trimmed = prompt.trim()
  if (isAiReleasePrompt(trimmed)) {
    const brands = inferAiBrands(trimmed)
    return {
      category: 'ai_models',
      brands,
      queries: aiModelsQueryPlan({ brands, deadline }),
    }
  }
  const { subject, object } = inferTechFromPrompt(trimmed)
  return {
    category: 'tech',
    subject,
    object,
    queries: techQueryPlan({ subject, object, deadline }),
  }
}

export function deadlineFromRound(round: QueryPlanRound): string {
  const instrument = round.instrument ?? ''
  const open = decodeOpenTechInstrument(instrument)
  if (open?.deadline) return open.deadline
  const ymd = instrument.match(/:(\d{8})$/)
  if (ymd) {
    const iso = yyyymmddToYmd(ymd[1])
    if (iso) return iso
  }
  const resolves = round.resolves_at?.slice(0, 10)
  if (resolves && /^\d{4}-\d{2}-\d{2}$/.test(resolves)) return resolves
  return new Date().toISOString().slice(0, 10)
}

function inferTechFromPrompt(prompt: string): { subject: string; object: string } {
  const text = prompt.trim()
  const known: Array<{ re: RegExp; subject: string; object: string }> = [
    { re: /apple/i, subject: 'Apple', object: /fold/i.test(text) ? 'foldable' : restAfter(text, /apple/i) },
    { re: /samsung|삼성/i, subject: 'Samsung', object: /tri[-\s]?fold|3단/i.test(text) ? 'tri-fold' : restAfter(text, /samsung|삼성/i) },
    { re: /nvidia|엔비디아/i, subject: 'Nvidia', object: /gpu|그래픽/i.test(text) ? 'GPU' : restAfter(text, /nvidia|엔비디아/i) },
  ]
  for (const row of known) {
    if (row.re.test(text)) {
      return { subject: row.subject, object: row.object || 'product' }
    }
  }
  const words = text.split(/\s+/).filter(Boolean)
  return {
    subject: words[0] || 'the company',
    object: words.slice(1).join(' ') || 'the product',
  }
}

function inferAiBrands(prompt: string): string[] {
  const hits = AI_VENDOR_BRANDS.filter((b) => prompt.toLowerCase().includes(b.toLowerCase()))
  if (hits.length) return hits
  const fromOrg = brandFromOrganization(prompt)
  if (fromOrg) return [fromOrg]
  const fromModel = brandFromModelName(prompt)
  if (fromModel) return [fromModel]
  if (/gpt|chatgpt|o3|o4/i.test(prompt)) return ['OpenAI']
  return ['OpenAI']
}

function isAiReleasePrompt(prompt: string): boolean {
  return /gpt|chatgpt|claude|gemini|llama|grok|opus|sonnet|model release|huggingface|openrouter|lmarena/i.test(
    prompt,
  )
}

function restAfter(text: string, re: RegExp): string {
  const m = text.match(re)
  if (!m || m.index == null) return ''
  return text.slice(m.index + m[0].length).replace(/^[\s:,-]+/, '').trim()
}

function unslug(value: string): string {
  return value.replace(/_/g, ' ').trim()
}

function cleanPhrase(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function uniqueQueries(queries: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of queries) {
    const q = cleanPhrase(raw)
    if (!q) continue
    const key = q.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(q)
  }
  return out
}
