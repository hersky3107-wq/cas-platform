/**
 * Explicit event-window line for TECH:OPEN and other dated freeform rounds.
 * Models otherwise treat a pre-window launch as a YES.
 */

const OPEN_YMD = /^\d{4}-\d{2}-\d{2}$/

export function ymdFromIso(raw: string | null | undefined): string | null {
  if (!raw) return null
  const ymd = raw.trim().slice(0, 10)
  return OPEN_YMD.test(ymd) ? ymd : null
}

export function hasDatedEventWindow(args: {
  instrument?: string | null
  category?: string | null
}): boolean {
  const instrument = args.instrument ?? ''
  if (instrument.startsWith('TECH:OPEN')) return true
  return args.category === 'tech' || args.category === 'ai_models'
}

const MONTH_MAP: Record<string, string> = {
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
}

function ymdFromLooseDate(raw: string): string | null {
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/)
  if (iso?.[1]) return iso[1]
  const monthYear = raw.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/i)
  if (monthYear) {
    const month = MONTH_MAP[monthYear[1]!.toLowerCase()]
    if (month) return `${monthYear[2]}-${month}-01`
  }
  return null
}

/** First packet event dated before the open date, for the "e.g. …" example. */
export function earlierEventExampleFromPacket(packet: string | null | undefined, openYmd: string): string | null {
  if (!packet) return null
  const lines = packet.split(/\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || /none measured/i.test(trimmed)) continue
    const date = ymdFromLooseDate(trimmed)
    if (!date || date >= openYmd) continue
    const clipped = trimmed.replace(/^[-*•]\s*/, '').slice(0, 80)
    return clipped
  }
  return null
}

export function eventWindowConstraintLine(openYmd: string, earlierExample?: string | null): string {
  const example = earlierExample?.trim()
    ? ` (e.g. ${earlierExample.trim()})`
    : ' (e.g. earlier launches)'
  return `Only events dated on or after ${openYmd} count. Events before ${openYmd}${example} do NOT satisfy this question.`
}

export function eventWindowConstraintLines(args: {
  instrument?: string | null
  category?: string | null
  openedAt?: string | null
  packet?: string | null
  windowStart?: string | null
}): string[] {
  if (!hasDatedEventWindow(args)) return []
  const openYmd = ymdFromIso(args.windowStart) ?? ymdFromIso(args.openedAt)
  if (!openYmd) return []
  const example = earlierEventExampleFromPacket(args.packet ?? null, openYmd)
  return [eventWindowConstraintLine(openYmd, example)]
}

export function withEventWindowConstraint(prompt: string, args: Parameters<typeof eventWindowConstraintLines>[0]): string {
  const lines = eventWindowConstraintLines(args)
  if (lines.length === 0) return prompt
  return `${prompt}\n\n${lines.join('\n')}`
}
