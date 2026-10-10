import { describe, expect, it } from 'vitest'
import { hazardIconKind, hazardIconsFor } from '../hazards'
import { severityColor, severityTheme } from '../severity'

describe('severity theme', () => {
  it('uses red pulse for stage 5, orange 4, amber 3, calm colors for 1-2', () => {
    expect(severityTheme(5)).toMatchObject({ color: '#fb7185', pulseBorder: true, compact: false })
    expect(severityTheme(4)).toMatchObject({ color: '#fb923c', pulseBorder: false })
    expect(severityTheme(3)).toMatchObject({ color: '#fbbf24', pulseBorder: false })
    expect(severityTheme(2).compact).toBe(true)
    expect(severityTheme(1).compact).toBe(true)
    expect(severityColor(1)).toBe('#34d399')
    expect(severityColor(2)).toBe('#38bdf8')
  })
})

describe('hazard icons', () => {
  it('maps rain, river, dam, disease, conflict, fire, quake', () => {
    expect(hazardIconKind('rain')).toBe('rain')
    expect(hazardIconKind('flood')).toBe('river')
    expect(hazardIconKind('dam')).toBe('dam')
    expect(hazardIconKind('cholera')).toBe('disease')
    expect(hazardIconKind('conflict')).toBe('conflict')
    expect(hazardIconKind('wildfire')).toBe('fire')
    expect(hazardIconKind('earthquake')).toBe('quake')
    expect(hazardIconsFor(['rain', 'dam', 'rain'])).toEqual(['rain', 'dam'])
  })
})
