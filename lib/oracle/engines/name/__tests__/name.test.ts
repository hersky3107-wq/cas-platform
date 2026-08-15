import { describe, expect, it } from 'vitest'
import {
  HANJA_STROKES,
  NAME_ENGINE_VERSION,
  NameInputError,
  RADICAL_RESTORATION,
  RADICAL_TEST_CASES,
  modernRadicalStrokes,
  nameReading,
  restoreRadicalStrokes,
} from '..'

describe('name engine version', () => {
  it('exports NAME_ENGINE_VERSION', () => {
    expect(NAME_ENGINE_VERSION).toBe('1.1.0')
  })
})

describe('determinism', () => {
  it('returns the identical result 1000 times for the same input', () => {
    const input = { surname: '金', givenName: '珍秀', locale: 'ja' } as const
    const first = nameReading(input)
    for (let i = 0; i < 1000; i++) {
      expect(nameReading(input)).toEqual(first)
    }
  })
})

describe('unsupported locales', () => {
  it('returns supported:false without throwing for English', () => {
    const result = nameReading({ surname: 'Smith', givenName: 'John', locale: 'en' })
    expect(result.supported).toBe(false)
    expect(result.limitations).toEqual(['use_numerology_instead'])
    expect(result.strokes).toEqual([])
    expect(result.gyeok).toBeNull()
    expect(result.strokeConvention).toBeNull()
    expect(result.alternate).toBeNull()
    expect(result.axes).toBeNull()
  })

  it('does not throw for arbitrary unknown locale tags', () => {
    expect(() => nameReading({ surname: 'X', givenName: 'Y', locale: 'fr' })).not.toThrow()
  })
})

describe('radical restoration', () => {
  it('counts every radical in the restoration list correctly (e.g. 洙 = 氵(4) + 朱(6) = 10, not 9)', () => {
    for (const testCase of RADICAL_TEST_CASES) {
      const modern = modernRadicalStrokes(testCase.radical, testCase.phoneticStrokes)
      const restored = restoreRadicalStrokes(testCase.radical, testCase.phoneticStrokes)
      expect(modern).toBe(testCase.expectedModern)
      expect(restored).toBe(testCase.expectedRestored)
      expect(restored).not.toBe(modern)
    }
  })

  it('matches the bundled HANJA_STROKES table for radical-affected characters present there', () => {
    const affectedAndBundled = RADICAL_TEST_CASES.filter((tc) => HANJA_STROKES[tc.char] !== undefined)
    expect(affectedAndBundled.length).toBeGreaterThan(0)
    for (const testCase of affectedAndBundled) {
      expect(HANJA_STROKES[testCase.char].kangxi).toBe(testCase.expectedRestored)
    }
  })

  it('stores both conventions and returns 郎 as kangxi 14 / modern 9', () => {
    expect(HANJA_STROKES.郎).toEqual({ kangxi: 14, modern: 9 })
    expect(nameReading({ surname: '山田', givenName: '太郎', locale: 'ja' }).strokes).toEqual([3, 5, 4, 14])
    expect(
      nameReading({ surname: '山田', givenName: '太郎', locale: 'ja', strokeConvention: 'modern' }).strokes,
    ).toEqual([3, 5, 4, 9])
  })

  it('covers all twelve radicals named in the spec exactly once', () => {
    const radicals = RADICAL_TEST_CASES.map((tc) => tc.radical)
    expect(new Set(radicals).size).toBe(12)
    expect(Object.keys(RADICAL_RESTORATION).length).toBe(12)
  })
})

describe('Korean name — 오격 matches a public hangul-stroke worked example', () => {
  // https://changebook.tistory.com/275 computes 김(5)/지(3)/수(4) via the
  // same additive Hangul jamo method used here, with 인격=8, 지격=7,
  // 외격=4, 총격=12 (their 천격 omits the single-character-surname +1
  // padding this engine applies per the task spec; see conventions.ts).
  it('matches 인격/지격/외격/총격 exactly, and documents the 천격 +1 divergence', () => {
    const result = nameReading({ surname: '김', givenName: '지수', locale: 'ko' })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.strokes).toEqual([5, 3, 4])
    expect(result.gyeok.in).toBe(8)
    expect(result.gyeok.ji).toBe(7)
    expect(result.gyeok.oe).toBe(4)
    expect(result.gyeok.chong).toBe(12)
    // This engine's documented convention: +1 for a single-character surname.
    expect(result.gyeok.cheon).toBe(6)
    expect(result.alternate).toBeNull()
  })
})

