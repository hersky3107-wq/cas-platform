import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ADMIN_EMAIL } from '@/lib/credits'
import { MOTIE_FREE_TEXT_CLOSED_ERROR, MOTIE_FREE_TEXT_PROGRAM_CLOSED_MESSAGE } from '../free-text-program'
import { MotieFreeTextProgramClosed } from '@/components/motie/MotieFreeTextProgramClosed'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  resolveRouteAuth: vi.fn(),
  checkRateLimit: vi.fn(),
  deductCreditsBalance: vi.fn(),
  gatherJejuSnapshot: vi.fn(),
  planJejuOpenMeeting: vi.fn(),
}))

vi.mock('@/lib/supabase/route-auth', () => ({
  resolveRouteAuth: (...args: unknown[]) => mocks.resolveRouteAuth(...args),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mocks.checkRateLimit(...args),
}))

vi.mock('@/lib/credits-server', () => ({
  deductCreditsBalance: (...args: unknown[]) => mocks.deductCreditsBalance(...args),
}))

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
      update: vi.fn(() => ({ eq: vi.fn(async () => ({})) })),
      insert: vi.fn(async () => ({ data: { id: 'sess-1' }, error: null })),
    })),
  },
}))

vi.mock('@/lib/motie/brief', () => ({
  gatherJejuSnapshot: (...args: unknown[]) => mocks.gatherJejuSnapshot(...args),
  buildBriefingContext: vi.fn(() => 'ctx'),
}))

vi.mock('@/lib/motie/deep', () => ({
  summarizeAvailableData: vi.fn(async () => 'summary'),
  planJejuMeeting: vi.fn(),
  renderChairVerdict: vi.fn(),
  runJejuMotionVote: vi.fn(),
  JEJU_DEEP_DELIBERATION_TUNING: {
    MIN_CONVERGENCE_ROUNDS: 1,
    MAX_CONVERGENCE_ROUNDS: 6,
    CONSENSUS_TARGET: 80,
    STALL_DELTA: 5,
    CONSENSUS_SCORE_UNAVAILABLE: -1,
    CONSENSUS_VOTE_THRESHOLD: 0.75,
  },
}))

vi.mock('@/lib/motie/open-brief', () => ({
  planJejuOpenMeeting: (...args: unknown[]) => mocks.planJejuOpenMeeting(...args),
  runJejuOpenAnalyses: vi.fn(),
  synthesizeJejuOpenBrief: vi.fn(),
  OPEN_BRIEF_ANALYSTS: [],
}))

vi.mock('@/lib/motie/pre-report', () => ({
  generateJejuPreReport: vi.fn(),
}))

vi.mock('@/lib/motie/synod-debate', () => ({
  SYNOD_DEBATERS: [],
  PROVIDER_TO_BRAND: {},
  openingSystemPrompt: vi.fn(),
  turnSystemPrompt: vi.fn(),
  facilitatorSystemPrompt: vi.fn(),
  buildDeliberationContext: vi.fn(),
  buildFacilitatorInput: vi.fn(),
  parseClaim: vi.fn(),
  parseActionTag: vi.fn(),
  safeParseJson: vi.fn(),
}))

vi.mock('@/lib/motie/local-providers', () => ({
  isMotieLocalProvider: vi.fn(() => false),
  callMotieLocalProvider: vi.fn(),
}))

vi.mock('@/lib/motie/deepseek-chat', () => ({
  callMotieDeepseekChat: vi.fn(),
}))

