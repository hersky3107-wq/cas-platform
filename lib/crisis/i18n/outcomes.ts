import type { CrisisLocale } from './locales'

/** Card chip for an older audit, paper, complaint, or court record. */
export function buriedWarningLine(year: number, document: string): string {
  return `묻힌 경고 · ${year}년 ${document}`
}

export function buriedWarningCaption(year: number, document: string, date: string): string {
  const line = buriedWarningLine(year, document)
  return date ? `${line} · ${date}` : line
}

export type OutcomeUi = {
  scoreboardTitle: string
  scoreboardTotal: string
  scoreboardHits: string
  scoreboardMisses: string
  scoreboardPending: string
  scoreboardUnclear: string
  scoreboardEmpty: string
  predictionsTitle: string
  predictionWindow: (start: string, end: string) => string
  predictionProbability: (pct: number) => string
  expectedWindow: (min: number, max: number) => string
  hitLine: (predicted: string, hit: string) => string
  stamp: (iso: string, withTime: boolean) => string
  buriedWarning: (year: number, document: string) => string
}

function seoulParts(iso: string): { month: number; day: number; hour: number; minute: number } | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const bag = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]))
  let hour = Number(bag.hour)
  if (hour === 24) hour = 0
  return { month: Number(bag.month), day: Number(bag.day), hour, minute: Number(bag.minute) }
}

function koStamp(iso: string, withTime: boolean): string {
  const parts = seoulParts(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (!parts) return iso
  if (!withTime || iso.length === 10) return `${parts.month}월 ${parts.day}일`
  const hh = String(parts.hour).padStart(2, '0')
  const mm = String(parts.minute).padStart(2, '0')
  return `${parts.month}월 ${parts.day}일 ${hh}:${mm}`
}

function enStamp(iso: string, withTime: boolean): string {
  const parts = seoulParts(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  if (!parts) return iso
  if (!withTime || iso.length === 10) return `${parts.month}/${parts.day}`
  const hh = String(parts.hour).padStart(2, '0')
  const mm = String(parts.minute).padStart(2, '0')
  return `${parts.month}/${parts.day} ${hh}:${mm}`
}

const ko: OutcomeUi = {
  scoreboardTitle: '예측 성적',
  scoreboardTotal: '전체',
  scoreboardHits: '적중',
  scoreboardMisses: '빗나감',
  scoreboardPending: '대기',
  scoreboardUnclear: '불명확',
  scoreboardEmpty: '아직 기록된 예측이 없습니다.',
  predictionsTitle: '예측',
  predictionWindow: (start, end) => `${start} → ${end}`,
  predictionProbability: (pct) => `확률 ${pct}%`,
  expectedWindow: (min, max) => (min === max ? `예상 시기: ${min}일 뒤` : `예상 시기: ${min}~${max}일 뒤`),
  hitLine: (predicted, hit) => `${predicted} 예측 → ${hit} 적중`,
  stamp: koStamp,
  buriedWarning: buriedWarningLine,
}

const en: OutcomeUi = {
  scoreboardTitle: 'Prediction record',
  scoreboardTotal: 'Total',
  scoreboardHits: 'Hits',
  scoreboardMisses: 'Misses',
  scoreboardPending: 'Pending',
  scoreboardUnclear: 'Unclear',
  scoreboardEmpty: 'No predictions recorded yet.',
  predictionsTitle: 'Predictions',
  predictionWindow: (start, end) => `${start} → ${end}`,
  predictionProbability: (pct) => `${pct}% chance`,
  expectedWindow: (min, max) => (min === max ? `Expected: ${min} day(s) out` : `Expected: ${min}–${max} days out`),
  hitLine: (predicted, hit) => `${predicted} predicted → ${hit} hit`,
  stamp: enStamp,
  buriedWarning: buriedWarningLine,
}

const packs: Record<CrisisLocale, OutcomeUi> = {
  ko,
  en,
  ja: en,
  'zh-TW': en,
  fr: en,
  ar: en,
  es: en,
  pt: en,
}

export function getOutcomeUi(locale: CrisisLocale): OutcomeUi {
  return packs[locale] ?? en
}