describe('Japanese stroke-convention switch', () => {
  // https://uracalc.com/seimei/ works "山田太郎" as 山(3)田(5)太(4)郎(9):
  // 天格8, 人格9, 地格13, 総格21, 外格12. This engine restores 郎's radical
  // (阝(右)→邑) per spec, giving 郎=14 instead of their modern-glyph 9, so
  // 天格/人格 (unaffected by 郎) match exactly, while 地格/総格/外格 differ
  // by precisely the +4 the restoration table assigns to 阝(right)→邑
  // (uracalc: 3+7 modern vs this engine's 7+7 restored for 邑, i.e. +4).
  it('defaults to kangxi and keeps the v1.0.0 山田太郎 reading unchanged', () => {
    const result = nameReading({ surname: '山田', givenName: '太郎', locale: 'ja' })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.strokeConvention).toBe('kangxi')
    expect(result.strokes).toEqual([3, 5, 4, 14])
    expect(result.gyeok.cheon).toBe(8)
    expect(result.gyeok.in).toBe(9)
    expect(result.gyeok.ji).toBe(18) // 4 + 14, vs uracalc's 13 (4 + modern 9)
    expect(result.gyeok.chong).toBe(26) // vs uracalc's 21
    expect(result.gyeok.oe).toBe(17) // 26 - 9, vs uracalc's 12
    expect(result.alternate?.strokeConvention).toBe('modern')
  })

  it('matches the public calculator under modern convention', () => {
    const result = nameReading({
      surname: '山田',
      givenName: '太郎',
      locale: 'ja',
      strokeConvention: 'modern',
    })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.strokeConvention).toBe('modern')
    expect(result.strokes).toEqual([3, 5, 4, 9])
    expect(result.gyeok).toEqual({ cheon: 8, in: 9, ji: 13, oe: 12, chong: 21 })
    expect(result.alternate?.strokeConvention).toBe('kangxi')
    expect(result.alternate?.gyeok).toEqual({ cheon: 8, in: 9, ji: 18, oe: 17, chong: 26 })
  })

  it('produces identical reading values when every character agrees', () => {
    const result = nameReading({ surname: '山田', givenName: '太', locale: 'ja' })
    expect(result.supported).toBe(true)
    if (!result.supported || !result.alternate) return
    expect(result.gyeok).toEqual(result.alternate.gyeok)
    expect(result.numerology81).toEqual(result.alternate.numerology81)
    expect(result.yinYang).toEqual(result.alternate.yinYang)
    expect(result.fiveElements).toEqual(result.alternate.fiveElements)
  })
})

describe('two-character surname (남궁, 선우, 諸葛)', () => {
  it('sums both surname characters for 天格 with no +1 padding', () => {
    const result = nameReading({ surname: '南宮', givenName: '美', locale: 'ja' })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    // 南(9) + 宮(10) = 19, no padding since the surname already has 2 chars.
    expect(result.gyeok.cheon).toBe(19)
    // 人格 = last surname char (宮=10) + first given char (美=9)
    expect(result.gyeok.in).toBe(19)
    expect(result.gyeok.ji).toBe(9)
    expect(result.gyeok.chong).toBe(28)
    expect(result.gyeok.oe).toBe(28 - 19)
  })
})

describe('one-character given name', () => {
  it('does not pad 地格 for a single given-name character', () => {
    const result = nameReading({ surname: '金', givenName: '美', locale: 'ja' })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.gyeok.ji).toBe(9) // 美 alone, no +1
    expect(result.gyeok.cheon).toBe(9) // 金(8) + 1, single-char surname
    expect(result.gyeok.in).toBe(8 + 9)
  })
})

describe('three-character given name', () => {
  it('sums all three given-name characters for 地格 and derives 外格 consistently', () => {
    const result = nameReading({ surname: '金', givenName: '美賢淑', locale: 'ja' })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    // 美(9) + 賢(15) + 淑(12)
    expect(result.gyeok.ji).toBe(9 + 15 + 12)
    expect(result.gyeok.in).toBe(8 + 9) // surname last + given first
    expect(result.gyeok.chong).toBe(8 + 9 + 15 + 12)
    expect(result.gyeok.oe).toBe(result.gyeok.chong - result.gyeok.in)
  })
})

describe('yin-yang and five-elements arrangement', () => {
  it('flags an all-odd (all-yang) name as unbalanced', () => {
    // 金(8, even)... pick strokes with a genuine all-odd case instead: 李(7)/一(1)/一(1)? one is enough.
    const result = nameReading({ surname: '李', givenName: '一', locale: 'ja' })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.strokes).toEqual([7, 1])
    expect(result.yinYang.pattern).toEqual(['yang', 'yang'])
    expect(result.yinYang.balanced).toBe(false)
  })

  it('flags a mixed-parity name as balanced', () => {
    const result = nameReading({ surname: '金', givenName: '美', locale: 'ja' })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    expect(result.strokes).toEqual([8, 9])
    expect(result.yinYang.pattern).toEqual(['yin', 'yang'])
    expect(result.yinYang.balanced).toBe(true)
  })

  it('computes five-elements from the last digit of each gyeok', () => {
    const result = nameReading({ surname: '金', givenName: '珍秀', locale: 'ja' })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    // cheon=9 -> water, in=18 -> metal, ji=17 -> metal
    expect(result.fiveElements.cheon).toBe('water')
    expect(result.fiveElements.in).toBe('metal')
    expect(result.fiveElements.ji).toBe('metal')
    expect(result.fiveElements.inJi).toBe('same')
  })
})

describe('numerology81 lookup', () => {
  it('attaches a 대길/길/평/흉/대흉 label with a short keyword to every gyeok', () => {
    const result = nameReading({ surname: '金', givenName: '珍秀', locale: 'ja' })
    expect(result.supported).toBe(true)
    if (!result.supported) return
    for (const entry of Object.values(result.numerology81)) {
      expect(['대길', '길', '평', '흉', '대흉']).toContain(entry.label)
      expect(entry.keyword.length).toBeGreaterThan(0)
      expect(entry.keyword.length).toBeLessThan(10)
    }
  })
})

describe('unknown hanja', () => {
  it('throws NameInputError rather than silently guessing a stroke count', () => {
    expect(() => nameReading({ surname: '金', givenName: '龘', locale: 'ja' })).toThrow(NameInputError)
  })
})

describe('invalid hangul', () => {
  it('throws NameInputError for a non-Hangul character under locale ko', () => {
    expect(() => nameReading({ surname: '金', givenName: '수', locale: 'ko' })).toThrow(NameInputError)
  })
})

describe('empty inputs', () => {
  it('throws for an empty surname', () => {
    expect(() => nameReading({ surname: '', givenName: '민준', locale: 'ko' })).toThrow(NameInputError)
  })

  it('throws for an empty given name', () => {
    expect(() => nameReading({ surname: '김', givenName: '', locale: 'ko' })).toThrow(NameInputError)
  })
})
