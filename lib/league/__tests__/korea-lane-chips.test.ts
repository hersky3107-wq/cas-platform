import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KR_GROUPS } from '../korea-equity-catalog'
import { KoreaStockLane } from '@/components/league/PublicLeagueHub'
import { KrUniverseChipBrowser, hotStripFromRows, type KrUniverseRow } from '@/components/league/KrUniverseChipBrowser'

const browserSrc = readFileSync(
  join(process.cwd(), 'components', 'league', 'KrUniverseChipBrowser.tsx'),
  'utf8',
)
const hubSrc = readFileSync(
  join(process.cwd(), 'components', 'league', 'PublicLeagueHub.tsx'),
  'utf8',
)
const visualsSrc = readFileSync(
  join(process.cwd(), 'components', 'league', 'KrGroupVisuals.tsx'),
  'utf8',
)

describe('Korean-lane chip browser (UI contract)', () => {
  it('has three tabs (코스피/코스닥/미국) and fetches only the active tab', () => {
    expect(browserSrc).toContain("KOSPI: '코스피'")
    expect(browserSrc).toContain("KOSDAQ: '코스닥'")
    expect(browserSrc).toContain("US: '미국'")
    // One fetch, keyed on the active tab state
    expect(browserSrc).toContain('/api/league/kr-universe?market=${tab}')
    expect(browserSrc).toMatch(/useEffect\([\s\S]*?\}, \[tab\]\)/)
  })

  it('renders a "전체" filter chip plus group labels in KR_GROUPS order', () => {
    expect(browserSrc).toContain('전체')
    expect(browserSrc).toContain('KR_GROUPS.filter')
    // Sanity: the catalog order the chips follow
    expect(KR_GROUPS[0]!.id).toBe('semis')
    expect(KR_GROUPS[KR_GROUPS.length - 1]!.id).toBe('other')
    expect(KR_GROUPS.length).toBe(14)
  })

  it('group filter narrows sections to the selected group only', () => {
    expect(browserSrc).toContain(
      'groupsPresent.filter((g) => groupFilter === ALL_GROUPS || groupFilter === g.id)',
    )
    // Sections are keyed by group and chips within a section come from that group
    expect(browserSrc).toContain('data-kr-group={group.id}')
    expect(browserSrc).toContain(".filter((row) => (row.groupId ?? 'other') === group.id)")
  })

  it('renders no <input> or <textarea> anywhere in the Korean lane', () => {
    expect(browserSrc).not.toMatch(/<(input|textarea|select)[\s>]/i)
    expect(visualsSrc).not.toMatch(/<(input|textarea|select)[\s>]/i)
    expect(hubSrc).not.toMatch(/<(input|textarea)[\s>]/i)
    const html = renderToStaticMarkup(createElement(KoreaStockLane))
    expect(html).not.toMatch(/<(input|textarea)[\s>]/i)
    const browserHtml = renderToStaticMarkup(
      createElement(KrUniverseChipBrowser, { onSelectUsInstrument: () => {} }),
    )
    expect(browserHtml).not.toMatch(/<(input|textarea)[\s>]/i)
  })

  it('US chip selection shows the world-lane horizon row and hands the STOCK instrument to the card flow', () => {
    expect(browserSrc).toContain("selected?.market === 'US'")
    expect(browserSrc).toContain('UI_HORIZONS.map')
    expect(browserSrc).toContain('t.catalog.horizons[h]')
    expect(browserSrc).toContain('onSelectUsInstrument(row.instrument, horizon)')
    // Hub wires the callback into the same loadCard flow the world lane uses
    expect(hubSrc).toContain('void loadCard(instrument, nextHorizon)')
    expect(hubSrc).toContain("selectedInstrument.startsWith('STOCK:')")
  })

  it('KR chip selection shows the 준비 중 notice and never calls generate', () => {
    expect(browserSrc).toContain('국내 종목 예측은 준비 중입니다.')
    expect(browserSrc).toContain('data-testid="kr-chip-pending"')
    // The browser never posts to generate itself
    expect(browserSrc).not.toContain('/api/league/generate')
    expect(browserSrc).not.toContain('/api/league/card')
    // The notice only renders for non-US selections; horizon row only for US
    expect(browserSrc).toContain("selected && selected.market !== 'US'")
  })

  it('keeps the disclosure banner first and the footer last, with loading skeletons and Korean empty/error text', () => {
    const html = renderToStaticMarkup(createElement(KoreaStockLane))
    const bannerIdx = html.indexOf('kr-lane-banner')
    const browserIdx = html.indexOf('kr-universe-browser')
    const footerIdx = html.indexOf('kr-lane-footer')
    expect(bannerIdx).toBeGreaterThanOrEqual(0)
    expect(browserIdx).toBeGreaterThan(bannerIdx)
    expect(footerIdx).toBeGreaterThan(browserIdx)
    expect(html).toContain('신고 절차를 진행 중')
    expect(html).toContain('상호 PRAY · 대표 허민재')
    expect(html).not.toMatch(/\{[A-Z0-9_]+\}/)

    expect(browserSrc).toContain('kr-chip-skeleton')
    expect(browserSrc).toContain('표시할 종목이 없습니다.')
    expect(browserSrc).toContain('종목을 불러오지 못했습니다.')
  })
})

