import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { natalChart } from '../../engines/astro'
import { extractNativeFindings } from '../native'
import { independenceCensus, TALISMAN_LAYER_KIND } from '../types'
import { SYSTEM_IDS } from '../../axes/types'
import { charts1988, EMPTY_CHARTS } from './fixture'
import { ORACLE_DEFAULT_COORDS } from '../../runner/conventions'

describe('independence census', () => {
  it('counts 8 native findings and 4 form-only across the twelve systems', () => {
    const census = independenceCensus()
    expect(census.native + census.formOnly).toBe(12)
    expect(census.native).toBe(8)
    expect(census.formOnly).toBe(4)
    expect(census.nativeIds).toEqual(['saju', 'astro', 'prism', 'ziwei', 'name', 'iching', 'tarot', 'ninestar'])
    expect(census.formOnlyIds).toEqual(['numerology', 'runes', 'sukuyou', 'tzolkin'])
    expect(SYSTEM_IDS.every((id) => TALISMAN_LAYER_KIND[id] != null)).toBe(true)
  })
})

describe('extractNativeFindings', () => {
  it('never imports the axis layer or consensus.elements', () => {
    const src = readFileSync(path.join(process.cwd(), 'lib/oracle/talisman/native.ts'), 'utf8')
    expect(src).not.toMatch(/from ['"]\.\.\/axes/)
    expect(src).not.toContain('consensus.elements')
    expect(src).not.toMatch(/from ['"].*\/axes\//)
    expect(extractNativeFindings.length).toBe(1)
  })

  it('marks 수비/숙요/촐킨/룬 as form-only even when a rune draw exists', () => {
    const findings = extractNativeFindings(charts1988())
    expect(findings.numerology.kind).toBe('form-only')
    expect(findings.sukuyou.kind).toBe('form-only')
    expect(findings.tzolkin.kind).toBe('form-only')
    expect(findings.runes.kind).toBe('form-only')
    expect(findings.runes.reason).toContain('형태만')
  })

  it('reports 육효 복장, 사주 십신 zeros + gisin, PRISM warningDomain, 구성 흉방/길방', () => {
    const findings = extractNativeFindings(charts1988())
    expect(findings.iching?.hiddenRelatives).toEqual(charts1988().iching?.hiddenRelatives)
    expect(findings.saju?.gisin).toBe('water')
    expect(findings.saju?.groupCounts.비겁).toBeGreaterThanOrEqual(0)
    expect(findings.prism?.warningDomain).toBeTruthy()
    expect(findings.ninestar?.killings.some((k) => k.name === '오황살' && k.direction === 'west')).toBe(true)
    expect(findings.ninestar?.gilbang).toBeDefined()
  })

  it('lists 자미 空宮 (no 主星), 살성 palaces, and 化忌 palace', () => {
    const findings = extractNativeFindings(charts1988())
    expect(findings.ziwei?.palacesUnavailable).toBe(false)
    expect(findings.ziwei?.palaces).toHaveLength(12)
    expect(findings.ziwei?.emptyPalaces.every((p) => typeof p.name === 'string')).toBe(true)
    expect(findings.ziwei?.maleficPalaces.length).toBeGreaterThan(0)
    expect(findings.ziwei?.huaJiPalace?.star).toBeTruthy()
  })

  it('lists 점성 empty classical elements and missing houses when untimed', () => {
    const untimed = natalChart({
      date: '1988-03-15',
      time: null,
      tz: 'Asia/Seoul',
      lat: ORACLE_DEFAULT_COORDS.lat,
      lng: ORACLE_DEFAULT_COORDS.lng,
      timeKnown: false,
    })
    const findings = extractNativeFindings({ ...EMPTY_CHARTS, astro: untimed })
    expect(findings.astro?.housesMissing).toBe(true)
    expect(findings.astro?.emptyElements.every((el) => ['fire', 'earth', 'air', 'water'].includes(el))).toBe(true)
  })

  it('lists 타로 missing suits and reversed cards; 성명 흉/대흉 from SURI81', () => {
    const findings = extractNativeFindings(charts1988())
    expect(findings.tarot?.missingSuits).toBeDefined()
    expect(Array.isArray(findings.tarot?.reversed)).toBe(true)
    expect(findings.name?.supported).toBe(true)
    for (const hit of [...(findings.name?.hyung ?? []), ...(findings.name?.daehyung ?? [])]) {
      expect(['흉', '대흉']).toContain(hit.label)
    }
  })

  it('returns null native slots when that chart is absent', () => {
    const findings = extractNativeFindings(EMPTY_CHARTS)
    expect(findings.saju).toBeNull()
    expect(findings.ziwei).toBeNull()
    expect(findings.ninestar).toBeNull()
    expect(findings.runes.kind).toBe('form-only')
  })
})
