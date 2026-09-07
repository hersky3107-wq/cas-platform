/**
 * TECH proposition template — server-authored, catalog ids only.
 *
 * EN: Will {company} publish a {artifact} for {object} on its {venue} by {date}?
 * KO: {company}가 {date}까지 {venue}에 {object}에 대한 {artifact}를 공개할까?
 *
 * A person can verify the stored claim from one official link. Vague
 * phrasings ("Apple announces a foldable") cannot be produced: object,
 * artifact, venue, and date are required catalog/date slots.
 */

import type { UiHorizon } from '../../horizon'
import {
  ARTIFACT_LABEL,
  VENUE_LABEL,
  companyById,
  objectById,
  type TechArtifactId,
  type TechCompany,
  type TechObject,
  type TechVenueId,
} from './tech-catalog'

export type TechComposeFields = {
  company: TechCompany
  object: TechObject
  artifact: TechArtifactId
  venue: TechVenueId
  date: string
}

export const TECH_PROPOSITION_TEMPLATE_EN =
  'Will {company} publish a {artifact} for {object} on its {venue} by {date}?'
export const TECH_PROPOSITION_TEMPLATE_KO =
  '{company}, {date}까지 {venue}에 {object}에 대한 {artifact}를 공개할까?'

export function formatTechProposition(fields: TechComposeFields, locale: 'en' | 'ko'): string {
  const artifact = ARTIFACT_LABEL[fields.artifact][locale]
  const venue = VENUE_LABEL[fields.venue][locale]
  if (locale === 'ko') {
    return `${fields.company.label_ko}, ${fields.date}까지 ${venue}에 ${fields.object.label_ko}에 대한 ${artifact}를 공개할까?`
  }
  return `Will ${fields.company.label_en} publish a ${artifact} for ${fields.object.label_en} on its ${venue} by ${fields.date}?`
}

export function techResolutionRule(fields: TechComposeFields): string {
  const artifact = ARTIFACT_LABEL[fields.artifact].en
  const venue = VENUE_LABEL[fields.venue].en
  return (
    `Published ${artifact} for ${fields.object.label_en} on ${fields.company.label_en}'s ${venue} ` +
    `on or before ${fields.date}. Graded from one official URL — never from a share price or earnings print.`
  )
}

export function fieldsFromCatalog(input: {
  companyId: string
  objectId: string
  artifact: string
  venue: string
  date: string
}): TechComposeFields | null {
  const company = companyById(input.companyId)
  const object = objectById(input.objectId)
  if (!company || !object) return null
  if (object.companyId !== company.id) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return null
  return {
    company,
    object,
    artifact: input.artifact as TechArtifactId,
    venue: input.venue as TechVenueId,
    date: input.date,
  }
}

/** Map a calendar deadline onto the ledger's 4-value horizon CHECK. */
export function horizonForResolveDate(dateYmd: string, now: Date): UiHorizon {
  const target = Date.parse(`${dateYmd}T23:59:59.999Z`)
  if (!Number.isFinite(target)) return '1m'
  const days = Math.ceil((target - now.getTime()) / 86_400_000)
  if (days <= 2) return '1d'
  if (days <= 10) return '1w'
  if (days <= 45) return '1m'
  return '3m'
}
