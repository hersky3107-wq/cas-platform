export type EvidenceLevel = 'sourced' | 'hypothesis'

export interface CascadeSource {
  title: string
  url: string
  publisher: string
  year: number
}

export interface CascadeSeed {
  id: string
  trigger_type: string
  effect_type: string
  lag_min_days: number
  lag_max_days: number
  conditions: Record<string, unknown>
  mechanism: string
  evidence_level: EvidenceLevel
  sources: CascadeSource[]
  notes: string | null
}

const LAG_NOTE =
  'The cited page supports the pathway. The day window is an operational bound for the engine, not a figure taken from the source.'

const RELIEFWEB_DANIEL: CascadeSource = {
  title: 'Libya: Storm Daniel - Sep 2023',
  url: 'https://reliefweb.int/disaster/fl-2023-000168-lby',
  publisher: 'ReliefWeb / OCHA',
  year: 2023,
}

const WHO_FLOODS: CascadeSource = {
  title: 'Floods',
  url: 'https://www.who.int/health-topics/floods',
  publisher: 'World Health Organization',
  year: 2024,
}

const WHO_CHOLERA: CascadeSource = {
  title: 'Cholera',
  url: 'https://www.who.int/news-room/fact-sheets/detail/cholera',
  publisher: 'World Health Organization',
  year: 2024,
}

const WHO_MEASLES: CascadeSource = {
  title: 'Measles',
  url: 'https://www.who.int/news-room/fact-sheets/detail/measles',
  publisher: 'World Health Organization',
  year: 2024,
}

const WHO_WILDFIRES: CascadeSource = {
  title: 'Wildfires',
  url: 'https://www.who.int/health-topics/wildfires',
  publisher: 'World Health Organization',
  year: 2024,
}

function sourced(
  row: Omit<CascadeSeed, 'evidence_level' | 'notes'> & { notes?: string | null },
): CascadeSeed {
  return { ...row, evidence_level: 'sourced', notes: row.notes ?? LAG_NOTE }
}

function hypothesis(
  row: Omit<CascadeSeed, 'evidence_level' | 'sources' | 'notes'> & { notes?: string | null },
): CascadeSeed {
  return {
    ...row,
    evidence_level: 'hypothesis',
    sources: [],
    notes: row.notes ?? 'No public source was verified for this pathway in this seed.',
  }
}

