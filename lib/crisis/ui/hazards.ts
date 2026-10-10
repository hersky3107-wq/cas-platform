export type HazardIconKind = 'rain' | 'river' | 'dam' | 'disease' | 'conflict' | 'fire' | 'quake'

const ICON_BY_TOKEN: Record<string, HazardIconKind> = {
  rain: 'rain',
  flood: 'river',
  river: 'river',
  storm_surge: 'river',
  cyclone: 'rain',
  drought: 'rain',
  dam: 'dam',
  reservoir: 'dam',
  disease: 'disease',
  cholera: 'disease',
  dengue: 'disease',
  malaria: 'disease',
  leptospirosis: 'disease',
  mpox: 'disease',
  measles: 'disease',
  outbreak: 'disease',
  conflict: 'conflict',
  unrest: 'conflict',
  war: 'conflict',
  fire: 'fire',
  wildfire: 'fire',
  heat: 'fire',
  earthquake: 'quake',
  quake: 'quake',
  volcano: 'quake',
  tsunami: 'quake',
  landslide: 'quake',
}

export function hazardIconKind(token: string | null | undefined): HazardIconKind | null {
  if (!token) return null
  const key = token.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (ICON_BY_TOKEN[key]) return ICON_BY_TOKEN[key]
  if (/rain|storm|cyclone|typhoon|hurricane|precip/.test(key)) return 'rain'
  if (/flood|river|surge|inundat/.test(key)) return 'river'
  if (/dam|reservoir|levee|spillway/.test(key)) return 'dam'
  if (/disease|cholera|dengue|malaria|outbreak|virus|epidemic/.test(key)) return 'disease'
  if (/conflict|war|unrest|attack|violence|clash/.test(key)) return 'conflict'
  if (/fire|wildfire|burn|heat/.test(key)) return 'fire'
  if (/quake|seismic|volcan|tsunami|landslide/.test(key)) return 'quake'
  return null
}

export function hazardIconsFor(tokens: Array<string | null | undefined>): HazardIconKind[] {
  const seen = new Set<HazardIconKind>()
  const out: HazardIconKind[] = []
  for (const token of tokens) {
    const kind = hazardIconKind(token)
    if (!kind || seen.has(kind)) continue
    seen.add(kind)
    out.push(kind)
  }
  return out
}
