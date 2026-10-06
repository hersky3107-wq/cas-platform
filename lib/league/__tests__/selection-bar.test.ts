import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { KrSelectionBar, type KrUniverseRow } from '@/components/league/KrUniverseChipBrowser'
import { LEAGUE_GENERATE_CREDITS } from '../credits'
import { getLeagueUiPack } from '../i18n/dictionary'
import { cardMissPhase, selectionActionCopy, selectionBarAction, selectionPhaseFromCard } from '../selection-action'

const horizonLabels = { '1d': '1일', '1w': '1주', '1m': '1개월', '3m': '3개월' } as const
const krRow: KrUniverseRow = {
  market: 'KOSPI',
  code: '009150',
  name: '삼성전기',
  groupId: 'semis',
  popularityRank: 1,
  instrument: 'KRSTOCK:KOSPI:009150',
}

const ko = getLeagueUiPack('ko')

function bar(action: Parameters<typeof selectionActionCopy>[1]) {
  const copy = selectionActionCopy(ko, action, LEAGUE_GENERATE_CREDITS)
  return renderToStaticMarkup(
    createElement(KrSelectionBar, {
      selected: krRow,
      showHorizons: true,
      horizon: '1w',
      horizonLabels,
      pendingNotice: null,
      onPickHorizon: () => {},
      onClose: () => {},
      actionLabel: copy.text,
      actionEnabled: copy.enabled,
      actionEta: copy.eta,
      onAction: () => {},
    }),
  )
}

describe('bottom selection bar', () => {
  it('shows an enabled generate button for a KR stock with no round', () => {
    const action = selectionBarAction({ phase: 'missing' })
    expect(action).toEqual({ kind: 'generate' })
    const html = bar(action)
    const button = html.match(/<button[^>]*data-testid="instrument-action"[^>]*>[\s\S]*?<\/button>/)?.[0] ?? ''
    expect(button).toContain('AI 40개 예측 생성')
    expect(button).toContain(String(LEAGUE_GENERATE_CREDITS))
    expect(button).not.toContain('disabled')
    expect(html).toContain('삼성전기')
    expect(html).toContain('1주')
  })

  it('renders exactly one primary action for each card state', () => {
    const open = bar(selectionBarAction({ phase: 'locked', roundId: 'round-1' }))
    expect(open.match(/data-testid="instrument-action"/g)).toHaveLength(1)
    expect(open).toContain(ko.hub.openRound(LEAGUE_GENERATE_CREDITS))
    expect(open).not.toMatch(/data-testid="instrument-action"[^>]*disabled/)

    const view = bar(selectionBarAction({ phase: 'open' }))
    expect(view).toContain('카드 보기')
    expect(view).not.toMatch(/data-testid="instrument-action"[^>]*disabled/)

    const queued = bar(selectionBarAction({ phase: 'queued', queuePosition: 3, etaMinutes: 10 }))
    expect(queued).toContain('생성 중 · 대기 3번째')
    expect(queued).toContain('대기 3번째 · 약 10분')
    expect(queued).toMatch(/data-testid="instrument-action"[^>]*disabled/)

    const blocked = bar(selectionBarAction({ phase: 'unavailable', reason: '기준가를 아직 확인할 수 없습니다. 잠시 후 다시 시도하세요.' }))
    expect(blocked).toContain('기준가를 아직 확인할 수 없습니다')
    expect(blocked).toMatch(/data-testid="instrument-action"[^>]*disabled/)
    expect(blocked).not.toContain('AI 40개 예측 생성')
  })

  it('treats a bare no_round as generate and a market refusal as a disabled reason', () => {
    expect(selectionBarAction(cardMissPhase('no_round', null))).toEqual({ kind: 'generate' })
    const refused = selectionBarAction(
      cardMissPhase('no_round', '기준가를 아직 확인할 수 없습니다. 잠시 후 다시 시도하세요.'),
    )
    expect(refused.kind).toBe('unavailable')
    expect(selectionPhaseFromCard({ kind: 'none' })).toEqual({ phase: 'missing' })
    expect(selectionPhaseFromCard({ kind: 'locked', lockedRoundId: 'abc' })).toEqual({
      phase: 'locked',
      roundId: 'abc',
    })
    expect(selectionPhaseFromCard({ kind: 'locked', lockedRoundId: null })).toEqual({
      phase: 'locked',
      roundId: null,
    })
    expect(selectionBarAction({ phase: 'locked', roundId: null })).toEqual({ kind: 'generate' })
    expect(selectionPhaseFromCard({ kind: 'card', generationStatus: null })).toEqual({ phase: 'open' })
    expect(
      selectionPhaseFromCard({ kind: 'card', generationStatus: 'queued', queuePosition: 2, etaMinutes: 8 }),
    ).toMatchObject({ phase: 'queued', queuePosition: 2 })
  })
})
