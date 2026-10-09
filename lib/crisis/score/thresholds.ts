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
  /** Forecast peak must reach this before a ratio can fire. Stops near-zero today values. */
  minPeakM3s: 50,
  minBaselineM3s: 1,
  ratioCap: 10,
  /** Prefer ratio_to_30d_mean only after this many stored forecast days. */
  minHistoryDays: 14,
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
  /** Detections required: top 1% of today's frp_sum, or at least this many points, and frp_sum > 0. */
  minCount: 20,
  /** Applied only after fire already fired. */
  watchlistMultiplier: 1.3,
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
  minWeeks: 8,
  minMean30: 50,
  consecutiveDays: 2,
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
  /** Kept articles amplify an already-fired component. They are not a trigger. */
  amplify: 1.15,
  days: 2,
}

export const WIKI_AMPLIFY = WIKI.amplify

export const HEALTH_ATTENTION = {
  value: 0.3,
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
  /** Country modifier inside the fragility sum, before diminishing returns. */
  fragilityCap: 0.3,
}

/** 1 - exp(-k * x). k is editable. */
export const FRAGILITY_K = 1.2

export const DAM_TRIGGER_KEYS = ['rain', 'river', 'quake'] as const
export const CAMP_TRIGGER_KEYS = ['rain', 'river', 'conflict', 'food'] as const
export const NUCLEAR_TRIGGER_KEYS = ['quake', 'rain', 'river'] as const

export const PEOPLE = {
  logCap: 10_000_000,
  urbanWeight: 0.8,
  exposureWeight: 0.2,
}

export const WATCHLIST_FRAGILITY = {
  multiplier: 1.5,
  kinds: ['dam', 'levee', 'nuclear_plant', 'chemical_plant', 'port'] as const,
}

export const ESCALATION = {
  growing: 0.5,
  fast: 0.8,
  days: 3,
  cycloneKtPerDay: 5,
  cycloneFastKtPerDay: 15,
  conflictPerDay: 1,
  conflictFastPerDay: 3,
  fireFrpPerDay: 20,
  fireFastFrpPerDay: 80,
  volcanoPerDay: 2,
  volcanoFastPerDay: 5,
  floodPerDay: 10,
  floodFastPerDay: 30,
  outbreakPerDay: 1,
  outbreakFastPerDay: 3,
}

export const SCORE = {
  cap: 100,
  /** Natural plus human/war. Raised from +10 on 2026-10-09. */
  compoundDepartments: 15,
  /** Each counting component must reach this, and they must sit in two families. */
  compoundMin: 0.5,
  cascadeBonus: 10,
}

/**
 * Stage cuts after the 2026-10-09 dry-run saturated stage 5.
 * 1: <40, 2: >=40, 3: >=55, 4: >=70, 5: >=85.
 * Target: stage >= 2 about 200 regions, stage 5 about 10.
 */
export const STAGE_MIN = [0, 0, 40, 55, 70, 85] as const

export const SATURATION_FRACTION = 0.1

/** natural vs human/war vs media. Same-family pairs do not earn the compound bonus. */
export const COMPONENT_FAMILY: Record<string, 'natural' | 'human' | 'media'> = {
  rain: 'natural',
  river: 'natural',
  cyclone: 'natural',
  quake: 'natural',
  gdacs: 'natural',
  volcano: 'natural',
  fire: 'natural',
  conflict: 'human',
  silence: 'human',
  internet: 'human',
  advisory: 'human',
  food: 'human',
  wiki: 'media',
  health_attention: 'human',
  slow_burn: 'human',
}

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
  health_attention: 'health',
  escalation: 'escalation',
  slow_burn: 'conflict',
  cyclone_formation: 'natural',
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
  maritime_attack: [],
  nuclear_hazard: ['quake', 'rain', 'river'],
  vector_disease: ['rain'],
}

export const SLOW_BURN = {
  quietRise: 0.4,
  dyadFocus: 0.6,
  escalationSpread: 0.7,
  minIndicators: 3,
  minPoints: 8,
  minEvents: 80,
  minCameo: 20,
  windowDays: 28,
  baselineDays: 90,
  agreeFraction: 0.6,
  spikeRatio: 3,
  advisoryDays: 60,
  recentDays: 14,
  priorDays: 60,
  newActorMinRecent: 5,
  shareSlope: 0.003,
}

export const SCORE_SOURCE = 'score'
