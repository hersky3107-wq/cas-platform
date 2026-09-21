import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  formatOfficialFestivalsForPrompt,
  overlapInclusiveDays,
  parseYmdParts,
  stripFestivalBenchmarkChatOffer,
  type OfficialFestivalSearchResult,
} from '@/lib/festival/connectors'

function y(s: string) {
  const p = parseYmdParts(s)
  if (!p) throw new Error(s)
  return p
}

describe('overlapInclusiveDays', () => {
  it('counts inclusive overlap between plan buffer and event', () => {
    expect(overlapInclusiveDays(y('20261009'), y('20261011'), y('20260925'), y('20261018'))).toBe(3)
    expect(overlapInclusiveDays(y('20260924'), y('20261024'), y('20260925'), y('20261018'))).toBe(24)
    expect(overlapInclusiveDays(y('20260101'), y('20260102'), y('20261002'), y('20261011'))).toBe(0)
  })

  it('treats same-day ranges as 1', () => {
    expect(overlapInclusiveDays(y('20261002'), y('20261002'), y('20261002'), y('20261002'))).toBe(1)
  })
})

describe('formatOfficialFestivalsForPrompt', () => {
  const base: Extract<OfficialFestivalSearchResult, { ok: true }> = {
    ok: true,
    events: [
      {
        title: '경주 대릉원돌담길 축제',
        addr: '경상북도 경주시 황남동',
        eventStartDate: '20260403',
        eventEndDate: '20260405',
        contentId: '1',
        typeMatch: false,
        seasonalDistance: 6,
      },
    ],
    areaName: '경상북도',
    sigunguName: '경주시',
    windowStart: '20240921',
    windowEnd: '20260921',
    fallbackUsed: false,
    conflicts: [],
    conflictQueryStart: '20260902',
  }

  it('puts clash lines under the TourAPI label and does not claim province fallback', () => {
    const text = formatOfficialFestivalsForPrompt({
      ...base,
      conflicts: [
        {
          title: '신라문화제',
          addr: '경상북도 경주시 노동동',
          eventStartDate: '20261009',
          eventEndDate: '20261011',
          overlapDays: 3,
          kind: 'current',
        },
      ],
    })
    const lines = text.split('\n')
    expect(lines[0]).toBe('[공식 데이터 — 한국관광공사 TourAPI]')
    expect(lines[1]).toBe(
      '⚠ 개최 시기 충돌 (공사 데이터): 신라문화제 (20261009~20261011, 경상북도 경주시 노동동) — 계획 기간과 3일 겹침'
    )
    expect(text).toContain('경상북도 경주시')
    expect(text).not.toContain('전역으로 대체')
    expect(text).toContain('경주 대릉원돌담길 축제')
  })

  it('prints the none-clash line with the query as-of date', () => {
    const text = formatOfficialFestivalsForPrompt(base)
    expect(text.split('\n')[1]).toBe(
      '개최 시기 충돌: 같은 시군구·같은 기간 공사 등록 행사 없음 (조회 기준일 2026-09-02)'
    )
  })
})

describe('stripFestivalBenchmarkChatOffer', () => {
  it('drops lines that start with 원하시면', () => {
    const raw = ['경주 성과 요약입니다.', '', '원하시면 다른 축제도 찾아드릴까요?', '원하시면 표로 정리해 드리겠습니다.'].join(
      '\n'
    )
    expect(stripFestivalBenchmarkChatOffer(raw)).toBe('경주 성과 요약입니다.')
  })
})
