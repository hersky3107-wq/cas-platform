'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { admissionStockLane } from '@/lib/league/stock-lane'
import { doorPath, type HubDoor } from '@/lib/league/hub-doors'
import { localeDir, type LeagueLocale } from '@/lib/league/i18n/locales'
import { leagueSurfaceCopy } from '@/lib/league/i18n/surface-copy'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'
import { useLeagueRequestSignals } from '@/lib/league/use-league-request-signals'
import {
  DOOR_FADE_MS,
  DOOR_HARD_NAV_MS,
  DOOR_SWING_MS,
  beginDoorEntry,
  financeRoomLabels,
  prefersReducedMotion,
  shouldAnimateDoorClick,
  type DoorEntry,
  type DoorMotion,
} from './door-entry'

export type HubDoorsProps = {
  /** Resolved on the server from request headers so the first paint is already in the viewer's language. */
  initialLocale?: LeagueLocale
  initialKoreaLane?: boolean
  /** Overrides lane detection. */
  omitMemecoin?: boolean
}

export function HubDoors({ initialLocale = 'en', initialKoreaLane = false, omitMemecoin }: HubDoorsProps = {}) {
  const resolved = useLeagueLocale()
  const signals = useLeagueRequestSignals()
  // A failed context fetch settles with every signal null; keep the server's answer then.
  const informed =
    signals.acceptLanguage !== null ||
    signals.profileLocale !== null ||
    signals.ipCountry !== null ||
    signals.declaredCountry !== null
  const live = !resolved.loading && !signals.loading && informed
  const locale = live ? resolved.locale : initialLocale
  const koreaLane = live
    ? admissionStockLane({ declaredCountry: signals.declaredCountry, ipCountry: signals.ipCountry }) === 'korea'
    : initialKoreaLane
  return <DoorScene locale={locale} hideMemecoin={omitMemecoin ?? koreaLane} />
}

type Opening = { door: HubDoor; motion: DoorMotion; x: number; y: number }

const DOORS: readonly HubDoor[] = ['finance', 'world']
const NUMERALS: Record<HubDoor, string> = { finance: 'I', world: 'II' }

export function DoorScene({ locale, hideMemecoin }: { locale: LeagueLocale; hideMemecoin: boolean }) {
  const copy = leagueSurfaceCopy(locale).doors
  const dir = localeDir(locale)
  const [opening, setOpening] = useState<Opening | null>(null)
  const entry = useRef<DoorEntry | null>(null)
  const passThrough = useRef(false)
  const hardNav = useRef<number | null>(null)
  const anchors = useRef<Partial<Record<HubDoor, HTMLAnchorElement | null>>>({})

  useEffect(() => {
    const clearHardNav = () => {
      if (hardNav.current !== null) window.clearTimeout(hardNav.current)
      hardNav.current = null
    }
    const restore = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      entry.current?.cancel()
      entry.current = null
      clearHardNav()
      setOpening(null)
    }
    window.addEventListener('pageshow', restore)
    return () => {
      window.removeEventListener('pageshow', restore)
      entry.current?.cancel()
      clearHardNav()
    }
  }, [])

  const navigate = (door: HubDoor, href: string) => {
    const anchor = anchors.current[door]
    if (!anchor) {
      window.location.assign(href)
      return
    }
    // Re-dispatch on the real anchor so next/link does the soft navigation;
    // if the router is not mounted the native href still navigates.
    passThrough.current = true
    try {
      anchor.click()
    } finally {
      passThrough.current = false
    }
    hardNav.current = window.setTimeout(() => {
      if (window.location.pathname !== href) window.location.assign(href)
    }, DOOR_HARD_NAV_MS)
  }

  const onDoorClick = (door: HubDoor) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (passThrough.current) return
    if (entry.current) {
      event.preventDefault()
      return
    }
    if (!shouldAnimateDoorClick(event)) return
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    entry.current = beginDoorEntry(doorPath(door), {
      reducedMotion: prefersReducedMotion(),
      start: (motion) =>
        setOpening({ door, motion, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }),
      navigate: (href) => navigate(door, href),
      setTimer: (run, ms) => window.setTimeout(run, ms),
      clearTimer: (handle) => window.clearTimeout(handle),
    })
  }

  const timing = {
    '--door-swing-ms': `${DOOR_SWING_MS}ms`,
    '--door-fade-ms': `${DOOR_FADE_MS}ms`,
  } as CSSProperties
  const floodOrigin = opening
    ? ({ '--flood-x': `${opening.x}px`, '--flood-y': `${opening.y}px` } as CSSProperties)
    : undefined

  return (
    <div
      dir={dir}
      lang={locale}
      className="league-hall"
      data-testid="league-landing"
      data-opening={opening?.door}
      style={timing}
    >
      <CorridorLines />
      <div aria-hidden="true" className="league-hall__vignette" />
      <h1 className="league-hall__title">{copy.sceneTitle}</h1>
      <div className="league-hall__doors">
        {DOORS.map((door, index) => (
          <Gate
            key={door}
            door={door}
            hinge={(index === 0) === (dir === 'ltr') ? 'left' : 'right'}
            numeral={NUMERALS[door]}
            title={door === 'finance' ? copy.financeMark : copy.worldMark}
            subtitle={door === 'finance' ? copy.financeTitle : copy.worldTitle}
            tagline={door === 'finance' ? copy.financeTagline : copy.worldTagline}
            rooms={door === 'finance' ? financeRoomLabels(copy, hideMemecoin) : copy.worldRooms}
            enter={copy.enter}
            motion={opening?.door === door ? opening.motion : null}
            onClick={onDoorClick(door)}
            anchorRef={(node) => {
              anchors.current[door] = node
            }}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="league-hall__flood"
        data-door={opening?.door}
        data-motion={opening?.motion}
        style={floodOrigin}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) entry.current?.finish()
        }}
      />
    </div>
  )
}

