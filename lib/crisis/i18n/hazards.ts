import type { CrisisLocale } from './locales'
import {
  type ExpectedWindow,
  type HazardGroupKey,
  type HazardKind,
  HAZARD_GROUPS,
  HAZARD_KINDS,
  HAZARD_REGISTRY,
  hazardKindForScoreTrigger,
  isHazardKind,
  kindsByGroup,
} from '../hazards'

export type HazardUiSlice = {
  hazardLegendTitle: string
  hazardGroupLabel: (group: HazardGroupKey) => string
  hazardKindLabel: (kind: HazardKind) => string
  triggerLabel: (key: string) => string
  triggerExplanation: (key: string) => string
  formatExpectedWindow: (window: ExpectedWindow | null | undefined) => string
  triggerChipLine: (key: string, window: ExpectedWindow | null | undefined) => string
}

const GROUP_KO: Record<HazardGroupKey, string> = {
  natural_geo: '자연-지구물리',
  natural_water: '자연-물',
  natural_weather: '자연-기상',
  natural_climate: '자연-기후',
  natural_bio: '자연-생물',
  natural_space: '자연-우주',
  human_tech: '인재·기술',
  conflict_terror: '분쟁·테러',
  socio_economic: '사회·경제',
}

const GROUP_EN: Record<HazardGroupKey, string> = {
  natural_geo: 'Natural — geophysical',
  natural_water: 'Natural — water',
  natural_weather: 'Natural — weather',
  natural_climate: 'Natural — climate',
  natural_bio: 'Natural — biological',
  natural_space: 'Natural — space',
  human_tech: 'Human & technical',
  conflict_terror: 'Conflict & terror',
  socio_economic: 'Social & economic',
}

const LABEL_KO: Record<HazardKind, string> = {
  earthquake: '지진',
  tsunami: '쓰나미',
  volcano: '화산',
  landslide: '산사태',
  flood_rain: '폭우',
  river_flood: '강 범람',
  glof: '빙하호수 붕괴',
  cyclone: '태풍',
  heat: '폭염',
  cold: '한파',
  drought: '가뭄',
  wildfire: '산불',
  epidemic: '감염병',
  locust: '메뚜기',
  animal_disease: '축산 전염병',
  space_weather: '우주 기상',
  dam_failure: '댐 붕괴',
  industrial: '산업 사고',
  nuclear: '핵·방사능',
  grid_failure: '전력망',
  food_crisis: '식량 위기',
  economic_shock: '경제 충격',
  conflict: '분쟁',
  terror_risk: '테러 위험',
  unrest: '소요',
  internet_shutdown: '인터넷 차단',
  travel_advisory: '여행경보',
  gradual_worsening: '서서히 악화',
}

const LABEL_EN: Record<HazardKind, string> = {
  earthquake: 'Earthquake',
  tsunami: 'Tsunami',
  volcano: 'Volcano',
  landslide: 'Landslide',
  flood_rain: 'Heavy rain',
  river_flood: 'River flood',
  glof: 'Glacial lake outburst',
  cyclone: 'Cyclone',
  heat: 'Extreme heat',
  cold: 'Extreme cold',
  drought: 'Drought',
  wildfire: 'Wildfire',
  epidemic: 'Epidemic',
  locust: 'Locusts',
  animal_disease: 'Livestock disease',
  space_weather: 'Space weather',
  dam_failure: 'Dam failure',
  industrial: 'Industrial accident',
  nuclear: 'Nuclear hazard',
  grid_failure: 'Grid failure',
  food_crisis: 'Food crisis',
  economic_shock: 'Economic shock',
  conflict: 'Conflict',
  terror_risk: 'Terror risk',
  unrest: 'Unrest',
  internet_shutdown: 'Internet shutdown',
  travel_advisory: 'Travel advisory',
  gradual_worsening: 'Gradual worsening',
}

