import { projectLonLat } from '../admin/geo'

type TopoArc = Array<[number, number]>

export type WorldTopology = {
  type: 'Topology'
  transform?: { scale: [number, number]; translate: [number, number] }
  arcs: TopoArc[]
  objects: {
    countries: {
      type: 'GeometryCollection'
      geometries: Array<{
        type: string
        arcs?: unknown
      }>
    }
  }
}

function decodeArc(arcs: TopoArc[], index: number, transform?: WorldTopology['transform']): Array<[number, number]> {
  const reverse = index < 0
  const arc = arcs[reverse ? ~index : index] ?? []
  let x = 0
  let y = 0
  const pts: Array<[number, number]> = []
  for (const [dx, dy] of arc) {
    x += dx
    y += dy
    const lon = transform ? x * transform.scale[0] + transform.translate[0] : x
    const lat = transform ? y * transform.scale[1] + transform.translate[1] : y
    pts.push([lon, lat])
  }
  return reverse ? pts.reverse() : pts
}

function flattenRings(arcs: unknown, all: TopoArc[], transform?: WorldTopology['transform']): Array<Array<[number, number]>> {
  if (!Array.isArray(arcs) || arcs.length === 0) return []
  if (typeof arcs[0] === 'number') {
    const ring: Array<[number, number]> = []
    for (const idx of arcs as number[]) {
      const pts = decodeArc(all, idx, transform)
      if (ring.length && pts.length) pts.shift()
      ring.push(...pts)
    }
    return [ring]
  }
  return (arcs as unknown[]).flatMap((part) => flattenRings(part, all, transform))
}

export function worldCountryPaths(topo: WorldTopology, width: number, height: number): string[] {
  const out: string[] = []
  for (const geom of topo.objects.countries.geometries) {
    if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') continue
    const rings = flattenRings(geom.arcs, topo.arcs, topo.transform)
    const d = rings
      .filter((ring) => ring.length >= 3)
      .map((ring) => {
        const cmds = ring.map((pt, i) => {
          const p = projectLonLat(pt[0], pt[1], width, height)
          return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`
        })
        return `${cmds.join('')}Z`
      })
      .join('')
    if (d) out.push(d)
  }
  return out
}
