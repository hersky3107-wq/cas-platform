import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HubDoors } from '../../../components/league/HubDoors'
import { financeRoomLabels } from '../../../components/league/door-entry'
import { PublicLeagueHub } from '../../../components/league/PublicLeagueHub'
import { ADMIN_ONLY_PUBLIC_UI } from '../admin-only-ui'
import {
  chipsForDoor,
  doorForCategory,
  doorPath,
  redirectForCategorySearch,
  redirectForDoorSearch,
} from '../hub-doors'
import { parseMarkPrelaunchArgs } from '../mark-prelaunch-args'
import { getLeagueUiPack } from '../i18n/dictionary'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { leagueSurfaceCopy } from '../i18n/surface-copy'
import { excludeTestRounds } from '../public-track'
import { selectRecentPublicFreeformRounds } from '../freeform-recent'

const HUB = readFileSync(resolve('components/league/PublicLeagueHub.tsx'), 'utf8')
const LANDING = readFileSync(resolve('app/league/page.tsx'), 'utf8')
const FINANCE_PAGE = readFileSync(resolve('app/league/finance/page.tsx'), 'utf8')
const WORLD_PAGE = readFileSync(resolve('app/league/world/page.tsx'), 'utf8')
const CSS = readFileSync(resolve('app/globals.css'), 'utf8')
const LEADERBOARD = readFileSync(resolve('lib/league/leaderboard.ts'), 'utf8')
const RECORD_ROOM = readFileSync(resolve('lib/league/record-room.ts'), 'utf8')
const INSTRUMENTS = readFileSync(resolve('app/api/league/instruments/route.ts'), 'utf8')
const CARD = readFileSync(resolve('lib/league/card.ts'), 'utf8')
const CONSENSUS = readFileSync(resolve('lib/league/consensus-record-summary.ts'), 'utf8')
const PUBLIC_ACCESS = readFileSync(resolve('lib/league/public-access.ts'), 'utf8')
const GRADE = readFileSync(resolve('app/admin/league/grade/page.tsx'), 'utf8')
const ADMIN_LAYOUT = readFileSync(resolve('app/admin/layout.tsx'), 'utf8')

const WORLD_LEAKS = [
  '/league/world',
  'politics_election',
  '엔터테인먼트',
  '스포츠',
  '부동산',
  '테크·AI',
  '세상 예측',
  'The world',
  'Entertainment',
  'Sports',
  'Housing',
  'Politics',
]

describe('two-door landing', () => {
  it('renders only two doors and no chips, tabs, or recent lists', () => {
    const html = renderToStaticMarkup(createElement(HubDoors, { omitMemecoin: true }))
    expect(html).toContain('data-testid="league-landing"')
    expect(html).toContain('data-testid="door-finance"')
    expect(html).toContain('data-testid="door-world"')
    expect(html).toContain(leagueSurfaceCopy('en').doors.enter)
    expect(html).toContain(leagueSurfaceCopy('en').doors.financeTitle)
    expect(html).toContain(leagueSurfaceCopy('en').doors.worldTitle)
    expect(html).toContain('/league/finance')
    expect(html).toContain('/league/world')
    expect(html).not.toContain('data-testid="door-chips"')
    expect(html).not.toContain(getLeagueUiPack('en').hub.tabs.leaderboard)
    expect(html).not.toContain(getLeagueUiPack('en').hub.tabs.recordRoom)
    expect(html).not.toContain(getLeagueUiPack('en').catalog.recentQuestions)
    expect(html).not.toContain(getLeagueUiPack('ko').hub.tabs.leaderboard)
    expect(html).not.toContain(getLeagueUiPack('ko').hub.tabs.recordRoom)
    expect(html).not.toContain('data-testid="door-show-all"')
    expect(LANDING).toContain('<HubDoors')
    expect(LANDING).toContain('redirectForCategorySearch')
  })

  it('omits 밈코인 on the Korean finance door and keeps the list otherwise', () => {
    expect(financeRoomLabels(leagueSurfaceCopy('ko').doors, false)).toContain('밈코인')
    expect(financeRoomLabels(leagueSurfaceCopy('ko').doors, true)).not.toContain('밈코인')
    const hidden = renderToStaticMarkup(createElement(HubDoors, { omitMemecoin: true }))
    const finance = hidden.split('data-testid="door-world"')[0] ?? ''
    expect(finance).toContain('Stocks')
    expect(finance).toContain('Commodities')
    expect(finance).not.toContain('Memecoins')
    expect(finance).not.toContain('밈코인')
    const shown = renderToStaticMarkup(createElement(HubDoors, { omitMemecoin: false }))
    expect(shown.split('data-testid="door-world"')[0]).toContain('Memecoins')
  })

  it('sends ?cat= to the matching door URL', () => {
    expect(redirectForCategorySearch('?cat=sports')).toBe('/league/world?cat=sports')
    expect(redirectForCategorySearch('?cat=stocks')).toBe('/league/finance?cat=stocks')
    expect(redirectForDoorSearch('finance', '?cat=sports')).toBe('/league/world?cat=sports')
    expect(redirectForDoorSearch('finance', '?cat=stocks')).toBeNull()
    expect(doorPath('finance')).toBe('/league/finance')
    expect(doorForCategory('tech')).toBe('world')
  })
})

