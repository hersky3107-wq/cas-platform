import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { specFromComputation } from '@/app/modes/oracle/talisman-preview/from-computation'
import { computeTalisman, talismanFromStoredSession } from '@/lib/oracle/talisman'
import { EMPTY_CHARTS, LIVE_ACCESS, fakeConsensus } from './fixture'

const colors = { impulse: 'crimson', need: 'indigo', identity: 'gold' }

describe('talisman prism colour read path', () => {
  it('stores impulse, need, and identity on the computation and the spec', () => {
    const direct = computeTalisman({
      access: LIVE_ACCESS,
      charts: EMPTY_CHARTS,
      consensus: fakeConsensus({}),
      prismColors: colors,
    })
    expect(direct?.prismColors).toEqual(colors)

    const stored = talismanFromStoredSession({
      session: {
        status: 'done',
        prompt_version: 'layer1-v4',
        session_inputs: { prism: { ...colors, microCheck: [1, 2, 3, 4] } },
      },
      computations: [],
      deficiency: { wood: 0, fire: 0, earth: 0, metal: 0, water: 0 },
    })
    expect(stored.computation?.prismColors).toEqual(colors)
    const spec = specFromComputation(stored.computation!, stored.charts, {
      sessionId: 's',
      dateLabel: '2026.09.26',
    })
    expect(spec.prismColors).toEqual(colors)
    expect(spec.prismColors).not.toHaveProperty('microCheck')
  })

  it('leaves the spec field null when the session has no prism input', () => {
    const stored = talismanFromStoredSession({
      session: { status: 'done', prompt_version: 'layer1-v4', session_inputs: null },
      computations: [],
      deficiency: { wood: 1 },
    })
    expect(stored.computation?.prismColors).toBeNull()
    const spec = specFromComputation(stored.computation!, stored.charts, {
      sessionId: 's',
      dateLabel: '2026.09.26',
    })
    expect(spec.prismColors).toBeNull()
  })

  it('maps colour ids through PRISM_COLOR_HEX and leaves a blank seat when they are missing', () => {
    const svg = readFileSync('app/modes/oracle/talisman-preview/TalismanSvg.tsx', 'utf8')
    expect(svg).toContain('PRISM_COLOR_HEX')
    expect(svg).not.toContain('#6b5b8c')
  })

  it('does not hand the colour ids to an AI payload builder', () => {
    const route = readFileSync('app/api/oracle/session/[id]/talisman/route.ts', 'utf8')
    const preview = readFileSync('app/modes/oracle/talisman-preview/preview-session.ts', 'utf8')
    expect(route).not.toMatch(/buildReadingPayload|buildSynthesisPayload|buildVerdictPayload|aiPayload/)
    expect(preview).not.toMatch(/buildReadingPayload|buildSynthesisPayload|buildVerdictPayload|aiPayload/)
  })
})
