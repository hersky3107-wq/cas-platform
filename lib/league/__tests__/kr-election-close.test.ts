import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { gatePublicGenerateInstrument } from '../access-policy'
import { encodePoliticsInstrument } from '../gateway/adapters/politics-catalog'
import {
  dispatchKrElectionAlerts,
  dueKrElectionMilestones,
  krElectionMilestoneAt,
  resetKrElectionAlertMemory,
  resetKrElectionTelegramOptionalLog,
  memoryKrElectionAlertStore,
} from '../politics/kr-election-alerts'
import { listKrElectionAdminBanners } from '../politics/kr-election-admin-banner'
import { KR_ELECTION_CALENDAR } from '../politics/kr-calendar'
import {
  envKrManualCloseFlag,
  isKrElectionClosedByFlag,
  krElectionAccessDenied,
  parseKrManualCloseFlag,
} from '../politics/kr-manual-close'
import { getLeagueUiPack } from '../i18n/dictionary'

const ROOT = join(__dirname, '../../..')

const KR_RACE = encodePoliticsInstrument({
  jurisdiction: 'KR',
  office: 'other',
  cycle: '2026',
  district: 'nationwide',
  candidate: 'Test Candidate',
  pollCloseMs: Date.parse('2026-06-03T09:00:00.000Z'),
})

const US_RACE = encodePoliticsInstrument({
  jurisdiction: 'US',
  office: 'president',
  cycle: '2026',
  district: '_',
  candidate: 'Special Candidate',
  pollCloseMs: Date.parse('2026-11-03T05:00:00.000Z'),
})

const krViewer = { isAdmin: false, jurisdiction: { declaredCountry: 'KR' as const, ipCountry: 'KR' as const } }
const usViewer = { isAdmin: false, jurisdiction: { declaredCountry: 'US' as const, ipCountry: 'US' as const } }
const admin = { isAdmin: true, jurisdiction: { declaredCountry: 'KR' as const, ipCountry: 'KR' as const } }

describe('KR manual close flag', () => {
  it('switch ON denies KR races for KR-lane and US viewers; US races stay open', () => {
    const on = parseKrManualCloseFlag('all_kr')
    expect(isKrElectionClosedByFlag(KR_RACE, on)).toBe(true)
    expect(krElectionAccessDenied(krViewer, KR_RACE, on)).toBe(true)
    expect(krElectionAccessDenied(usViewer, KR_RACE, on)).toBe(true)
    expect(isKrElectionClosedByFlag(US_RACE, on)).toBe(false)
    expect(krElectionAccessDenied(krViewer, US_RACE, on)).toBe(false)

    expect(gatePublicGenerateInstrument(KR_RACE, krViewer, '1d', on)).toEqual({
      ok: false,
      status: 403,
      code: 'kr_election_manual_close',
    })
    expect(gatePublicGenerateInstrument(KR_RACE, usViewer, '1d', on)).toEqual({
      ok: false,
      status: 403,
      code: 'kr_election_manual_close',
    })
    expect(gatePublicGenerateInstrument(US_RACE, krViewer, '1d', on)).toMatchObject({ ok: true, instrument: US_RACE })
  })

  it('switch OFF allows KR races; admin bypass works while ON', () => {
    const off = parseKrManualCloseFlag('off')
    expect(krElectionAccessDenied(krViewer, KR_RACE, off)).toBe(false)
    expect(gatePublicGenerateInstrument(KR_RACE, krViewer, '1d', off)).toMatchObject({ ok: true, instrument: KR_RACE })

    const on = parseKrManualCloseFlag('KR:local:2026:nationwide')
    expect(krElectionAccessDenied(admin, KR_RACE, on)).toBe(false)
    expect(gatePublicGenerateInstrument(KR_RACE, admin, '1d', on)).toMatchObject({ ok: true, instrument: KR_RACE })
  })

  it('env fallback KR_ELECTION_MANUAL_CLOSE parses all_kr', () => {
    expect(envKrManualCloseFlag({ KR_ELECTION_MANUAL_CLOSE: 'all_kr' })).toEqual({ mode: 'all_kr' })
    expect(envKrManualCloseFlag({ KR_ELECTION_MANUAL_CLOSE: 'off' })).toEqual({ mode: 'off' })
  })
})

