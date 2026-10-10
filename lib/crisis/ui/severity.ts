export type SeverityLevel = 1 | 2 | 3 | 4 | 5

export type SeverityTheme = {
  stage: SeverityLevel
  color: string
  border: string
  bg: string
  bannerBg: string
  pulseBorder: boolean
  compact: boolean
}

export function clampStage(stage: number): SeverityLevel {
  if (stage >= 5) return 5
  if (stage >= 4) return 4
  if (stage >= 3) return 3
  if (stage >= 2) return 2
  return 1
}

/** Calm blue/green for 1–2, amber 3, orange 4, red 5. */
export function severityColor(stage: number): string {
  if (stage >= 5) return '#fb7185'
  if (stage >= 4) return '#fb923c'
  if (stage >= 3) return '#fbbf24'
  if (stage >= 2) return '#38bdf8'
  return '#34d399'
}

export function severityTheme(stage: number): SeverityTheme {
  const level = clampStage(stage)
  const color = severityColor(level)
  if (level === 5) {
    return {
      stage: 5,
      color,
      border: 'rgba(251,113,133,0.75)',
      bg: 'rgba(251,113,133,0.10)',
      bannerBg: 'rgba(251,113,133,0.18)',
      pulseBorder: true,
      compact: false,
    }
  }
  if (level === 4) {
    return {
      stage: 4,
      color,
      border: 'rgba(251,146,60,0.65)',
      bg: 'rgba(251,146,60,0.08)',
      bannerBg: 'rgba(251,146,60,0.16)',
      pulseBorder: false,
      compact: false,
    }
  }
  if (level === 3) {
    return {
      stage: 3,
      color,
      border: 'rgba(251,191,36,0.50)',
      bg: 'rgba(251,191,36,0.07)',
      bannerBg: 'rgba(251,191,36,0.14)',
      pulseBorder: false,
      compact: false,
    }
  }
  return {
    stage: level,
    color,
    border: `${color}55`,
    bg: `${color}12`,
    bannerBg: `${color}18`,
    pulseBorder: false,
    compact: true,
  }
}

export function maxStage(stages: Array<number | null | undefined>): number {
  let max = 1
  for (const value of stages) {
    if (typeof value === 'number' && value > max) max = value
  }
  return max
}