vi.mock('@/lib/ai/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/router')>()
  return {
    ...actual,
    runSingleAiProvider: vi.fn(),
  }
})

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('MOTIE free-text program closed', () => {
  beforeEach(() => {
    mocks.resolveRouteAuth.mockReset()
    mocks.checkRateLimit.mockReset()
    mocks.deductCreditsBalance.mockReset()
    mocks.gatherJejuSnapshot.mockReset()
    mocks.planJejuOpenMeeting.mockReset()
    mocks.checkRateLimit.mockReturnValue({ ok: true, retryAfterMs: 0 })
    mocks.deductCreditsBalance.mockResolvedValue({ ok: true, balance: 100 })
    mocks.gatherJejuSnapshot.mockResolvedValue({})
  })

  it('exports the closed notice copy and API error code', () => {
    expect(MOTIE_FREE_TEXT_PROGRAM_CLOSED_MESSAGE).toBe('종료된 프로그램입니다.')
    expect(MOTIE_FREE_TEXT_CLOSED_ERROR).toBe('motie_closed')
  })

  it('renders the closed notice without an input control', () => {
    const html = renderToStaticMarkup(createElement(MotieFreeTextProgramClosed))
    expect(html).toContain('종료된 프로그램입니다.')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('<input')
  })

  it('brief and deliberate pages gate the form behind admin access', () => {
    for (const file of ['brief/page.tsx', 'deliberate/page.tsx']) {
      const src = readFileSync(join(__dirname, `../../../app/motie/governance/${file}`), 'utf8')
      expect(src).toContain('MotieFreeTextProgramClosed')
      expect(src).toMatch(/if \(!accessLoading && !isAdmin\)[\s\S]*MotieFreeTextProgramClosed/)
      const closedIdx = src.indexOf('MotieFreeTextProgramClosed')
      const textareaIdx = src.indexOf('<textarea')
      expect(closedIdx).toBeGreaterThan(-1)
      expect(textareaIdx).toBeGreaterThan(closedIdx)
    }
  })

  describe('POST /api/motie/brief', () => {
    it('non-admin → 403 motie_closed before rate limit or charge', async () => {
      mocks.resolveRouteAuth.mockResolvedValue({
        user: { id: 'u1', email: 'user@example.com' },
        error: null,
      })
      const { POST } = await import('@/app/api/motie/brief/route')
      const res = await POST(
        post('/api/motie/brief', { action: 'start', question: '무역 정책은?' }),
      )
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'motie_closed' })
      expect(mocks.checkRateLimit).not.toHaveBeenCalled()
      expect(mocks.deductCreditsBalance).not.toHaveBeenCalled()
      expect(mocks.gatherJejuSnapshot).not.toHaveBeenCalled()
    })

    it('admin passes the close gate (not 403)', async () => {
      mocks.resolveRouteAuth.mockResolvedValue({
        user: { id: 'admin', email: ADMIN_EMAIL },
        error: null,
      })
      const { POST } = await import('@/app/api/motie/brief/route')
      const res = await POST(post('/api/motie/brief', { action: 'unknown-stage' }))
      expect(res.status).not.toBe(403)
    })

    it('still refuses league roundId before auth', async () => {
      const { POST } = await import('@/app/api/motie/brief/route')
      const res = await POST(post('/api/motie/brief', { action: 'start', roundId: 'r1', question: 'x' }))
      expect(res.status).toBe(400)
      expect(mocks.resolveRouteAuth).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/motie/deliberate', () => {
    it('non-admin → 403 motie_closed before rate limit or charge', async () => {
      mocks.resolveRouteAuth.mockResolvedValue({
        user: { id: 'u1', email: 'user@example.com' },
        error: null,
      })
      const { POST } = await import('@/app/api/motie/deliberate/route')
      const res = await POST(
        post('/api/motie/deliberate', { action: 'start', question: '찬반 안건' }),
      )
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'motie_closed' })
      expect(mocks.checkRateLimit).not.toHaveBeenCalled()
      expect(mocks.deductCreditsBalance).not.toHaveBeenCalled()
      expect(mocks.gatherJejuSnapshot).not.toHaveBeenCalled()
    })

    it('admin passes the close gate (not 403)', async () => {
      mocks.resolveRouteAuth.mockResolvedValue({
        user: { id: 'admin', email: ADMIN_EMAIL },
        error: null,
      })
      const { POST } = await import('@/app/api/motie/deliberate/route')
      const res = await POST(post('/api/motie/deliberate', { action: 'unknown-stage' }))
      expect(res.status).not.toBe(403)
    })

    it('still refuses league roundId before auth', async () => {
      const { POST } = await import('@/app/api/motie/deliberate/route')
      const res = await POST(
        post('/api/motie/deliberate', { action: 'start', roundId: 'r1', question: 'x' }),
      )
      expect(res.status).toBe(400)
      expect(mocks.resolveRouteAuth).not.toHaveBeenCalled()
    })
  })
})