describe('KR election alert milestones', () => {
  const row = KR_ELECTION_CALENDAR[0]!
  const d14 = krElectionMilestoneAt(row.pollCloseIso, 'd14')!
  const d7 = krElectionMilestoneAt(row.pollCloseIso, 'd7')!
  const d6 = krElectionMilestoneAt(row.pollCloseIso, 'd6')!
  const close = krElectionMilestoneAt(row.pollCloseIso, 'poll_close')!

  beforeEach(() => {
    resetKrElectionAlertMemory()
    resetKrElectionTelegramOptionalLog()
  })

  it('D-14 / D-7 / D-6 / poll close are ordered and due after each clock', () => {
    expect(d14).toBeLessThan(d7)
    expect(d7).toBeLessThan(d6)
    expect(d6).toBeLessThan(close)
    expect(dueKrElectionMilestones(row, d14 - 1)).toEqual([])
    expect(dueKrElectionMilestones(row, d14)).toEqual(['d14'])
    expect(dueKrElectionMilestones(row, d7)).toEqual(['d14', 'd7'])
    expect(dueKrElectionMilestones(row, d6)).toEqual(['d14', 'd7', 'd6'])
    expect(dueKrElectionMilestones(row, close)).toEqual(['d14', 'd7', 'd6', 'poll_close'])
  })

  it('each milestone sends exactly once with a fixed clock', async () => {
    const texts: string[] = []
    const fetchImpl: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { text?: string }
      texts.push(body.text ?? '')
      return new Response('ok', { status: 200 })
    }
    const env = { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_ADMIN_CHAT_ID: '1' }
    const store = memoryKrElectionAlertStore()

    const first = await dispatchKrElectionAlerts({ atMs: d6, store, env, fetchImpl })
    expect(first.sent.map((s) => s.milestone)).toEqual(['d14', 'd7', 'd6'])
    expect(texts.some((t) => t.includes('지금 차단 필요'))).toBe(true)

    const again = await dispatchKrElectionAlerts({ atMs: d6, store, env, fetchImpl })
    expect(again.sent).toEqual([])

    const afterClose = await dispatchKrElectionAlerts({ atMs: close, store, env, fetchImpl })
    expect(afterClose.sent.map((s) => s.milestone)).toEqual(['poll_close'])
    expect(texts.some((t) => t.includes('차단 해제 가능'))).toBe(true)

    const afterCloseAgain = await dispatchKrElectionAlerts({ atMs: close, store, env, fetchImpl })
    expect(afterCloseAgain.sent).toEqual([])
  })

  it('with Telegram env missing, does not send or record alert_sent rows', async () => {
    const logs: string[] = []
    const origLog = console.log
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '))
    }
    try {
      let markCalls = 0
      let hasCalls = 0
      const store = {
        async hasSent() {
          hasCalls += 1
          return false
        },
        async markSent() {
          markCalls += 1
        },
      }
      const fetchImpl: typeof fetch = async () => {
        throw new Error('fetch should not run')
      }
      const result = await dispatchKrElectionAlerts({ atMs: d6, store, env: {}, fetchImpl })
      expect(result.sent).toEqual([])
      expect(markCalls).toBe(0)
      expect(hasCalls).toBe(0)
      expect(logs.some((l) => l.includes('telegram not configured; admin banner only'))).toBe(true)
      await dispatchKrElectionAlerts({ atMs: d6, store, env: {}, fetchImpl })
      expect(logs.filter((l) => l.includes('telegram not configured')).length).toBe(1)
    } finally {
      console.log = origLog
    }
  })
})