describe('door pages', () => {
  it('each door page mounts the hub with that door only', () => {
    expect(FINANCE_PAGE).toContain('door="finance"')
    expect(WORLD_PAGE).toContain('door="world"')
    expect(HUB).toContain('data-testid={`league-door-${door}`}')
    expect(HUB).toContain('data-testid="door-back"')
    expect(HUB).toContain('chipsForDoor(list, door)')
  })

  it('filters chips to the door', () => {
    const categories = [
      { id: 'stocks' as const },
      { id: 'crypto' as const },
      { id: 'sports' as const },
      { id: 'tech' as const },
    ]
    expect(chipsForDoor(categories, 'finance').map((row) => row.id)).toEqual(['stocks', 'crypto'])
    expect(chipsForDoor(categories, 'world').map((row) => row.id)).toEqual(['sports', 'tech'])
  })

  it('finance rendered chrome has no world category names or routes', () => {
    const html = renderToStaticMarkup(createElement(PublicLeagueHub, { door: 'finance' }))
    for (const leak of WORLD_LEAKS) {
      expect(html).not.toContain(leak)
    }
    expect(html).toContain('/league')
    expect(html).toContain(leagueSurfaceCopy('en').doors.financeTitle)
    expect(html).not.toContain(leagueSurfaceCopy('en').doors.worldTitle)
    expect(html).not.toContain(leagueSurfaceCopy('ko').doors.worldTitle)
    expect(leagueSurfaceCopy('ko').doors.financeTitle).toBe('금융 예측')
  })
})

describe('admin-only public UI', () => {
  it('lists every admin-only element and hides them without admin', () => {
    expect(ADMIN_ONLY_PUBLIC_UI.map((row) => row.id)).toEqual([
      'admin-stock-lane',
      'admin-kr-stock-generate',
      'language-toggle-kr',
      'kr-election-admin-banners',
      'admin-preview-as-user',
      'admin-test-badge',
    ])
    const html = renderToStaticMarkup(createElement(PublicLeagueHub, { door: 'world' }))
    expect(html).not.toContain('data-testid="admin-stock-lane"')
    expect(html).not.toContain('data-admin-stock-lane')
    expect(HUB).toContain('effectiveIsAdmin && active?.id === \'stocks\'')
    expect(HUB).toContain('isAdmin={effectiveIsAdmin}')
    expect(HUB).toContain('data-testid="admin-preview-as-user"')
    expect(ADMIN_LAYOUT).toContain('KrElectionAdminBanners')
    expect(HUB).not.toContain('KrElectionAdminBanners')
    expect(GRADE).toContain('admin-test-badge')
  })

  it('preview-as-user uses effectiveIsAdmin so Korean language toggle and KR generation hide', () => {
    expect(HUB).toContain('AdminPreviewProvider')
    expect(HUB).toContain('previewAsUser')
    const locale = readFileSync(resolve('lib/league/i18n/use-league-locale.ts'), 'utf8')
    expect(locale).toContain('preview.isRealAdmin ? preview.effectiveIsAdmin : signals.isAdmin')
  })
})

