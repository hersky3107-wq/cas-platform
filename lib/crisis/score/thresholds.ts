/** Editable Layer-1 thresholds. Change numbers here; do not scatter magic values. */

export const SCORE_SCHEDULE_MINUTES = 180

export const RAIN = {
  sumSoftMm: 100,
  sumHardMm: 200,
  sumSoftValue: 0.5,
  sumHardValue: 1,
  dayMm: 50,
  dayValue: 0.5,
}

export const RIVER = {
  ratioSoft: 2,
  ratioHard: 3,
  softValue: 0.5,
  hardValue: 1,
}

export const CYCLONE = {
  nearKm: 300,
  nearValue: 0.6,
  closeKm: 100,
  closeValue: 1,
  horizonDays: 5,
}

export const QUAKE = {
  days: 7,
  nearKm: 100,
  magSoft: 5.5,
  magSoftValue: 0.6,
  magHard: 6.5,
  magHardValue: 1,
  swarmKm: 50,
  swarmHours: 72,
  swarmCount: 10,
  swarmValue: 0.4,
}

export const GDACS = {
  orangeValue: 0.6,
  redValue: 1,
  days: 7,
  nearKm: 300,
}

export const VOLCANO = {
  orangeValue: 0.6,
  redValue: 1,
  days: 14,
  nearKm: 300,
}

export const FIRE = {
  topPercentile: 0.99,
  topValue: 0.4,
  watchlistValue: 0.6,
}

export const CONFLICT = {
  ratioSoft: 3,
  ratioHard: 5,
  softValue: 0.6,
  hardValue: 1,
  minHistoryDays: 7,
  absTopPercentile: 0.98,
  absValue: 0.5,
}

export const SILENCE = {
  fraction: 0.3,
  minHistoryDays: 7,
  value: 0.7,
}

export const INTERNET = {
  value: 0.8,
  activeHours: 72,
}

export const ADVISORY = {
  changeHours: 72,
  changeValue: 0.6,
  divergeValue: 0.7,
}

export const WIKI = {
  value: 0.4,
  days: 2,
}

export const FOOD = {
  ipcSoft: 3,
  ipcHard: 4,
  softValue: 0.5,
  hardValue: 1,
}

export const DAM = {
  nearKm: 50,
  base: 0.12,
  heightRefM: 80,
  heightWeight: 0.22,
  ageRefYears: 80,
  ageWeight: 0.16,
  unknownAge: 0.4,
  upstreamAdd: 0.15,
}

export const CAMP = {
  smallMax: 4,
  mediumMax: 19,
  small: 0.3,
  medium: 0.45,
  large: 0.6,
}

export const NUCLEAR = {
  nearKm: 50,
  value: 0.3,
}

export const INFORM = {
  scale: 10,
  fragilityCap: 0.5,
}

export const PEOPLE = {
  logCap: 10_000_000,
  urbanWeight: 0.8,
  exposureWeight: 0.2,
}

export const SCORE = {
  compoundDepartments: 10,
  compoundRainRiverDam: 10,
  cascadeBonus: 10,
}

export const STAGE_MIN = [0, 0, 12, 25, 40, 60] as const

export const CARD_MAX_BYTES = 1800

export const COMPONENT_DEPARTMENT: Record<string, string> = {
  rain: 'natural',
  river: 'natural',
  cyclone: 'natural',
  quake: 'natural',
  gdacs: 'natural',
  volcano: 'natural',
  fire: 'natural',
  conflict: 'conflict',
  silence: 'conflict',
  internet: 'connectivity',
  advisory: 'advisory',
  wiki: 'media',
  food: 'food',
}

/** cascade.trigger_type → fired component keys that satisfy it. */
export const CASCADE_TRIGGER_COMPONENTS: Record<string, string[]> = {
  cyclone: ['cyclone'],
  flood: ['rain', 'river', 'cyclone'],
  dam_failure: ['rain', 'river'],
  wash_breakdown: ['conflict', 'rain', 'river', 'cyclone', 'food'],
  conflict: ['conflict'],
  wildfire: ['fire'],
  earthquake: ['quake'],
  glacial_lake: [],
  storm_surge: ['cyclone'],
  drought: ['food'],
  crop_failure: ['food'],
  food_price_spike: ['food'],
  protest: ['conflict'],
  internet_shutdown: ['internet'],
  airspace_closure: [],
  heatwave: [],
  volcanic_eruption: ['volcano'],
  disaster: ['gdacs'],
  currency_collapse: [],
  fuel_shortage: [],
}

export const SCORE_SOURCE = 'score'