describe('KR election admin stage banners', () => {
  const row = KR_ELECTION_CALENDAR[0]!
  const d14 = krElectionMilestoneAt(row.pollCloseIso, 'd14')!
  const d7 = krElectionMilestoneAt(row.pollCloseIso, 'd7')!
  const d6 = krElectionMilestoneAt(row.pollCloseIso, 'd6')!
  const close = krElectionMilestoneAt(row.pollCloseIso, 'poll_close')!

  it('shows yellow / orange / red / green in order and nothing outside windows', () => {
    expect(listKrElectionAdminBanners(d14 - 1, false)).toEqual([])

    const prepare = listKrElectionAdminBanners(d14, false)[0]
    expect(prepare?.stage).toBe('prepare')
    expect(prepare?.color).toBe('yellow')
    expect(prepare?.text).toContain('차단 준비')
    expect(prepare?.text).toContain('투표일 2026-06-03')

    const warn = listKrElectionAdminBanners(d7, false)[0]
    expect(warn?.stage).toBe('warn')
    expect(warn?.color).toBe('orange')
    expect(warn?.text).toContain('다음 단계에서 차단 필요')

    const blackoutOff = listKrElectionAdminBanners(d6, false)[0]
    expect(blackoutOff?.stage).toBe('blackout')
    expect(blackoutOff?.color).toBe('red')
    expect(blackoutOff?.text).toContain('수동 차단 스위치: OFF')
    expect(blackoutOff?.showToggle).toBe(true)

    const blackoutOn = listKrElectionAdminBanners(d6, true)[0]
    expect(blackoutOn?.text).toContain('수동 차단 스위치: ON')

    const post = listKrElectionAdminBanners(close + 1, false)[0]
    expect(post?.stage).toBe('post')
    expect(post?.color).toBe('green')
    expect(post?.text).toContain('투표 종료 — 차단 해제 가능')

    expect(listKrElectionAdminBanners(close + 25 * 60 * 60 * 1000, false)).toEqual([])
  })
})

describe('wiring — authorize, hub, cron', () => {
  it('authorizeRoundForViewer checks the KR manual close before other denies', () => {
    const src = readFileSync(join(ROOT, 'lib/league/public-access.ts'), 'utf8')
    expect(src).toContain('krElectionAccessDenied')
    expect(src).toContain("forbiddenResponse('kr_election_manual_close')")
    expect(src.indexOf('krElectionAccessDenied')).toBeLessThan(src.indexOf("if (!viewer.isAdmin)"))
  })

  it('hub shows the dictionary line and no deep buttons on electionClosed', () => {
    const hub = readFileSync(join(ROOT, 'components/league/PublicLeagueHub.tsx'), 'utf8')
    expect(hub).toContain("kind: 'electionClosed'")
    expect(hub).toContain('t.disclaimer.electionManualClose')
    expect(hub).toContain("body.code === 'kr_election_manual_close'")
    expect(getLeagueUiPack('ko').disclaimer.electionManualClose).toBe(
      '선거 관련 법령에 따라 투표 종료 시까지 이 예측은 공개되지 않습니다.',
    )
  })

  it('league-generate cron dispatches KR election alerts', () => {
    const src = readFileSync(join(ROOT, 'app/api/cron/league-generate/route.ts'), 'utf8')
    expect(src).toContain('dispatchKrElectionAlerts')
  })

  it('admin layout renders election stage banners on every admin page', () => {
    const layout = readFileSync(join(ROOT, 'app/admin/layout.tsx'), 'utf8')
    expect(layout).toContain('KrElectionAdminBanners')
    const banners = readFileSync(join(ROOT, 'app/admin/KrElectionAdminBanners.tsx'), 'utf8')
    expect(banners).toContain('banners')
    expect(banners).toContain('한국 선거 전부 차단')
    const route = readFileSync(join(ROOT, 'app/api/admin/league/blackout/route.ts'), 'utf8')
    expect(route).toContain('listKrElectionAdminBanners')
  })
})
