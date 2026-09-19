import { describe, expect, it } from 'vitest'
import {
  CATEGORY_TO_LIUQIN,
  CATEGORY_TO_TAEIL_YONGSHEN,
  assertCategoryTablesComplete,
  taeilYongshenForCategory,
} from '../category-tables'
import { LEAGUE_ORACLE_CATEGORY_IDS } from '../types'

describe('two separate category tables', () => {
  it('covers all 12 public chips and does not overload one map', () => {
    expect(LEAGUE_ORACLE_CATEGORY_IDS).toHaveLength(12)
    expect(Object.keys(CATEGORY_TO_LIUQIN).sort()).toEqual([...LEAGUE_ORACLE_CATEGORY_IDS].sort())
    expect(Object.keys(CATEGORY_TO_TAEIL_YONGSHEN).sort()).toEqual([...LEAGUE_ORACLE_CATEGORY_IDS].sort())
    assertCategoryTablesComplete()
  })

  it('육친 mapping is the classical topic list', () => {
    expect(CATEGORY_TO_LIUQIN.stocks).toBe('妻财')
    expect(CATEGORY_TO_LIUQIN.crypto).toBe('妻财')
    expect(CATEGORY_TO_LIUQIN.sports).toBe('官鬼')
    expect(CATEGORY_TO_LIUQIN.politics_election).toBe('官鬼')
    expect(CATEGORY_TO_LIUQIN.real_estate).toBe('父母')
    expect(CATEGORY_TO_LIUQIN.macro_econ).toBe('父母')
    expect(CATEGORY_TO_LIUQIN.entertainment).toBe('子孙')
    expect(Object.values(CATEGORY_TO_LIUQIN).includes('兄弟')).toBe(false)
  })

  it('택일 buckets are the 10 천간 cells; yinYang is display-only identity', () => {
    expect(taeilYongshenForCategory('stocks')).toEqual({ element: 'metal', yinYang: 'yang', stemHanja: '庚' })
    expect(taeilYongshenForCategory('gold_metals').stemHanja).toBe('庚')
    expect(taeilYongshenForCategory('index_etf').stemHanja).toBe('戊')
    expect(taeilYongshenForCategory('macro_econ').stemHanja).toBe('戊')
    expect(taeilYongshenForCategory('entertainment').stemHanja).toBe('乙')
    const stems = new Set(LEAGUE_ORACLE_CATEGORY_IDS.map((id) => taeilYongshenForCategory(id).stemHanja))
    expect(stems).toEqual(new Set(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']))
  })
})