function Gate({
  door,
  hinge,
  numeral,
  title,
  subtitle,
  tagline,
  rooms,
  enter,
  motion,
  onClick,
  anchorRef,
}: {
  door: HubDoor
  hinge: 'left' | 'right'
  numeral: string
  title: string
  subtitle: string
  tagline: string
  rooms: readonly string[]
  enter: string
  motion: DoorMotion | null
  onClick: (event: MouseEvent<HTMLAnchorElement>) => void
  anchorRef: (node: HTMLAnchorElement | null) => void
}) {
  const id = useId()
  const titleId = `${id}-title`
  const taglineId = `${id}-tagline`
  const roomsId = `${id}-rooms`
  const ctaId = `${id}-cta`

  return (
    <Link
      ref={anchorRef}
      href={doorPath(door)}
      className="league-gate"
      data-testid={`door-${door}`}
      data-door={door}
      data-hinge={hinge}
      data-state={motion ? 'opening' : undefined}
      data-motion={motion ?? undefined}
      aria-labelledby={`${titleId} ${ctaId}`}
      aria-describedby={`${taglineId} ${roomsId}`}
      onClick={onClick}
    >
      <span aria-hidden="true" className="league-gate__spill" />
      <div className="league-gate__frame">
        <div className="league-gate__opening">
          <div aria-hidden="true" className="league-gate__light" />
          <div className="league-gate__leaf">
            <div className="league-gate__panel league-gate__panel--upper">
              <span aria-hidden="true" className="league-gate__numeral">
                {numeral}
              </span>
              <h2 id={titleId} className="league-gate__title">
                {title}
              </h2>
              <p className="league-gate__subtitle">{subtitle}</p>
              <span aria-hidden="true" className="league-gate__rule" />
              <p id={taglineId} className="league-gate__tagline">
                {tagline}
              </p>
              <ul id={roomsId} className="league-gate__rooms">
                {rooms.map((room) => (
                  <li key={room} className="league-gate__room">
                    {room}
                  </li>
                ))}
              </ul>
            </div>
            <div className="league-gate__panel league-gate__panel--lower">
              <span id={ctaId} className="league-gate__cta">
                {enter}
                <span aria-hidden="true" className="league-gate__arrow">
                  →
                </span>
              </span>
            </div>
            <span aria-hidden="true" className="league-gate__handle" />
          </div>
          <div aria-hidden="true" className="league-gate__leak" />
        </div>
      </div>
    </Link>
  )
}

function CorridorLines() {
  return (
    <svg aria-hidden="true" className="league-hall__lines" viewBox="0 0 100 100" preserveAspectRatio="none">
      <line x1="0" y1="0" x2="50" y2="46" />
      <line x1="100" y1="0" x2="50" y2="46" />
      <line x1="0" y1="100" x2="50" y2="46" />
      <line x1="100" y1="100" x2="50" y2="46" />
      <line x1="0" y1="34" x2="50" y2="46" />
      <line x1="100" y1="34" x2="50" y2="46" />
      <line x1="0" y1="66" x2="50" y2="46" />
      <line x1="100" y1="66" x2="50" y2="46" />
      <line x1="22" y1="100" x2="50" y2="46" />
      <line x1="78" y1="100" x2="50" y2="46" />
      <line x1="22" y1="0" x2="50" y2="46" />
      <line x1="78" y1="0" x2="50" y2="46" />
      <line x1="0" y1="91" x2="100" y2="91" />
      <line x1="0" y1="96" x2="100" y2="96" />
    </svg>
  )
}
