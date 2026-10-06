import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DoorScene, HubDoors } from '../../../components/league/HubDoors'
import {
  DOOR_FADE_MS,
  DOOR_FALLBACK_GRACE_MS,
  DOOR_SWING_MS,
  beginDoorEntry,
  financeRoomLabels,
  prefersReducedMotion,
  shouldAnimateDoorClick,
  type DoorMotion,
} from '../../../components/league/door-entry'
import { LEAGUE_LOCALES } from '../i18n/locales'
import { leagueSurfaceCopy } from '../i18n/surface-copy'

const HUB_DOORS = readFileSync(resolve('components/league/HubDoors.tsx'), 'utf8')
const LANDING = readFileSync(resolve('app/league/page.tsx'), 'utf8')
const CSS = readFileSync(resolve('app/globals.css'), 'utf8')

function anchorFor(html: string, door: 'finance' | 'world'): { open: string; body: string } {
  const open = html.match(new RegExp(`<a\\b[^>]*data-testid="door-${door}"[^>]*>`))?.[0] ?? ''
  const start = html.indexOf(open)
  const body = open ? html.slice(start, html.indexOf('</a>', start)) : ''
  return { open, body }
}

function plainClick(overrides: Partial<Parameters<typeof shouldAnimateDoorClick>[0]> = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...overrides,
  }
}

function realTimers() {
  return {
    setTimer: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimer: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  }
}

describe('door scene markup', () => {
  it('renders both doors as real links to /league/finance and /league/world', () => {
    const html = renderToStaticMarkup(createElement(HubDoors, { initialLocale: 'ko' }))
    const finance = anchorFor(html, 'finance')
    const world = anchorFor(html, 'world')
    expect(finance.open).toContain('href="/league/finance"')
    expect(world.open).toContain('href="/league/world"')
    expect(finance.body).toContain('금융 예측')
    expect(finance.body).toContain('MARKETS')
    expect(world.body).toContain('이슈 예측')
    expect(world.body).toContain('EVENTS')
  })

  it('keeps 들어가기 inside each link so it navigates without JavaScript', () => {
    const html = renderToStaticMarkup(createElement(HubDoors, { initialLocale: 'ko' }))
    for (const door of ['finance', 'world'] as const) {
      const { open, body } = anchorFor(html, door)
      expect(body).toContain('들어가기')
      expect(body).toContain('class="league-gate__cta"')
      expect(open).toMatch(/aria-labelledby="[^"]+-title [^"]+-cta"/)
    }
    expect(html).toContain('AI 40개가 시장의 방향을 예측합니다')
    expect(html).toContain('세상일을 예/아니오로 물어보세요')
    expect(html).toContain('<h1 class="league-hall__title">AI 예측 리그</h1>')
  })

  it('omits 밈코인 in the Korean lane and lists it elsewhere', () => {
    const korea = renderToStaticMarkup(createElement(HubDoors, { initialLocale: 'ko', initialKoreaLane: true }))
    const koreaFinance = anchorFor(korea, 'finance').body
    expect(koreaFinance).toContain('주식')
    expect(koreaFinance).toContain('원자재·에너지')
    expect(koreaFinance).not.toContain('밈코인')

    const global = renderToStaticMarkup(createElement(HubDoors, { initialLocale: 'ko', initialKoreaLane: false }))
    expect(anchorFor(global, 'finance').body).toContain('밈코인')

    const forced = renderToStaticMarkup(
      createElement(HubDoors, { initialLocale: 'ko', initialKoreaLane: false, omitMemecoin: true }),
    )
    expect(anchorFor(forced, 'finance').body).not.toContain('밈코인')

    const ko = leagueSurfaceCopy('ko').doors
    expect(financeRoomLabels(ko, true)).toEqual(['주식', '암호화폐', '외환', '금·귀금속', '지수/ETF', '원자재·에너지'])
    expect(financeRoomLabels(ko, false).at(-1)).toBe('밈코인')
  })

  it('renders room labels as list items and the world door rooms', () => {
    const html = renderToStaticMarkup(createElement(DoorScene, { locale: 'ko', hideMemecoin: true }))
    const world = anchorFor(html, 'world').body
    for (const room of ['정치·선거', '엔터테인먼트', '스포츠', '부동산', '테크·AI 순위']) {
      expect(world).toContain(`<li class="league-gate__room">${room}</li>`)
    }
  })

  it('hinges each door on its outer side and mirrors for RTL', () => {
    const ltr = renderToStaticMarkup(createElement(DoorScene, { locale: 'en', hideMemecoin: false }))
    expect(anchorFor(ltr, 'finance').open).toContain('data-hinge="left"')
    expect(anchorFor(ltr, 'world').open).toContain('data-hinge="right"')
    expect(ltr).toContain('dir="ltr"')

    const rtl = renderToStaticMarkup(createElement(DoorScene, { locale: 'ar', hideMemecoin: false }))
    expect(rtl).toContain('dir="rtl"')
    expect(rtl).toContain('lang="ar"')
    expect(anchorFor(rtl, 'finance').open).toContain('data-hinge="right"')
    expect(anchorFor(rtl, 'world').open).toContain('data-hinge="left"')
  })

  it('starts closed: no opening state and an idle flood layer', () => {
    const html = renderToStaticMarkup(createElement(DoorScene, { locale: 'en', hideMemecoin: false }))
    expect(html).not.toContain('data-state="opening"')
    expect(html).not.toContain('data-opening=')
    expect(html).toContain('class="league-hall__flood"')
    expect(html).toContain(`--door-swing-ms:${DOOR_SWING_MS}ms`)
    expect(html).toContain(`--door-fade-ms:${DOOR_FADE_MS}ms`)
  })
})

