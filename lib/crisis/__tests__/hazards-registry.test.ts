import { describe, expect, it } from 'vitest'
import {
  HAZARD_KINDS,
  HAZARD_REGISTRY,
  SCORE_TRIGGER_TO_KIND,
  hazardKindForScoreTrigger,
} from '../hazards'
import { HAZARD_UI_KO } from '../i18n/hazards'
import { enrichTriggerComponents, expectedWindowForComponent } from '../score/trigger-meta'
import { rainComponent } from '../score/trigger'

describe('hazard registry', () => {
  it('registers every listed kind with group and band', () => {
    expect(HAZARD_KINDS.length).toBe(28)
    for (const key of HAZARD_KINDS) {
      expect(HAZARD_REGISTRY[key].key).toBe(key)
      expect(HAZARD_REGISTRY[key].group.length).toBeGreaterThan(0)
      expect(HAZARD_REGISTRY[key].leadTimeBand.length).toBeGreaterThan(0)
    }
  })

  it('maps score triggers to registry kinds', () => {
    expect(SCORE_TRIGGER_TO_KIND.rain).toBe('flood_rain')
    expect(hazardKindForScoreTrigger('slow_burn')).toBe('gradual_worsening')
    expect(hazardKindForScoreTrigger('gdacs', { event_type: 'EQ' })).toBe('earthquake')
    expect(HAZARD_UI_KO.triggerLabel('slow_burn')).toBe('서서히 악화')
    expect(HAZARD_UI_KO.triggerChipLine('rain', { type: 'relative_days', min: 3, max: 5 })).toBe('폭우 · 3~5일 뒤')
  })

  it('computes rain peak day windows when enriching components', () => {
    const precip = [10, 20, 30, 80, 40, 10, 5]
    const rain = rainComponent(precip)
    const [enriched] = enrichTriggerComponents([rain], {
      now: new Date('2026-10-10T12:00:00.000Z'),
      lat: 0,
      lon: 0,
      precip,
      discharge: null,
      cycloneTracks: [],
    })
    expect(enriched.raw.hazard_kind).toBe('flood_rain')
    expect(enriched.raw.expected_window).toEqual({ type: 'relative_days', min: 3, max: 5 })
    expect(expectedWindowForComponent(rain, 'flood_rain', {
      now: new Date(),
      lat: 0,
      lon: 0,
      precip,
      discharge: null,
      cycloneTracks: [],
    })).toEqual({ type: 'relative_days', min: 3, max: 5 })
  })
})