describe('Korean-lane chip browser (redesign)', () => {
  it('hot strip uses global popularityRank (nulls last), not first rows in server order', () => {
    expect(browserSrc).toContain('hotStripFromRows(rows)')
    expect(browserSrc).toContain('showHotStrip')
    expect(browserSrc).toContain('tab !== \'US\'')
    expect(browserSrc).toContain('HOT_STRIP_COUNT = 12')
    expect(browserSrc).not.toContain('rows.slice(0, HOT_STRIP_COUNT)')
    expect(browserSrc).not.toMatch(/>\s*\{[^}]*popularityRank[^}]*\}\s*</)
    expect(browserSrc).not.toContain('순위')

    // Mixed groups in server (group-first) order — strip picks 12 lowest ranks globally
    const fixture: KrUniverseRow[] = []
    for (let g = 0; g < 3; g++) {
      for (let r = 1; r <= 8; r++) {
        fixture.push({
          market: 'KOSPI',
          code: `G${g}-R${r}`,
          name: `종목 ${g}-${r}`,
          groupId: g === 0 ? 'semis' : g === 1 ? 'battery' : 'finance',
          popularityRank: g * 10 + r,
          instrument: `KRSTOCK:KOSPI:G${g}R${r}`,
        })
      }
    }
    const strip = hotStripFromRows(fixture)
    expect(strip).toHaveLength(12)
    const ranks = strip.map((row) => row.popularityRank)
    expect(ranks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14])
    expect(new Set(strip.map((row) => row.groupId)).size).toBeGreaterThan(1)
  })

  it('미국 tab does not render the hot strip', () => {
    expect(browserSrc).toContain('const showHotStrip = loaded && tab !== \'US\'')
    const usBlock = browserSrc.slice(browserSrc.indexOf('loaded && tab === \'US\''))
    expect(usBlock).not.toContain('kr-hot-strip')
    expect(browserSrc).toMatch(/showHotStrip \? \([\s\S]*?data-testid="kr-hot-strip"/)
  })

  it('group filter row hides the native scrollbar and uses overflow edge fades', () => {
    expect(browserSrc).toContain('kr-group-filter-scroll')
    expect(browserSrc).toContain('[scrollbar-width:none]')
    expect(browserSrc).toContain('[&::-webkit-scrollbar]:hidden')
    expect(browserSrc).toContain('bg-gradient-to-r')
    expect(browserSrc).toContain('bg-gradient-to-l')
    const filterBlock = browserSrc.slice(
      browserSrc.indexOf('function GroupFilterScrollRow'),
      browserSrc.indexOf('function SkeletonBrowser'),
    )
    expect(filterBlock).toContain('flex flex-nowrap')
    expect(filterBlock).not.toContain('flex-wrap')
  })

  it('group sections show 8 chips then expand via "더보기 (+N)"; active filter expands fully', () => {
    expect(browserSrc).toContain('GROUP_PREVIEW_COUNT = 8')
    expect(browserSrc).toContain('groupRows.slice(0, GROUP_PREVIEW_COUNT)')
    expect(browserSrc).toContain('더보기 (+{hiddenCount})')
    expect(browserSrc).toContain('groupFilter === group.id || expandedGroups.has(group.id)')
    expect(browserSrc).toContain('expandGroup')
  })

  it('group filter row is a single horizontally scrollable row that never wraps', () => {
    expect(browserSrc).toContain('data-testid="kr-group-filter-scroll"')
    const filterBlock = browserSrc.slice(
      browserSrc.indexOf('function GroupFilterScrollRow'),
      browserSrc.indexOf('function SkeletonBrowser'),
    )
    expect(filterBlock).toContain('flex flex-nowrap')
    expect(filterBlock).not.toContain('flex-wrap')
  })

  it('defines a fixed color + inline SVG icon per group for all 14 groups', () => {
    for (const g of KR_GROUPS) {
      expect(visualsSrc).toContain(`${g.id}:`)
    }
    expect(visualsSrc).toContain('Record<KrGroupId, KrGroupVisual>')
    expect(visualsSrc).toContain('<svg')
    // No emoji or external image assets
    expect(visualsSrc).not.toMatch(/<img/i)
    expect(visualsSrc).not.toMatch(/[←-⇿⌀-➿⬀-⯿️]/u)
  })

  it('market tabs are a sticky segmented control with per-market accents', () => {
    expect(browserSrc).toContain('sticky top-0')
    expect(browserSrc).toContain('role="tablist"')
    expect(browserSrc).toContain('bg-blue-700')
    expect(browserSrc).toContain('bg-violet-700')
    expect(browserSrc).toContain('bg-emerald-700')
  })

  it('uses a uniform responsive grid and fixed-height truncated chips with title attributes', () => {
    expect(browserSrc).toContain('grid grid-cols-2')
    expect(browserSrc).toContain('md:grid-cols-4')
    expect(browserSrc).toContain('lg:grid-cols-6')
    expect(browserSrc).toContain('title={name}')
    expect(browserSrc).toContain('truncate')
    expect(browserSrc).toContain('h-[44px]')
  })

  it('US chips show a circular monogram + Korean name + muted ticker, no logos', () => {
    expect(browserSrc).toContain('tickerMonogram')
    expect(browserSrc).toContain('rounded-full bg-emerald-100')
    expect(browserSrc).not.toMatch(/<img/i)
  })

  it('chips are buttons with aria-pressed; selected state uses ring + tint, not color alone', () => {
    expect(browserSrc).toContain('aria-pressed={selected}')
    expect(browserSrc).toContain('ring-2')
    // Selected chips also carry a check glyph (non-color signal)
    expect(browserSrc).toContain('M2 6.5 4.8 9.3 10 3.5')
  })

  it('skeleton mirrors the loaded grid to avoid layout shift', () => {
    const skeletonBlock = browserSrc.slice(
      browserSrc.indexOf('function SkeletonBrowser'),
      browserSrc.indexOf('/**', browserSrc.indexOf('function SkeletonBrowser')),
    )
    expect(skeletonBlock).toContain('GRID_CLASS')
    expect(skeletonBlock).toContain('h-[44px]')
    expect(skeletonBlock).toContain('h-[52px]')
  })
})
