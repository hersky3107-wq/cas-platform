'use client'

import type React from 'react'

/**
 * FriendlyErrors — shared resident-chip error notice.
 *
 * Consumes the errors[] array from any resident API payload and renders
 * a SINGLE friendly Korean message inside a collapsible <details> widget.
 * Raw technical strings are NEVER shown to end users — they stay in the
 * payload's errors[] for server-side logging only.
 *
 * Usage:
 *   <FriendlyErrors errors={data.errors} />
 *   → nothing when empty
 *   → friendly accordion when errors exist
 */

// Maps error key-prefixes (before the first ':' or '(') → Korean section labels
const LABELS: [RegExp, string][] = [
  [/^dust/i, '미세먼지 정보'],
  [/^kamis/i, '실시간 시세'],
  [/^bus/i, '버스 도착 정보'],
  [/^(tide|sun)/i, '물때·일몰 정보'],
  [/^(marine|wave|beach)/i, '해양 날씨 정보'],
  [/^warn/i, '기상특보'],
  [/^(forecast|weather)/i, '날씨 예보'],
  [/^flight/i, '항공 정보'],
  [/^(ferry|ship)/i, '여객선 정보'],
  [/^welfare/i, '복지 공고'],
  [/^(route|ai)/i, 'AI 응답'],
  [/^(news|rss|article)/i, '뉴스 정보'],
  [/^(event|festival|performance)/i, '행사 정보'],
  [/^(context|search|pplx)/i, '검색 정보'],
  [/^(subsidy|gov24)/i, '복지 공고'],
  [/^fallback/i, '보조 정보'],
]

function affectedLabels(errors: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of errors) {
    // Extract the prefix before ':', '(' or whitespace
    const prefix = e.split(/[:(]/)[0].trim()
    for (const [re, label] of LABELS) {
      if (re.test(prefix) && !seen.has(label)) {
        seen.add(label)
        out.push(label)
        break
      }
    }
  }
  return out
}

export function FriendlyErrors({ errors }: { errors: string[] }): React.ReactNode {
  if (!errors.length) return null

  const labels = affectedLabels(errors)
  const affected = labels.length > 0 ? labels.join(', ') : null
  const msg = affected
    ? `${affected}를 지금 불러올 수 없어요. 잠시 후 다시 시도해 주세요.`
    : '일부 정보는 지금 불러올 수 없어요. 잠시 후 다시 시도해 주세요.'

  return (
    <details style={styles.details}>
      <summary style={styles.summary}>⚠ 일부 정보를 불러오지 못했어요</summary>
      <p style={styles.msg}>{msg}</p>
    </details>
  )
}

const styles: Record<string, React.CSSProperties> = {
  details: {
    background: '#FFFBEB',
    border: '1.5px solid #FCD34D',
    borderRadius: 10,
    padding: '6px 10px',
  },
  summary: {
    fontSize: 13,
    fontWeight: 700,
    color: '#92400E',
    cursor: 'pointer',
    userSelect: 'none',
  },
  msg: {
    fontSize: 13,
    color: '#78350F',
    margin: '4px 0 0',
    lineHeight: 1.5,
  },
}
