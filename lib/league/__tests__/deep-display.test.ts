import { describe, expect, it } from 'vitest'
import type { DeepOpenSnapshot, DeepSnapshot } from '../deep-snapshot'
import {
  collectDeepTranslatableParts,
  deepSectionHeadersFor,
  deepTranslationFingerprint,
  localizeDeepMarkdownHeaders,
  mergeDeepSnapshots,
  overlayDeepTranslations,
  partitionCachedDeepTranslations,
  pendingDebateSeats,
  pendingOpenSeats,
  shouldTranslateDeepLocale,
} from '../deep-display'

const ANALYST_EN = [
  '## Key findings',
  'AAPL is bid on the tape.',
  '',
  '## Evidence from the packets',
  'Close 232.10 vs anchor 230.',
].join('\n')

function openSnap(overrides: Partial<DeepOpenSnapshot> = {}): DeepOpenSnapshot {
  return {
    kind: 'open',
    instrument: 'AAPL',
    proposition: 'Will AAPL close higher?',
    plan: null,
    briefing: '1) Proposition and resolution clock\n24h from the last regular close.',
    analyses: [
      {
        roleId: 'price-a',
        roleLabel: 'Price-path analyst',
        provider: 'openai',
        brand: 'ChatGPT',
        content: ANALYST_EN,
        ok: true,
      },
    ],
    synthesis: [
      '1) Core summary',
      'The packet leans up.',
      '2) Where the analysts agree',
      'Tape is bid.',
    ].join('\n'),
    ...overrides,
  }
}