const EXPLAIN_KO: Record<HazardKind, string> = {
  earthquake: '땅이 흔들리며 건물·도로가 무너지고 화재·가스 누출이 이어질 수 있습니다.',
  tsunami: '해일이 해안을 덮치며 짧은 시간에 큰 피해가 납니다.',
  volcano: '화산재·가스·용암이 항공·호흡·농경에 장기 피해를 줍니다.',
  landslide: '비·진동 뒤 경사면이 무너져 마을·도로를 덮습니다.',
  flood_rain: '짧은 시간 많은 비가 배수를 넘겨 저지대를 잠깁니다.',
  river_flood: '강 수위가 둑·교량·농경지를 넘어 확장합니다.',
  glof: '빙하 호수가 터져 하류로 급격한 홍수가 납니다.',
  cyclone: '강풍·폭우·해일이 연안과 내륙을 동시에 치습니다.',
  heat: '고온이 노약자·야외 노동자에게 급사·탈진을 일으킵니다.',
  cold: '한파가 전력·수도·교통을 끊고 실외 노출을 위험하게 합니다.',
  drought: '장기 가뭄이 식수·작물·목축을 동시에 줄입니다.',
  wildfire: '건조·바람과 겹치면 연기와 불길이 빠르게 퍼집니다.',
  epidemic: '감염이 병원·이동·식수 위생을 동시에 압박합니다.',
  locust: '메뚜기 떼가 작황을 순식간에 갉아 식량 위기를 키웁니다.',
  animal_disease: '가축 전염병이 식량·무역·농촌 소득을 동시에 흔듭니다.',
  space_weather: '태양 활동이 위성·전력·항공 통신을 교란합니다.',
  dam_failure: '댐·방류 실패가 하류를 예고 없이 잠길 수 있습니다.',
  industrial: '화학·폭발 사고가 독성 구름과 2차 화재를 만듭니다.',
  nuclear: '방사능 누출이 장기 대피·식수·농산물을 오염시킵니다.',
  grid_failure: '정전이 병원·펌프·냉장·통신을 동시에 멈춥니다.',
  food_crisis: '식량 가격·수급 악화가 폭력·이주를 부추깁니다.',
  economic_shock: '환율·물가 충격이 서비스·구호 예산을 줄입니다.',
  conflict: '교전·폭력이 도로·병원·이동을 끊습니다.',
  terror_risk: '표적 공격이 군·민간·외교 시설을 동시에 위협합니다.',
  unrest: '시위·폭동이 통행·상점·치안을 하룻밤에 바꿉니다.',
  internet_shutdown: '통신 차단이 경보·송금·구호 조율을 막습니다.',
  travel_advisory: '외교 경보는 대피·보험·항로를 갑자기 좁힙니다.',
  gradual_worsening: '신호는 작지만 여러 지표가 같은 방향으로 천천히 나빠집니다.',
}

const EXPLAIN_EN: Record<HazardKind, string> = {
  earthquake: 'Ground shaking can collapse buildings and trigger fires and gas leaks.',
  tsunami: 'Sea waves can inundate coasts with little warning.',
  volcano: 'Ash, gas, and lava disrupt air travel, breathing, and farming for weeks.',
  landslide: 'Saturated slopes can bury roads and settlements after rain or shaking.',
  flood_rain: 'Intense rain overwhelms drains and floods low areas quickly.',
  river_flood: 'Rising rivers spill over banks, bridges, and fields.',
  glof: 'A glacial lake burst sends a sudden flood downstream.',
  cyclone: 'Wind, rain, and surge hit coasts and inland together.',
  heat: 'Extreme heat kills vulnerable people and outdoor workers.',
  cold: 'Cold snaps strain power, water, and transport.',
  drought: 'Long dry spells cut water, crops, and herds together.',
  wildfire: 'Dry wind spreads smoke and flames faster than crews can flank.',
  epidemic: 'Outbreaks overload clinics, movement, and clean water.',
  locust: 'Swarms can strip fields in days and deepen food stress.',
  animal_disease: 'Livestock outbreaks hit food supply and rural income.',
  space_weather: 'Solar storms disrupt satellites, power, and aviation.',
  dam_failure: 'Dam or spillway failure can flood downstream without village warning.',
  industrial: 'Chemical or blast accidents release toxic plumes and secondary fires.',
  nuclear: 'Radiation forces long evacuations and taints water and food.',
  grid_failure: 'Blackouts stop pumps, hospitals, cold chains, and comms together.',
  food_crisis: 'Food price spikes and shortages fuel unrest and displacement.',
  economic_shock: 'Currency and price shocks shrink services and aid budgets.',
  conflict: 'Fighting cuts roads, clinics, and safe movement.',
  terror_risk: 'Targeted attacks threaten military, civilian, and diplomatic sites.',
  unrest: 'Protests and riots can shut streets and shops overnight.',
  internet_shutdown: 'Outages block alerts, transfers, and aid coordination.',
  travel_advisory: 'Embassy alerts suddenly narrow travel and evacuation options.',
  gradual_worsening: 'Signals stay small but several indicators drift worse together.',
}

const LEGACY_TRIGGER_KO: Record<string, string> = {
  rain: LABEL_KO.flood_rain,
  river: LABEL_KO.river_flood,
  quake: LABEL_KO.earthquake,
  fire: LABEL_KO.wildfire,
  food: LABEL_KO.food_crisis,
  silence: LABEL_KO.gradual_worsening,
  internet: LABEL_KO.internet_shutdown,
  advisory: LABEL_KO.travel_advisory,
  slow_burn: LABEL_KO.gradual_worsening,
  escalation: LABEL_KO.conflict,
  health_attention: LABEL_KO.epidemic,
  gdacs: '국제 경보',
  wiki: '맥락',
}

