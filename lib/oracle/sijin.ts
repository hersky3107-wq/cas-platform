/** Midpoint HH:mm strings for approximate birth bands */
export function approxBandToMidpointHHMM(band: string): string {
  switch (band) {
    case 'EARLY_MORNING':
      return '05:00'
    case 'MORNING':
      return '09:00'
    case 'MIDDAY':
      return '12:00'
    case 'AFTERNOON':
      return '15:00'
    case 'EVENING':
      return '19:00'
    case 'NIGHT':
      return '00:00'
    default:
      return '12:00'
  }
}

export type SijinInfo = {
  kr: string
  rangeLabel: string
  midpointHHMM: string
}

/** Map local wall-clock time on birth date to 時辰 and storage midpoint HH:mm. */
export function birthTimeToSijin(hour: number, minute: number): SijinInfo {
  const t = Math.max(0, Math.min(hour * 60 + minute, 24 * 60 - 1))
  const inRange = (start: number, end: number) => t >= start && t < end

  if (t >= 23 * 60 || t < 1 * 60) {
    return { kr: '子時', rangeLabel: '23:00–01:00', midpointHHMM: '00:00' }
  }
  if (inRange(60, 180)) return { kr: '丑時', rangeLabel: '01:00–03:00', midpointHHMM: '02:00' }
  if (inRange(180, 300)) return { kr: '寅時', rangeLabel: '03:00–05:00', midpointHHMM: '04:00' }
  if (inRange(300, 420)) return { kr: '卯時', rangeLabel: '05:00–07:00', midpointHHMM: '06:00' }
  if (inRange(420, 540)) return { kr: '辰時', rangeLabel: '07:00–09:00', midpointHHMM: '08:00' }
  if (inRange(540, 660)) return { kr: '巳時', rangeLabel: '09:00–11:00', midpointHHMM: '10:00' }
  if (inRange(660, 780)) return { kr: '午時', rangeLabel: '11:00–13:00', midpointHHMM: '12:00' }
  if (inRange(780, 900)) return { kr: '未時', rangeLabel: '13:00–15:00', midpointHHMM: '14:00' }
  if (inRange(900, 1020)) return { kr: '申時', rangeLabel: '15:00–17:00', midpointHHMM: '16:00' }
  if (inRange(1020, 1140)) return { kr: '酉時', rangeLabel: '17:00–19:00', midpointHHMM: '18:00' }
  if (inRange(1140, 1260)) return { kr: '戌時', rangeLabel: '19:00–21:00', midpointHHMM: '20:00' }
  if (inRange(1260, 1380)) return { kr: '亥時', rangeLabel: '21:00–23:00', midpointHHMM: '22:00' }
  return { kr: '午時', rangeLabel: '11:00–13:00', midpointHHMM: '12:00' }
}