describe('deep display locale', () => {
  it('skips en and pt for the LLM pass; translates every other league locale', () => {
    expect(shouldTranslateDeepLocale('en')).toBe(false)
    expect(shouldTranslateDeepLocale('pt')).toBe(false)
    expect(shouldTranslateDeepLocale('ko')).toBe(true)
    expect(shouldTranslateDeepLocale('ja')).toBe(true)
    expect(shouldTranslateDeepLocale('zh-TW')).toBe(true)
    expect(shouldTranslateDeepLocale('fr')).toBe(true)
    expect(shouldTranslateDeepLocale('es')).toBe(true)
    expect(shouldTranslateDeepLocale('ar')).toBe(true)
  })

  it('maps Key findings / Evidence to 핵심 발견 / 패킷 근거 for ko', () => {
    const ko = deepSectionHeadersFor('ko')
    expect(ko.keyFindings).toBe('핵심 발견')
    expect(ko.evidence).toBe('패킷 근거')
    const localized = localizeDeepMarkdownHeaders(ANALYST_EN, ko)
    expect(localized).toContain('## 핵심 발견')
    expect(localized).toContain('## 패킷 근거')
    expect(localized).not.toContain('## Key findings')
    expect(localized).not.toContain('## Evidence from the packets')
    expect(localized).toContain('AAPL is bid on the tape.')
  })

  it('localizes numbered synthesis headings and is idempotent', () => {
    const ko = deepSectionHeadersFor('ko')
    const once = localizeDeepMarkdownHeaders(openSnap().synthesis!, ko)
    expect(once).toContain('1) 핵심 요약')
    expect(once).toContain('2) 분석가들이 일치하는 점')
    expect(once).not.toMatch(/Core summary/)
    expect(localizeDeepMarkdownHeaders(once, ko)).toBe(once)
  })

  it('covers all 8 locales with non-empty Key findings / Evidence labels', () => {
    for (const locale of ['en', 'ko', 'ja', 'zh-TW', 'fr', 'es', 'ar', 'pt'] as const) {
      const pack = deepSectionHeadersFor(locale)
      expect(pack.keyFindings.trim().length).toBeGreaterThan(0)
      expect(pack.evidence.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('overlayDeepTranslations', () => {
  it('swaps English markdown headers for a ko viewer before any LLM translation lands', () => {
    const original = openSnap()
    const overlaid = overlayDeepTranslations(original, null, { locale: 'ko', showOriginal: false })
    if (overlaid.kind !== 'open') throw new Error('expected open')
    expect(overlaid.analyses[0]!.content).toContain('## 핵심 발견')
    expect(overlaid.analyses[0]!.content).toContain('## 패킷 근거')
    expect(overlaid.synthesis).toContain('1) 핵심 요약')
    expect(overlaid.briefing).toContain('1) 명제와 판정 시각')
    // Original snapshot is untouched (display-only).
    expect(original.analyses[0]!.content).toContain('## Key findings')
  })

  it('uses cached translations and still safety-nets leftover English headers', () => {
    const overlaid = overlayDeepTranslations(openSnap(), {
      'analysis:price-a': '## Key findings\n테이프가 매수세다.\n\n## Evidence from the packets\n종가 232.10.',
      synthesis: '패킷은 상승 쪽으로 기울었다.',
    }, { locale: 'ko', showOriginal: false })
    if (overlaid.kind !== 'open') throw new Error('expected open')
    expect(overlaid.analyses[0]!.content).toContain('## 핵심 발견')
    expect(overlaid.analyses[0]!.content).toContain('테이프가 매수세다.')
    expect(overlaid.analyses[0]!.content).not.toContain('## Key findings')
    expect(overlaid.synthesis).toBe('패킷은 상승 쪽으로 기울었다.')
  })

  it('keeps English originals when the toggle is on', () => {
    const overlaid = overlayDeepTranslations(openSnap(), {
      'analysis:price-a': '## 핵심 발견\n테이프가 매수세다.',
    }, { locale: 'ko', showOriginal: true })
    if (overlaid.kind !== 'open') throw new Error('expected open')
    expect(overlaid.analyses[0]!.content).toContain('## Key findings')
    expect(overlaid.analyses[0]!.content).not.toContain('핵심 발견')
  })

  it('leaves en viewers on the raw English markdown', () => {
    const overlaid = overlayDeepTranslations(openSnap(), { 'analysis:price-a': 'should not apply' }, {
      locale: 'en',
      showOriginal: false,
    })
    if (overlaid.kind !== 'open') throw new Error('expected open')
    expect(overlaid.analyses[0]!.content).toBe(ANALYST_EN)
  })
})

describe('collectDeepTranslatableParts', () => {
  it('collects briefing, per-analyst briefs, and synthesis', () => {
    const parts = collectDeepTranslatableParts(openSnap())
    expect(parts.map((p) => p.key)).toEqual(['briefing', 'analysis:price-a', 'synthesis'])
    expect(deepTranslationFingerprint(openSnap()).length).toBeGreaterThan(0)
    expect(deepTranslationFingerprint(null)).toBe('')
  })

  it('fingerprint changes when a new analyst brief arrives', () => {
    const first = deepTranslationFingerprint(openSnap({ analyses: [] }))
    const second = deepTranslationFingerprint(openSnap())
    expect(first).not.toBe(second)
  })

  it('does not retranslate when source_hash matches the cached original', () => {
    const parts = collectDeepTranslatableParts(openSnap())
    const hash = (text: string) => `h:${text.length}`
    const { translations, missing } = partitionCachedDeepTranslations(
      parts,
      parts.map((part) => ({
        part_key: part.key,
        translated_text: `KO:${part.key}`,
        source_hash: hash(part.text),
      })),
      hash
    )
    expect(missing).toEqual([])
    expect(translations['analysis:price-a']).toBe('KO:analysis:price-a')
    expect(translations.synthesis).toBe('KO:synthesis')
  })

  it('retranslates a part whose source_hash no longer matches', () => {
    const parts = collectDeepTranslatableParts(openSnap())
    const { missing } = partitionCachedDeepTranslations(
      parts,
      [{ part_key: 'synthesis', translated_text: 'old', source_hash: 'stale' }],
      (text) => `h:${text.length}`
    )
    expect(missing.map((p) => p.key)).toEqual(['briefing', 'analysis:price-a', 'synthesis'])
  })
})

describe('debate overlay keys', () => {
  it('localizes chair markdown headings in the verdict', () => {
    const snap: DeepSnapshot = {
      kind: 'debate',
      instrument: 'AAPL',
      proposition: 'Will AAPL close higher?',
      plan: null,
      briefing: null,
      rounds: [],
      vote: null,
      verdict: {
        judgment: '## Judgment\nUp is live.\n## Key issues\nTape vs. research.',
        keyIssues: null,
        minorityReport: '## Minority report\nOne seat held down.',
        consensusScore: 62,
      },
    }
    const overlaid = overlayDeepTranslations(snap, null, { locale: 'ko', showOriginal: false })
    if (overlaid.kind !== 'debate') throw new Error('expected debate')
    expect(overlaid.verdict?.judgment).toContain('## 판정')
    expect(overlaid.verdict?.judgment).toContain('## 쟁점')
    expect(overlaid.verdict?.minorityReport).toContain('## 소수 의견')
  })
})

describe('mergeDeepSnapshots arrival order', () => {
  it('keeps the first-seen analyst and appends later arrivals', () => {
    const first = openSnap({
      analyses: [
        {
          roleId: 'price-a',
          roleLabel: 'Price-path analyst',
          provider: 'openai',
          brand: 'ChatGPT',
          content: ANALYST_EN,
          ok: true,
        },
      ],
    })
    const second = openSnap({
      analyses: [
        {
          roleId: 'risk',
          roleLabel: 'Risk analyst',
          provider: 'xai',
          brand: 'Grok',
          content: '## Key findings\nTail risk.',
          ok: true,
        },
      ],
    })
    const merged = mergeDeepSnapshots(first, second)
    if (merged?.kind !== 'open') throw new Error('expected open')
    expect(merged.analyses.map((a) => a.roleId)).toEqual(['price-a', 'risk'])
    expect(merged.analyses[0]!.content).toContain('AAPL is bid')
  })

  it('does not drop a brief if a later poll omits it', () => {
    const first = openSnap()
    const later = openSnap({ analyses: [] })
    const merged = mergeDeepSnapshots(first, later)
    if (merged?.kind !== 'open') throw new Error('expected open')
    expect(merged.analyses).toHaveLength(1)
    expect(merged.analyses[0]!.roleId).toBe('price-a')
  })

  it('lists pending open seats after arrived ones', () => {
    const snap = openSnap({
      plan: [
        {
          roleId: 'price-a',
          roleLabel: 'Price-path analyst',
          provider: 'openai',
          brand: 'ChatGPT',
          subQuestion: 'What moved?',
        },
        {
          roleId: 'risk',
          roleLabel: 'Risk analyst',
          provider: 'xai',
          brand: 'Grok',
          subQuestion: 'What breaks?',
        },
      ],
    })
    expect(pendingOpenSeats(snap).map((s) => s.roleId)).toEqual(['risk'])
  })

  it('lists debate seats that have not spoken in the live round', () => {
    const snap: DeepSnapshot = {
      kind: 'debate',
      instrument: 'AAPL',
      proposition: 'Will AAPL close higher?',
      plan: [
        { roleId: 'a', roleLabel: 'A', provider: 'openai', brand: 'ChatGPT', mandate: 'm' },
        { roleId: 'b', roleLabel: 'B', provider: 'xai', brand: 'Grok', mandate: 'm' },
      ],
      briefing: null,
      rounds: [
        {
          roundNumber: 1,
          consensusScore: -1,
          summary: '',
          turns: [
            {
              roleLabel: 'A',
              provider: 'openai',
              brand: 'ChatGPT',
              position: 'Up.',
              concedes: null,
              holds: null,
              ok: true,
            },
          ],
        },
      ],
      vote: null,
      verdict: null,
    }
    if (snap.kind !== 'debate') throw new Error('expected debate')
    expect(pendingDebateSeats(snap).map((s) => s.provider)).toEqual(['xai'])
  })
})