describe('is_test public filter', () => {
  it('drops test rows from the recent-list helper', () => {
    const rows = [
      {
        id: 'live',
        instrument: 'AIRANK:text:coding:brand_above:Anthropic:OpenAI:20261031',
        proposition_text: 'live',
        resolves_at: '2026-10-31T23:59:59.999Z',
        category: 'ai_models',
        created_at: '2026-10-06T00:00:00.000Z',
        cache_key: 'airank|x',
        is_test: false,
      },
      {
        id: 'test',
        instrument: 'AIRANK:text:coding:brand_above:Anthropic:OpenAI:20261031',
        proposition_text: 'test',
        resolves_at: '2026-10-31T23:59:59.999Z',
        category: 'ai_models',
        created_at: '2026-10-01T00:00:00.000Z',
        cache_key: 'airank|x',
        is_test: true,
      },
    ]
    const picked = selectRecentPublicFreeformRounds(rows, new Set(['live', 'test']), new Date('2026-10-06T12:00:00.000Z'))
    expect(picked.map((row) => row.round_id)).toEqual(['live'])
    expect(excludeTestRounds(rows).map((row) => row.id)).toEqual(['live'])
  })

  it('filters is_test on every public list query', () => {
    expect(LEADERBOARD).toContain(".eq('prediction_rounds.is_test', false)")
    expect(LEADERBOARD).toContain(".eq('is_test', false)")
    expect(RECORD_ROOM).toContain(".eq('is_test', false)")
    expect(INSTRUMENTS).toContain(".eq('is_test', false)")
    expect(CARD).toContain(".eq('prediction_rounds.is_test', false)")
    expect(CONSENSUS).toContain(".eq('is_test', false)")
    expect(PUBLIC_ACCESS).toContain(".eq('is_test', false)")
    expect(PUBLIC_ACCESS).toContain('round.is_test === true')
    expect(CARD).toContain(".eq('is_test', false)")
  })
})

describe('mark-prelaunch-test', () => {
  it('defaults to dry-run and accepts --apply plus --cutoff', () => {
    expect(parseMarkPrelaunchArgs([]).apply).toBe(false)
    expect(parseMarkPrelaunchArgs(['--apply']).apply).toBe(true)
    expect(parseMarkPrelaunchArgs(['--apply', '--dry-run']).apply).toBe(false)
    expect(parseMarkPrelaunchArgs(['--cutoff', '2026-10-06T00:00:00.000Z']).cutoff).toBe(
      '2026-10-06T00:00:00.000Z',
    )
    const sql = readFileSync(resolve('supabase/migrations/20261006000001_prediction_rounds_is_test.sql'), 'utf8')
    expect(sql).toContain('add column if not exists is_test boolean not null default false')
  })
})

describe('unified sizing', () => {
  it('defines one chip grid and one primary button scale', () => {
    expect(CSS).toContain('.league-gate')
    expect(CSS).toContain('.league-chip-grid')
    expect(CSS).toContain('.league-chip')
    expect(CSS).toContain('.league-btn-primary')
    expect(HUB).toContain('league-chip-grid')
    expect(HUB).toContain('league-btn-primary')
  })

  it('has door chrome copy in every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const copy = leagueSurfaceCopy(locale).doors
      expect(copy.enter.length).toBeGreaterThan(1)
      expect(copy.backToDoors.length).toBeGreaterThan(1)
      expect(copy.financeRooms).toHaveLength(6)
      expect(copy.worldRooms).toHaveLength(5)
    }
  })
})