describe('door entry navigation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reduced motion: fades instead of swinging, then navigates', () => {
    const navigate = vi.fn()
    const started: DoorMotion[] = []
    beginDoorEntry('/league/finance', {
      reducedMotion: true,
      start: (motion) => started.push(motion),
      navigate,
      ...realTimers(),
    })
    expect(started).toEqual(['fade'])
    expect(navigate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(DOOR_FADE_MS + DOOR_FALLBACK_GRACE_MS)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/league/finance')
  })

  it('reduced motion: animationend navigates right away and the timer does not navigate twice', () => {
    const navigate = vi.fn()
    const entry = beginDoorEntry('/league/world', {
      reducedMotion: true,
      start: () => {},
      navigate,
      ...realTimers(),
    })
    entry.finish()
    expect(navigate).toHaveBeenCalledWith('/league/world')
    vi.advanceTimersByTime(5_000)
    entry.finish()
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('swing: waits for the open animation, which lasts 600–800 ms', () => {
    expect(DOOR_SWING_MS).toBeGreaterThanOrEqual(600)
    expect(DOOR_SWING_MS).toBeLessThanOrEqual(800)
    const navigate = vi.fn()
    const started: DoorMotion[] = []
    const entry = beginDoorEntry('/league/finance', {
      reducedMotion: false,
      start: (motion) => started.push(motion),
      navigate,
      ...realTimers(),
    })
    expect(entry.motion).toBe('swing')
    expect(started).toEqual(['swing'])
    vi.advanceTimersByTime(DOOR_SWING_MS - 1)
    expect(navigate).not.toHaveBeenCalled()
    entry.finish()
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('swing: navigates on the timeout when animationend never fires', () => {
    const navigate = vi.fn()
    beginDoorEntry('/league/world', { reducedMotion: false, start: () => {}, navigate, ...realTimers() })
    vi.advanceTimersByTime(DOOR_SWING_MS + DOOR_FALLBACK_GRACE_MS - 1)
    expect(navigate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(navigate).toHaveBeenCalledWith('/league/world')
  })

  it('navigates immediately when the animation cannot start', () => {
    const navigate = vi.fn()
    beginDoorEntry('/league/finance', {
      reducedMotion: false,
      start: () => {
        throw new Error('no animation')
      },
      navigate,
      ...realTimers(),
    })
    expect(navigate).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5_000)
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('cancel drops the pending navigation', () => {
    const navigate = vi.fn()
    const entry = beginDoorEntry('/league/finance', { reducedMotion: false, start: () => {}, navigate, ...realTimers() })
    entry.cancel()
    vi.advanceTimersByTime(5_000)
    entry.finish()
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('door click policy', () => {
  it('animates plain clicks and Enter, leaves modified clicks to the browser', () => {
    expect(shouldAnimateDoorClick(plainClick())).toBe(true)
    expect(shouldAnimateDoorClick(plainClick({ metaKey: true }))).toBe(false)
    expect(shouldAnimateDoorClick(plainClick({ ctrlKey: true }))).toBe(false)
    expect(shouldAnimateDoorClick(plainClick({ shiftKey: true }))).toBe(false)
    expect(shouldAnimateDoorClick(plainClick({ altKey: true }))).toBe(false)
    expect(shouldAnimateDoorClick(plainClick({ button: 1 }))).toBe(false)
    expect(shouldAnimateDoorClick(plainClick({ defaultPrevented: true }))).toBe(false)
  })

  it('reads prefers-reduced-motion and never throws', () => {
    const host = (matches: boolean) => ({ matchMedia: () => ({ matches }) })
    expect(prefersReducedMotion(host(true))).toBe(true)
    expect(prefersReducedMotion(host(false))).toBe(false)
    expect(prefersReducedMotion(undefined)).toBe(false)
    expect(prefersReducedMotion({})).toBe(false)
    expect(
      prefersReducedMotion({
        matchMedia: () => {
          throw new Error('unsupported')
        },
      }),
    ).toBe(false)
  })

  it('wires the component to the pure entry and keeps a hard-navigation fallback', () => {
    expect(HUB_DOORS).toContain('beginDoorEntry(doorPath(door)')
    expect(HUB_DOORS).toContain('reducedMotion: prefersReducedMotion()')
    expect(HUB_DOORS).toContain('onAnimationEnd')
    expect(HUB_DOORS).toContain('entry.current?.finish()')
    expect(HUB_DOORS).toContain('anchor.click()')
    expect(HUB_DOORS).toContain('window.location.assign(href)')
    expect(HUB_DOORS).toContain('if (!shouldAnimateDoorClick(event)) return')
  })
})

describe('door scene styles and page', () => {
  it('swings around the hinge, fades under reduced motion, and floods the screen', () => {
    expect(CSS).toContain('@keyframes league-gate-swing')
    expect(CSS).toContain('transform: rotateY(calc(var(--gate-dir) * 100deg))')
    expect(CSS).toContain('transform: rotateY(calc(var(--gate-dir) * 9deg))')
    expect(CSS).toContain("animation: league-gate-swing var(--door-swing-ms, 760ms)")
    expect(CSS).toContain(".league-hall__flood[data-motion='fade']")
    expect(CSS).toContain(".league-hall__flood[data-motion='swing']")
    const start = CSS.search(/@media \(prefers-reduced-motion: reduce\) \{\s+\.league-hall__title/)
    expect(start).toBeGreaterThan(-1)
    const reduced = CSS.slice(start, CSS.indexOf('@media (forced-colors: active)', start))
    expect(reduced).toContain('.league-gate__leaf')
    expect(reduced).toContain('transform: none !important')
    expect(reduced).toContain('animation: none !important')
    expect(CSS).toContain('.league-gate:focus-visible .league-gate__frame')
    expect(CSS).toContain('perspective: 1400px')
  })

  it('resolves the first-paint locale and lane on the server', () => {
    expect(LANDING).toContain('getIpCountryFromHeaders(requestHeaders)')
    expect(LANDING).toContain('resolveLeagueLocale(')
    expect(LANDING).toContain('<HubDoors initialLocale={initialLocale} initialKoreaLane={initialKoreaLane} />')
  })

  it('has door copy in every locale', () => {
    for (const locale of LEAGUE_LOCALES) {
      const copy = leagueSurfaceCopy(locale).doors
      expect(copy.sceneTitle.length).toBeGreaterThan(3)
      expect(copy.financeTagline.length).toBeGreaterThan(8)
      expect(copy.worldTagline.length).toBeGreaterThan(8)
      expect(copy.memecoinRoom.length).toBeGreaterThan(1)
      expect(copy.financeRooms).not.toContain(copy.memecoinRoom)
      for (const room of [...copy.financeRooms, ...copy.worldRooms]) expect(room.trim().length).toBeGreaterThan(0)
    }
    const ko = leagueSurfaceCopy('ko').doors
    expect(ko.financeTagline).toBe('AI 40개가 시장의 방향을 예측합니다')
    expect(ko.worldTagline).toBe('세상일을 예/아니오로 물어보세요')
    expect(ko.enter).toBe('들어가기')
  })
})
