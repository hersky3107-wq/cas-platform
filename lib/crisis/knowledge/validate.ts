import { CASCADE_SEEDS, type CascadeSeed } from './cascades.seed'

const FAKE_URL = /example\.(com|org|net)|localhost|placeholder|127\.0\.0\.1|changeme|todo\.example/i

export function validateCascades(rows: CascadeSeed[]): string[] {
  const errors: string[] = []
  const seen = new Set<string>()
  if (rows.length < 25 || rows.length > 35) {
    errors.push(`expected 25-35 cascades, got ${rows.length}`)
  }
  for (const row of rows) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(row.id)) errors.push(`${row.id}: id is not a slug`)
    if (seen.has(row.id)) errors.push(`${row.id}: duplicate id`)
    seen.add(row.id)
    if (!row.trigger_type || !row.effect_type) errors.push(`${row.id}: missing trigger or effect`)
    if (!Number.isInteger(row.lag_min_days) || !Number.isInteger(row.lag_max_days)) {
      errors.push(`${row.id}: lags must be integers`)
    }
    if (row.lag_min_days < 0 || row.lag_max_days < row.lag_min_days) {
      errors.push(`${row.id}: lag window invalid`)
    }
    if (row.evidence_level !== 'sourced' && row.evidence_level !== 'hypothesis') {
      errors.push(`${row.id}: bad evidence_level`)
    }
    if (!row.mechanism || row.mechanism.length < 80) errors.push(`${row.id}: mechanism too short`)
    if (row.conditions == null || typeof row.conditions !== 'object' || Array.isArray(row.conditions)) {
      errors.push(`${row.id}: conditions must be an object`)
    }
    if (row.evidence_level === 'hypothesis') {
      if (row.sources.length !== 0) errors.push(`${row.id}: hypothesis must have sources []`)
      continue
    }
    if (row.sources.length < 1) errors.push(`${row.id}: sourced cascade needs a source`)
    for (const source of row.sources) {
      if (!source.title || !source.publisher || !Number.isInteger(source.year)) {
        errors.push(`${row.id}: source missing title, publisher, or year`)
      }
      if (!source.url.startsWith('https://')) errors.push(`${row.id}: source url must be https`)
      if (FAKE_URL.test(source.url)) errors.push(`${row.id}: source url looks fake`)
    }
  }
  return errors
}

export function assertCascades(rows: CascadeSeed[] = CASCADE_SEEDS): void {
  const errors = validateCascades(rows)
  if (errors.length) throw new Error(errors.join('\n'))
}
