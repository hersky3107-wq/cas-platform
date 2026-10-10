import { describe, expect, it } from 'vitest'
import { worldCountryPaths, type WorldTopology } from '../world-paths'

describe('world country paths', () => {
  it('projects a tiny topology into SVG path commands', () => {
    const topo: WorldTopology = {
      type: 'Topology',
      transform: { scale: [1, 1], translate: [0, 0] },
      arcs: [
        [
          [0, 0],
          [10, 0],
          [0, 10],
          [-10, -10],
        ],
      ],
      objects: {
        countries: {
          type: 'GeometryCollection',
          geometries: [{ type: 'Polygon', arcs: [[0]] }],
        },
      },
    }
    const paths = worldCountryPaths(topo, 360, 180)
    expect(paths).toHaveLength(1)
    expect(paths[0]).toMatch(/^M/)
    expect(paths[0]).toMatch(/Z$/)
  })
})