const LEGACY_TRIGGER_EN: Record<string, string> = {
  rain: LABEL_EN.flood_rain,
  river: LABEL_EN.river_flood,
  quake: LABEL_EN.earthquake,
  fire: LABEL_EN.wildfire,
  food: LABEL_EN.food_crisis,
  silence: LABEL_EN.gradual_worsening,
  internet: LABEL_EN.internet_shutdown,
  advisory: LABEL_EN.travel_advisory,
  slow_burn: LABEL_EN.gradual_worsening,
  escalation: LABEL_EN.conflict,
  health_attention: LABEL_EN.epidemic,
  gdacs: 'Intl alert',
  wiki: 'Context',
}

function formatWindowKo(window: ExpectedWindow | null | undefined): string {
  if (!window) return ''
  if (window.type === 'ongoing') return '진행 중'
  if (window.type === 'relative_days') {
    if (window.min === window.max) return `${window.min}일 뒤`
    return `${window.min}~${window.max}일 뒤`
  }
  if (window.type === 'relative_hours') {
    if (window.min === window.max) return `${window.min}시간 뒤`
    return `${window.min}~${window.max}시간 뒤`
  }
  if (window.type === 'relative_months') {
    if (window.min === window.max) return `${window.min}개월 뒤`
    return `${window.min}~${window.max}개월 뒤`
  }
  const band = window.band
  if (band === 'hours_24_72') return '24~72시간 뒤'
  if (band === 'days_3_7') return '3~7일 뒤'
  if (band === 'weeks_1_2') return '1~2주 뒤'
  if (band === 'weeks_2_6') return '2~6주 뒤'
  if (band === 'months_1_3') return '1~3개월 뒤'
  return '시기 불명'
}

function formatWindowEn(window: ExpectedWindow | null | undefined): string {
  if (!window) return ''
  if (window.type === 'ongoing') return 'ongoing'
  if (window.type === 'relative_days') {
    if (window.min === window.max) return `in ${window.min} days`
    return `in ${window.min}–${window.max} days`
  }
  if (window.type === 'relative_hours') {
    if (window.min === window.max) return `in ${window.min} hours`
    return `in ${window.min}–${window.max} hours`
  }
  if (window.type === 'relative_months') {
    if (window.min === window.max) return `in ${window.min} months`
    return `in ${window.min}–${window.max} months`
  }
  const band = window.band
  if (band === 'hours_24_72') return 'in 24–72 hours'
  if (band === 'days_3_7') return 'in 3–7 days'
  if (band === 'weeks_1_2') return 'in 1–2 weeks'
  if (band === 'weeks_2_6') return 'in 2–6 weeks'
  if (band === 'months_1_3') return 'in 1–3 months'
  return 'timing unclear'
}

function buildSlice(locale: 'ko' | 'en'): HazardUiSlice {
  const labels = locale === 'ko' ? LABEL_KO : LABEL_EN
  const legacy = locale === 'ko' ? LEGACY_TRIGGER_KO : LEGACY_TRIGGER_EN
  const groups = locale === 'ko' ? GROUP_KO : GROUP_EN
  const explain = locale === 'ko' ? EXPLAIN_KO : EXPLAIN_EN
  const formatExpectedWindow = locale === 'ko' ? formatWindowKo : formatWindowEn
  return {
    hazardLegendTitle: locale === 'ko' ? '위험 유형' : 'Hazard types',
    hazardGroupLabel: (group) => groups[group] ?? group,
    hazardKindLabel: (kind) => labels[kind] ?? kind,
    triggerLabel: (key) => {
      const normalized = key.trim().toLowerCase()
      if (isHazardKind(normalized)) return labels[normalized]
      if (legacy[normalized]) return legacy[normalized]
      return labels[hazardKindForScoreTrigger(normalized)] ?? key
    },
    triggerExplanation: (key) => {
      const kind = isHazardKind(key) ? key : hazardKindForScoreTrigger(key.trim().toLowerCase())
      return explain[kind] ?? explain.gradual_worsening
    },
    formatExpectedWindow,
    triggerChipLine: (key, window) => {
      const normalized = key.trim().toLowerCase()
      const label = isHazardKind(normalized)
        ? labels[normalized]
        : legacy[normalized] ?? labels[hazardKindForScoreTrigger(normalized)] ?? key
      const when = formatExpectedWindow(window)
      return when ? `${label} · ${when}` : label
    },
  }
}

export const HAZARD_UI_KO = buildSlice('ko')
export const HAZARD_UI_EN = buildSlice('en')

export function hazardUiForLocale(locale: CrisisLocale): HazardUiSlice {
  return locale === 'ko' ? HAZARD_UI_KO : HAZARD_UI_EN
}

export function legendGroups(): Array<{ group: HazardGroupKey; kinds: HazardKind[] }> {
  const byGroup = kindsByGroup()
  return HAZARD_GROUPS.map((group) => ({ group, kinds: byGroup.get(group) ?? [] })).filter((row) => row.kinds.length > 0)
}

export function allHazardKindsRegistered(): boolean {
  return HAZARD_KINDS.length === Object.keys(HAZARD_REGISTRY).length
}
