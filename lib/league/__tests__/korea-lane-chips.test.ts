import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KR_GROUPS } from '../korea-equity-catalog'
import { KoreaStockLane } from '@/components/league/PublicLeagueHub'
import { KrUniverseChipBrowser } from '@/components/league/KrUniverseChipBrowser'

const browserSrc = readFileSync(
  join(process.cwd(), 'components', 'league', 'KrUniverseChipBrowser.tsx'),
  'utf8',
)
const hubSrc = readFileSync(
  join(process.cwd(), 'components', 'league', 'PublicLeagueHub.tsx'),
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