export const CASCADE_SEEDS: CascadeSeed[] = [
  sourced({
    id: 'cyclone-flood',
    trigger_type: 'cyclone',
    effect_type: 'flood',
    lag_min_days: 0,
    lag_max_days: 2,
    conditions: { min_population: 10000 },
    mechanism:
      'A tropical cyclone or similar coastal storm drops extreme rain and drives water onto land. Flooding can begin during the storm and peak within a day or two, especially where drainage and upstream storage are already weak. Storm Daniel in eastern Libya in September 2023 produced flooding that then overwhelmed the dams above Derna.',
    sources: [RELIEFWEB_DANIEL],
  }),
  sourced({
    id: 'flood-dam-failure',
    trigger_type: 'flood',
    effect_type: 'dam_failure',
    lag_min_days: 0,
    lag_max_days: 2,
    conditions: { requires_fragility: ['dam'], min_population: 10000 },
    mechanism:
      'Flood inflow can overtop or breach a dam when the structure is unmaintained, undersized, or already damaged. Failure is often the same day as the flood peak. In Derna the collapse of the Mansour and Derna dams severely compounded the damage downstream of the storm.',
    sources: [RELIEFWEB_DANIEL],
  }),
  sourced({
    id: 'dam-failure-downstream-flood',
    trigger_type: 'dam_failure',
    effect_type: 'downstream_destruction',
    lag_min_days: 0,
    lag_max_days: 1,
    conditions: { requires_fragility: ['dam'], min_population: 10000 },
    mechanism:
      'A dam breach releases stored water as a flood wave. Cities on the river below can be hit within hours. ReliefWeb records that the collapse of the two Derna dams severely compounded damage in the city downstream.',
    sources: [RELIEFWEB_DANIEL],
  }),
  sourced({
    id: 'flood-displacement',
    trigger_type: 'flood',
    effect_type: 'displacement',
    lag_min_days: 0,
    lag_max_days: 7,
    conditions: { min_population: 10000 },
    mechanism:
      'Flooded housing and destroyed roads push people out of the affected city within the first week. ReliefWeb reported large displacement figures after Storm Daniel and the Derna dam collapses.',
    sources: [RELIEFWEB_DANIEL],
  }),
  sourced({
    id: 'flood-cholera',
    trigger_type: 'flood',
    effect_type: 'cholera',
    lag_min_days: 0,
    lag_max_days: 21,
    conditions: { min_population: 10000 },
    mechanism:
      'Floodwater mixes drinking supplies with sewage. WHO lists water-borne disease, including cholera, among the medium- and long-term health impacts of floods. Cases can appear within days and keep rising for several weeks while water and sanitation stay broken.',
    sources: [WHO_FLOODS],
  }),
  sourced({
    id: 'flood-typhoid',
    trigger_type: 'flood',
    effect_type: 'typhoid',
    lag_min_days: 7,
    lag_max_days: 28,
    conditions: { min_population: 10000 },
    mechanism:
      'Contaminated water after a flood can transmit typhoid as well as cholera. WHO names typhoid among the water-borne diseases that follow floods. The incubation period puts the operational window later than the first flood day, typically from the first week into the following month.',
    sources: [WHO_FLOODS],
  }),
  sourced({
    id: 'flood-malaria',
    trigger_type: 'flood',
    effect_type: 'malaria',
    lag_min_days: 14,
    lag_max_days: 60,
    conditions: { min_population: 10000 },
    mechanism:
      'Standing water left after a flood gives mosquitoes breeding sites. WHO lists malaria among the vector-borne diseases that can follow floods. Transmission does not spike on the flood day; the operational window starts after mosquito development, often two weeks to two months later.',
    sources: [WHO_FLOODS],
  }),
  sourced({
    id: 'wash-breakdown-cholera',
    trigger_type: 'wash_breakdown',
    effect_type: 'cholera',
    lag_min_days: 0,
    lag_max_days: 21,
    conditions: {},
    mechanism:
      'Cholera spreads where safe water, sanitation, and hygiene fail. WHO states that this breakdown may come from conflict, population displacement, climate events such as cyclones, floods or drought, or from a lack of investment in WASH. Outbreaks can start within days of the breakdown and continue for weeks.',
    sources: [WHO_CHOLERA],
  }),
  sourced({
    id: 'conflict-camp-measles',
    trigger_type: 'conflict',
    effect_type: 'measles_outbreak',
    lag_min_days: 7,
    lag_max_days: 60,
    conditions: { requires_fragility: ['refugee_camp'] },
    mechanism:
      'Conflict and disaster interrupt immunization, and overcrowding in residential camps raises infection risk. WHO states that the risk of measles outbreaks is particularly high amongst refugees. A camp outbreak is an operational concern from about a week after displacement through the following two months.',
    sources: [WHO_MEASLES],
  }),
  sourced({
    id: 'wildfire-smoke-health',
    trigger_type: 'wildfire',
    effect_type: 'air_quality_health',
    lag_min_days: 0,
    lag_max_days: 14,
    conditions: { min_population: 10000 },
    mechanism:
      'Wildfire smoke is a mixture of hazardous air pollutants, including PM2.5, nitrogen dioxide, and ozone. WHO describes those pollutants as the exposure people breathe during and after a fire. Health effects track the smoke plume and can persist for days after the flame front has moved on.',
    sources: [WHO_WILDFIRES],
  }),
  hypothesis({
    id: 'flood-levee-failure',
    trigger_type: 'flood',
    effect_type: 'levee_failure',
    lag_min_days: 0,
    lag_max_days: 2,
    conditions: { requires_fragility: ['levee'], min_population: 10000 },
    mechanism:
      'A river already at flood stage can overtop or breach a levee the same day, especially where the embankment is old, eroded, or not maintained. The failure then sends water into the protected side, which is often the denser settlement. This seed treats that pathway as a hypothesis until a checked public source is attached.',
  }),
  hypothesis({
    id: 'earthquake-landslide',
    trigger_type: 'earthquake',
    effect_type: 'landslide',
    lag_min_days: 0,
    lag_max_days: 3,
    conditions: {},
    mechanism:
      'Strong shaking on steep, saturated, or previously failed slopes can trigger landslides during the earthquake or in the aftershock days that follow. Roads and hillside towns are the usual exposure. No citation was verified for this seed, so the link stays a hypothesis.',
  }),
  hypothesis({
    id: 'earthquake-dam-damage',
    trigger_type: 'earthquake',
    effect_type: 'dam_damage',
    lag_min_days: 0,
    lag_max_days: 7,
    conditions: { requires_fragility: ['dam'] },
    mechanism:
      'Shaking can crack a dam, damage spillways, or start internal erosion. The structure may not fail in the quake itself; the dangerous window is the following days if the reservoir stays high and inspections do not happen. This seed does not attach a verified source.',
  }),
  hypothesis({
    id: 'earthquake-building-collapse',
    trigger_type: 'earthquake',
    effect_type: 'building_collapse',
    lag_min_days: 0,
    lag_max_days: 7,
    conditions: { min_population: 50000 },
    mechanism:
      'Shaking collapses older or poorly tied buildings where many people live. This seed uses urban population as the exposure we can measure; a separate inventory of building age is not loaded. The dangerous window is the quake itself and the following days of aftershocks.',
  }),
  hypothesis({
    id: 'earthquake-landslide-dam',
    trigger_type: 'earthquake',
    effect_type: 'landslide_dam',
    lag_min_days: 0,
    lag_max_days: 14,
    conditions: {},
    mechanism:
      'A quake-triggered landslide can block a valley and pond a river. The new lake may overtop within days to two weeks. No slope layer is attached, so the pathway stays a hypothesis whenever the earthquake trigger is on.',
  }),
  hypothesis({
    id: 'earthquake-tsunami',
    trigger_type: 'earthquake',
    effect_type: 'tsunami',
    lag_min_days: 0,
    lag_max_days: 1,
    conditions: { requires_coastal: true, min_population: 10000 },
    mechanism:
      'A large offshore or coastal quake can send a tsunami into the same coast within hours. This seed fires only when the region sits near the Natural Earth coastline.',
  }),
  hypothesis({
    id: 'glof-downstream-flood',
    trigger_type: 'glacial_lake',
    effect_type: 'outburst_flood',
    lag_min_days: 0,
    lag_max_days: 1,
    conditions: { requires_fragility: ['glacial_lake'], min_population: 1000 },
    mechanism:
      'A glacial lake held by ice or a loose moraine can empty in hours when the dam fails, sending a flood down the valley. Downstream towns see the wave the same day. The engine should only fire this when a glacial-lake fragility point exists. No citation was verified for this seed.',
  }),
  hypothesis({
    id: 'cyclone-storm-surge',
    trigger_type: 'cyclone',
    effect_type: 'storm_surge',
    lag_min_days: 0,
    lag_max_days: 1,
    conditions: { min_population: 10000 },
    mechanism:
      'A cyclone pushing water toward a shallow coast can raise a surge as the storm makes landfall. The surge arrives with the storm, not days later. Low-lying districts and ports are the exposure. This pathway is a hypothesis in this seed.',
  }),
  hypothesis({
    id: 'storm-surge-coastal-flood',
    trigger_type: 'storm_surge',
    effect_type: 'coastal_flood',
    lag_min_days: 0,
    lag_max_days: 2,
    conditions: { min_population: 10000 },
    mechanism:
      'Surge water crosses the shoreline and floods coastal neighborhoods, often together with heavy rain so drains cannot empty. Flooding is same-day to the next day. This seed keeps the step as a hypothesis.',
  }),
  hypothesis({
    id: 'drought-crop-failure',
    trigger_type: 'drought',
    effect_type: 'crop_failure',
    lag_min_days: 30,
    lag_max_days: 120,
    conditions: {},
    mechanism:
      'A failed rainy season shows up as a harvest loss one to four months later, not on the first dry week. Rainfed staples are the usual path. The engine should not treat a short dry spell as an immediate crop failure. No citation was verified here.',
  }),
  hypothesis({
    id: 'crop-failure-food-price',
    trigger_type: 'crop_failure',
    effect_type: 'food_price_spike',
    lag_min_days: 14,
    lag_max_days: 90,
    conditions: {},
    mechanism:
      'A poor harvest tightens local grain supply. Market prices can rise within weeks and stay high through the next harvest if imports and stocks do not fill the gap. This seed does not cite a checked paper for the lag.',
  }),
  hypothesis({
    id: 'food-price-protest',
    trigger_type: 'food_price_spike',
    effect_type: 'protest',
    lag_min_days: 0,
    lag_max_days: 30,
    conditions: { min_population: 50000 },
    mechanism:
      'A sharp rise in staple prices can bring street protests in cities within the same month, especially where wages are already thin. The protest is not automatic; it needs a population large enough to gather. Treated as a hypothesis.',
  }),
  hypothesis({
    id: 'protest-violence',
    trigger_type: 'protest',
    effect_type: 'violence',
    lag_min_days: 0,
    lag_max_days: 7,
    conditions: { min_population: 50000 },
    mechanism:
      'A protest can turn into clashes with security forces or rival groups the same day or over the following week. This is a possible escalation, not a prediction that every protest becomes violent. No source was verified for this seed.',
  }),
  hypothesis({
    id: 'drought-food-unrest',
    trigger_type: 'drought',
    effect_type: 'unrest',
    lag_min_days: 60,
    lag_max_days: 180,
    conditions: { min_population: 50000 },
    mechanism:
      'Drought does not produce unrest on day one. The plausible chain is a failed season, then higher food prices, then protest. The operational window is two to six months after the drought signal, and only where people are concentrated. Hypothesis only.',
  }),
  hypothesis({
    id: 'drought-food-crisis',
    trigger_type: 'drought',
    effect_type: 'food_crisis',
    lag_min_days: 30,
    lag_max_days: 90,
    conditions: { requires_ipc: true },
    mechanism:
      'A seasonal rainfall deficit on top of an existing IPC food-insecurity phase can deepen a food crisis over the next one to three months. The pathway is only attached where an IPC phase is already stored. Hypothesis only.',
  }),
  hypothesis({
    id: 'conflict-displacement',
    trigger_type: 'conflict',
    effect_type: 'displacement',
    lag_min_days: 0,
    lag_max_days: 14,
    conditions: { min_population: 10000 },
    mechanism:
      'Fighting in or near a town pushes people onto roads and into camps within hours to two weeks. The first movements are often the same day as the clashes. This seed does not attach a verified source.',
  }),
  hypothesis({
    id: 'conflict-camp-cholera',
    trigger_type: 'conflict',
    effect_type: 'cholera',
    lag_min_days: 0,
    lag_max_days: 21,
    conditions: { requires_fragility: ['refugee_camp'] },
    mechanism:
      'Displacement into a crowded camp with shared water and poor latrines is a setting where cholera can take off within three weeks. The fragility point has to be a camp, not a generic conflict pin. A separate sourced cascade covers WASH breakdown and cholera; this camp-specific conflict step stays a hypothesis.',
  }),
  hypothesis({
    id: 'conflict-infrastructure-disease',
    trigger_type: 'conflict',
    effect_type: 'waterborne_disease',
    lag_min_days: 3,
    lag_max_days: 30,
    conditions: { min_population: 10000 },
    mechanism:
      'Shelling or occupation that knocks out power and water treatment leaves a city on untreated water. Water-borne disease is a concern from a few days after the outage through the following month. Hypothesis until a checked source is added.',
  }),
  hypothesis({
    id: 'internet-shutdown-crackdown',
    trigger_type: 'internet_shutdown',
    effect_type: 'crackdown',
    lag_min_days: 0,
    lag_max_days: 3,
    conditions: {},
    mechanism:
      'A sudden national or regional internet shutdown has repeatedly preceded arrests, street crackdowns, or military movement within hours to three days. It is an absence signal, not proof of an operation. This seed keeps it as a hypothesis.',
  }),
  hypothesis({
    id: 'airspace-closure-strike',
    trigger_type: 'airspace_closure',
    effect_type: 'strike',
    lag_min_days: 0,
    lag_max_days: 2,
    conditions: {},
    mechanism:
      'Closing civilian airspace over a tense region can be the last public step before airstrikes, which may follow the same day or the next. A closure for weather or a routine exercise is a false path, so the engine should require a conflict context. Hypothesis only.',
  }),
  hypothesis({
    id: 'heatwave-grid-failure',
    trigger_type: 'heatwave',
    effect_type: 'power_grid_failure',
    lag_min_days: 0,
    lag_max_days: 5,
    conditions: { requires_fragility: ['power_plant'], min_population: 100000 },
    mechanism:
      'Extreme heat raises cooling and air-conditioning load while thermal plants and transmission lines are less efficient. A strained grid can shed load or fail during the heatwave, especially in a large city. No checked source is attached; WHO heat guidance covers health, not grid failure.',
  }),
  hypothesis({
    id: 'eruption-ash-aviation',
    trigger_type: 'volcanic_eruption',
    effect_type: 'aviation_disruption',
    lag_min_days: 0,
    lag_max_days: 7,
    conditions: {},
    mechanism:
      'Ash in the flight levels closes airspace and airports downwind the same day, and the disruption can last through the following week if the plume persists. This seed does not cite a checked aviation circular.',
  }),
  hypothesis({
    id: 'disaster-looting',
    trigger_type: 'disaster',
    effect_type: 'insecurity',
    lag_min_days: 0,
    lag_max_days: 7,
    conditions: { min_population: 50000 },
    mechanism:
      'After a large disaster, empty shops, absent police, and blocked roads can bring looting and local insecurity within the first week. It is not universal and should not fire on a small rural event. Hypothesis only.',
  }),
  hypothesis({
    id: 'currency-fuel-shortage',
    trigger_type: 'currency_collapse',
    effect_type: 'fuel_shortage',
    lag_min_days: 7,
    lag_max_days: 60,
    conditions: {},
    mechanism:
      'A collapsing currency makes imported fuel unaffordable or unpaid. Pumps run short over the following weeks, not the hour the exchange rate gaps. Hypothesis until a checked source is added.',
  }),
  hypothesis({
    id: 'fuel-shortage-unrest',
    trigger_type: 'fuel_shortage',
    effect_type: 'unrest',
    lag_min_days: 0,
    lag_max_days: 21,
    conditions: { min_population: 100000 },
    mechanism:
      'Queues, transport stoppages, and higher food costs from a fuel shortage can produce protests in large cities within three weeks. Smaller towns are a weaker signal. This seed treats the step as a hypothesis.',
  }),
  hypothesis({
    id: 'wildfire-debris-flow',
    trigger_type: 'wildfire',
    effect_type: 'debris_flow',
    lag_min_days: 0,
    lag_max_days: 60,
    conditions: { min_population: 1000 },
    mechanism:
      'A burned slope sheds water instead of absorbing it. The next heavy rain, which may be the same storm season and up to about two months later, can send a debris flow into the valley town. Hypothesis only.',
  }),
  hypothesis({
    id: 'conflict-dam-attack-flood',
    trigger_type: 'conflict',
    effect_type: 'downstream_flood',
    lag_min_days: 0,
    lag_max_days: 3,
    conditions: { requires_fragility: ['dam'] },
    mechanism:
      'Fighting around a large dam can breach it or force a sudden release. The water then floods the valley downstream within hours to a few days. A public page for the 2023 Kakhovka breach was not verified in this pass, so the pathway stays a hypothesis.',
  }),
  hypothesis({
    id: 'conflict-nuclear-radiological',
    trigger_type: 'nuclear_hazard',
    effect_type: 'radiological_risk',
    lag_min_days: 0,
    lag_max_days: 7,
    conditions: { requires_fragility: ['nuclear_plant'], requires_watchlist: true },
    mechanism:
      'A nuclear plant inside a conflict-watchlist country is a different object once an earthquake or a flood reaches it. Damage to cooling or to the grid can raise a radiological risk within the first week. No checked public source is attached.',
  }),
  hypothesis({
    id: 'conflict-response-failure-mortality',
    trigger_type: 'conflict',
    effect_type: 'higher_mortality',
    lag_min_days: 0,
    lag_max_days: 14,
    conditions: { min_population: 50000 },
    mechanism:
      'When responders cannot move, hospitals are hit, or roads are held, the same disaster kills more people than it would in a quiet region. The extra deaths show up over the first two weeks. Hypothesis until a checked source is added.',
  }),
  hypothesis({
    id: 'maritime-attack-fuel-unrest',
    trigger_type: 'maritime_attack',
    effect_type: 'unrest',
    lag_min_days: 7,
    lag_max_days: 60,
    conditions: { min_population: 100000 },
    mechanism:
      'Attacks on shipping divert tankers and grain ships. Fuel and food prices rise in the importing cities over the following weeks, and protests can follow. There is no maritime component yet, so this seed does not fire. Hypothesis only.',
  }),
  hypothesis({
    id: 'disaster-armed-group',
    trigger_type: 'disaster',
    effect_type: 'armed_group_opportunity',
    lag_min_days: 0,
    lag_max_days: 14,
    conditions: { min_population: 50000 },
    mechanism:
      'A disaster that empties police posts and blocks roads can give an armed group room to move, tax aid, or take a town during the first two weeks. It is not automatic. Hypothesis only.',
  }),
  hypothesis({
    id: 'rain-malaria-lag',
    trigger_type: 'vector_disease',
    effect_type: 'malaria',
    lag_min_days: 28,
    lag_max_days: 56,
    conditions: {},
    mechanism:
      'Standing water after heavy rain gives Anopheles mosquitoes a breeding window. Malaria cases, where the parasite is already present, tend to rise about four to eight weeks later. The day window is an operational bound. No checked source is attached, so this stays a hypothesis.',
  }),
  hypothesis({
    id: 'rain-dengue-lag',
    trigger_type: 'vector_disease',
    effect_type: 'dengue',
    lag_min_days: 21,
    lag_max_days: 56,
    conditions: {},
    mechanism:
      'Containers and puddles filled by rain breed Aedes mosquitoes. Dengue, where the virus already circulates, can rise about three to eight weeks later. The day window is an operational bound. No checked source is attached, so this stays a hypothesis.',
  }),
]

export function cascadeCounts(rows: CascadeSeed[] = CASCADE_SEEDS): { sourced: number; hypothesis: number; total: number } {
  const sourced = rows.filter((row) => row.evidence_level === 'sourced').length
  return { sourced, hypothesis: rows.length - sourced, total: rows.length }
}
