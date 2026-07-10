'use client'

/**
 * 생활 정보 · 실무 안내 — category grid (준비 중 stubs).
 *
 * Self-contained for the 동반자 submission: inline styles, no external UI/i18n
 * modules. Matches the care palette.
 */

import Link from 'next/link'

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  border: '#B7CDD6',
  muted: '#6B7A88',
}

const CATEGORIES = [
  { id: 'housing', icon: '🏠', label: '주거·임대' },
  { id: 'jobs', icon: '💼', label: '일자리·창업' },
  { id: 'childcare', icon: '🧒', label: '육아·교육' },
  { id: 'transport', icon: '🚗', label: '교통·면허' },
  { id: 'health', icon: '🩺', label: '건강·의료' },
  { id: 'admin', icon: '📋', label: '민원·행정' },
] as const

export default function PracticalPage() {
  return (
    <div style={styles.root}>
      <main style={styles.frame}>
        <div style={styles.topBar}>
          <Link href="/care" style={styles.backLink} aria-label="처음으로 돌아가기">
            ↩ 처음으로
          </Link>
        </div>
        <header style={styles.header}>
          <h1 style={styles.h1}>생활 정보 · 실무 안내</h1>
        </header>
        <div style={styles.grid}>
          {CATEGORIES.map((cat) => (
            <div key={cat.id} style={styles.card}>
              <span style={styles.cardIcon} aria-hidden>{cat.icon}</span>
              <span style={styles.cardLabel}>{cat.label}</span>
              <span style={styles.badge}>준비 중</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100dvh',
    background: C.bg,
    color: C.ink,
    fontFamily:
      "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex',
    justifyContent: 'center',
    padding: '0 16px 40px',
    boxSizing: 'border-box',
  },
  frame: { width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 18 },
  topBar: { display: 'flex', paddingTop: 12, paddingBottom: 4 },
  backLink: {
    fontSize: 21, fontWeight: 700, color: C.sea, textDecoration: 'none',
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, padding: '10px 18px',
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  h1: { fontSize: 32, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 },
  card: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
    background: C.surface, border: `2px solid ${C.border}`, borderRadius: 18,
    padding: '24px 12px', minHeight: 130, justifyContent: 'center',
  },
  cardIcon: { fontSize: 46, lineHeight: 1 },
  cardLabel: { fontSize: 22, fontWeight: 800, color: C.ink, textAlign: 'center' },
  badge: {
    fontSize: 16, fontWeight: 700, color: C.muted,
    border: `1px solid ${C.border}`, borderRadius: 999, padding: '2px 12px',
  },
}
