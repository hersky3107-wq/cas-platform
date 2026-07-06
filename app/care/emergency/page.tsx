'use client'

/**
 * 긴급·상담 전화 — national emergency & help directory.
 *
 * Sections:
 *   - 긴급 (red):   119 구급 / 112 경찰  (direct tap-to-call, user is here on purpose)
 *   - 상담 (calm):  129 보건복지상담 / 노인학대 신고 1577-1389
 *   - 가족:         one family number saved on THIS device (localStorage, no DB/login)
 *   - 우리 지역 행정복지센터: residence-based guidance. We do NOT have a verified
 *     nationwide directory of per-center direct lines, so instead of inventing
 *     numbers we show the user's region and route them via the national
 *     정부민원안내 110 / 보건복지상담 129 lines (both real, nationwide).
 *
 * All phone numbers are public/documented and nationwide.
 *
 * Accessibility: large text (≥24px), high contrast, ≥60px tap targets, TTS,
 * reduced-motion, focus-visible, persistent 처음으로/메뉴 bar. No DB.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getResidence, DEFAULT_RESIDENCE, shortLabel, type Residence } from '@/lib/care/residence'

// ── Theme (shared with medical/photo pages) ────────────────────────────────────

const C = {
  bg: '#E8F2F5',
  surface: '#FFFFFF',
  ink: '#0F2233',
  inkSoft: '#33475B',
  sea: '#0A5C7A',
  seaStrong: '#07445B',
  focus: '#C2410C',
  muted: '#6B7A88',
  warnBg: '#FDECEC',
  warnBorder: '#C0392B',
  warnInk: '#8A241A',
  calmBg: '#EAF4F8',
}

// ── Public nationwide help numbers ──────────────────────────────────────────────

const GOV_INFO_LINE = '110' // 정부민원안내콜센터 (전국)
const WELFARE_LINE = '129' // 보건복지상담센터 (전국)

// ── localStorage (family number) ───────────────────────────────────────────────

const LS_NAME = 'resident.family.name'
const LS_PHONE = 'resident.family.phone'

function loadFamily(): { name: string; phone: string } | null {
  try {
    if (typeof window === 'undefined') return null
    const phone = window.localStorage.getItem(LS_PHONE) ?? ''
    if (!phone.trim()) return null
    const name = window.localStorage.getItem(LS_NAME) ?? ''
    return { name, phone }
  } catch {
    return null
  }
}

function saveFamily(name: string, phone: string): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.setItem(LS_PHONE, phone)
    window.localStorage.setItem(LS_NAME, name)
    return true
  } catch {
    return false
  }
}

// ── Types ───────────────────────────────────────────────────────────────────────

type View = 'main' | 'family-edit'

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmergencyPage() {
  const router = useRouter()

  const [view, setView] = useState<View>('main')
  const [ttsSupported, setTtsSupported] = useState(false)

  const [family, setFamily] = useState<{ name: string; phone: string } | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const [residence, setResidenceState] = useState<Residence>(DEFAULT_RESIDENCE)

  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
    setFamily(loadFamily())
    setResidenceState(getResidence() ?? DEFAULT_RESIDENCE)
  }, [])

  // ── TTS ──────────────────────────────────────────────────────────────────────

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || typeof window === 'undefined' || !text) return
      try {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'ko-KR'
        u.rate = 0.92
        window.speechSynthesis.speak(u)
      } catch {
        /* no-op */
      }
    },
    [ttsSupported]
  )

  const stopSpeaking = useCallback(() => {
    if (ttsSupported && typeof window !== 'undefined') {
      try { window.speechSynthesis.cancel() } catch { /* no-op */ }
    }
  }, [ttsSupported])

  useEffect(() => () => stopSpeaking(), [stopSpeaking])

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goHome = useCallback(() => {
    stopSpeaking()
    router.push('/care')
  }, [router, stopSpeaking])

  const goMedical = useCallback(() => {
    stopSpeaking()
    router.push('/care/medical')
  }, [router, stopSpeaking])

  const backToMain = useCallback(() => {
    stopSpeaking()
    setView('main')
    setSaveError(null)
  }, [stopSpeaking])

  // ── Family edit ──────────────────────────────────────────────────────────────

  const openFamilyEdit = useCallback(() => {
    stopSpeaking()
    setEditName(family?.name ?? '')
    setEditPhone(family?.phone ?? '')
    setSaveError(null)
    setView('family-edit')
  }, [family, stopSpeaking])

  const submitFamily = useCallback(() => {
    const phone = editPhone.trim()
    const name = editName.trim()
    if (!phone) {
      setSaveError('전화번호를 넣어 주세요.')
      return
    }
    const ok = saveFamily(name, phone)
    if (!ok) {
      setSaveError('이 기기에서는 저장이 어려워요. 그래도 지금 바로 전화는 하실 수 있어요.')
      return
    }
    setFamily({ name, phone })
    setSaveError(null)
    setView('main')
    speak('가족 번호를 저장했어요.')
  }, [editName, editPhone, speak])

  const telDigits = (s: string) => s.replace(/[^0-9+]/g, '')

  const mainNarration =
    `긴급하고 상담이 필요할 때 거는 전화입니다. 119 구급, 112 경찰, 129 보건복지 상담, 노인학대 신고, 가족 전화를 고를 수 있어요. ${shortLabel(residence)} 행정복지센터 문의는 정부민원안내 110번으로 도와드려요.`

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        {/* Persistent top bar */}
        <div style={styles.topBar}>
          <button type="button" className="em-ctrl" style={styles.ctrlBtn} onClick={goHome} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
          <button type="button" className="em-ctrl" style={styles.ctrlBtn} onClick={goMedical} aria-label="병원·약 메뉴로">
            <span aria-hidden>≡</span> 메뉴
          </button>
        </div>

        {/* ── MAIN ─────────────────────────────────────────────────────────── */}
        {view === 'main' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🆘</span>
              <h1 style={styles.h1}>긴급·상담 전화</h1>
              {ttsSupported && (
                <button type="button" className="em-read" style={styles.readBtn} onClick={() => speak(mainNarration)} aria-label="이 화면 읽어주기">
                  <span aria-hidden>🔊</span> 읽어주기
                </button>
              )}
            </header>

            {/* 긴급 group */}
            <section style={styles.group} aria-label="긴급 전화">
              <h2 style={{ ...styles.groupTitle, color: C.warnInk }}>긴급할 때</h2>
              <a href="tel:119" className="em-call" style={{ ...styles.callBtn, ...styles.callRed }} aria-label="119 구급 전화하기">
                <span style={styles.callEmoji} aria-hidden>🚑</span>
                <span style={styles.callTextWrap}>
                  <span style={styles.callTitle}>119 구급</span>
                  <span style={styles.callSub}>불이 나거나 많이 아플 때</span>
                </span>
                <span style={styles.callPhone} aria-hidden>119</span>
              </a>
              <a href="tel:112" className="em-call" style={{ ...styles.callBtn, ...styles.callRed }} aria-label="112 경찰 전화하기">
                <span style={styles.callEmoji} aria-hidden>🚔</span>
                <span style={styles.callTextWrap}>
                  <span style={styles.callTitle}>112 경찰</span>
                  <span style={styles.callSub}>위험하거나 도움이 필요할 때</span>
                </span>
                <span style={styles.callPhone} aria-hidden>112</span>
              </a>
            </section>

            {/* 상담 group */}
            <section style={styles.group} aria-label="상담 전화">
              <h2 style={{ ...styles.groupTitle, color: C.sea }}>상담이 필요할 때</h2>
              <a href="tel:129" className="em-call" style={{ ...styles.callBtn, ...styles.callCalm }} aria-label="129 보건복지상담 전화하기">
                <span style={styles.callEmoji} aria-hidden>📞</span>
                <span style={styles.callTextWrap}>
                  <span style={{ ...styles.callTitle, color: C.ink }}>129 보건복지상담</span>
                  <span style={{ ...styles.callSub, color: C.inkSoft }}>복지·생활이 힘들 때</span>
                </span>
                <span style={{ ...styles.callPhone, color: C.sea }} aria-hidden>129</span>
              </a>
              <a href="tel:15771389" className="em-call" style={{ ...styles.callBtn, ...styles.callCalm }} aria-label="노인학대 신고 1577-1389 전화하기">
                <span style={styles.callEmoji} aria-hidden>📞</span>
                <span style={styles.callTextWrap}>
                  <span style={{ ...styles.callTitle, color: C.ink }}>노인학대 신고</span>
                  <span style={{ ...styles.callSub, color: C.inkSoft }}>1577-1389 · 힘든 일을 겪을 때</span>
                </span>
                <span style={{ ...styles.callPhone, color: C.sea, fontSize: 22 }} aria-hidden>1577-1389</span>
              </a>
            </section>

            {/* 가족 group */}
            <section style={styles.group} aria-label="가족 전화">
              <h2 style={{ ...styles.groupTitle, color: C.ink }}>가족에게</h2>
              {family ? (
                <>
                  <a href={`tel:${telDigits(family.phone)}`} className="em-call" style={{ ...styles.callBtn, ...styles.callFamily }} aria-label={`${family.name || '가족'}에게 전화하기`}>
                    <span style={styles.callEmoji} aria-hidden>👨‍👩‍👧</span>
                    <span style={styles.callTextWrap}>
                      <span style={styles.callTitle}>{family.name ? `${family.name}에게 전화` : '가족에게 전화'}</span>
                      <span style={styles.callSub}>{family.phone}</span>
                    </span>
                    <span style={styles.callPhone} aria-hidden>📞</span>
                  </a>
                  <button type="button" className="em-edit" style={styles.editBtn} onClick={openFamilyEdit} aria-label="가족 번호 고치기">
                    <span aria-hidden>✏️</span> 고치기
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="em-primary" style={styles.primaryBtn} onClick={openFamilyEdit} aria-label="가족 번호 넣기">
                    <span aria-hidden>➕</span> 가족 번호 넣기
                  </button>
                  <p style={styles.helpNote}>
                    직접 넣기 어려우면 가족이나 가까운 분께 한 번만 넣어달라고 부탁하세요.
                  </p>
                </>
              )}
            </section>

            {/* 우리 지역 행정복지센터 (residence-based guidance) */}
            <section style={styles.group} aria-label="우리 지역 행정복지센터">
              <h2 style={{ ...styles.groupTitle, color: C.ink }}>우리 지역 행정복지센터</h2>
              <p style={styles.helpNote}>
                <strong>{shortLabel(residence)}</strong> 행정복지센터(주민센터)에서 복지·생활 문의를 하실 수 있어요.
                번호를 모르시면 아래 <strong>정부민원안내 110</strong> 또는 <strong>보건복지상담 129</strong>로 전화하시면 안내해 드려요.
              </p>
              <a href={`tel:${GOV_INFO_LINE}`} className="em-call" style={{ ...styles.callBtn, ...styles.callCalm }} aria-label="정부민원안내 110 전화하기">
                <span style={styles.callEmoji} aria-hidden>🏢</span>
                <span style={styles.callTextWrap}>
                  <span style={{ ...styles.callTitle, color: C.ink }}>정부민원안내 110</span>
                  <span style={{ ...styles.callSub, color: C.inkSoft }}>우리 지역 주민센터·행정 안내</span>
                </span>
                <span style={{ ...styles.callPhone, color: C.sea }} aria-hidden>110</span>
              </a>
            </section>
          </>
        )}

        {/* ── FAMILY EDIT ─────────────────────────────────────────────────── */}
        {view === 'family-edit' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>👨‍👩‍👧</span>
              <h1 style={styles.h1}>가족 번호 넣기</h1>
            </header>
            <section style={styles.card}>
              {ttsSupported && (
                <button type="button" className="em-read" style={styles.readBtn} onClick={() => speak('가족 이름과 전화번호를 넣고 저장을 누르세요. 이름은 안 넣어도 괜찮아요.')} aria-label="안내 읽어주기">
                  <span aria-hidden>🔊</span> 읽어주기
                </button>
              )}

              {saveError && <p style={styles.errorLine} role="alert">{saveError}</p>}

              <label style={styles.inputLabel} htmlFor="fam-name">가족 이름 <span style={{ color: C.muted, fontWeight: 500 }}>(안 넣어도 돼요)</span></label>
              <input
                id="fam-name"
                className="em-input"
                style={styles.input}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="예: 큰딸, 아들"
                inputMode="text"
                autoComplete="off"
              />

              <label style={styles.inputLabel} htmlFor="fam-phone">전화번호</label>
              <input
                id="fam-phone"
                className="em-input"
                style={styles.input}
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="예: 010-1234-5678"
                inputMode="tel"
                autoComplete="tel"
              />

              <button
                type="button"
                className="em-primary"
                style={editPhone.trim() ? styles.primaryBtn : { ...styles.primaryBtn, opacity: 0.45, cursor: 'not-allowed' }}
                onClick={submitFamily}
                disabled={!editPhone.trim()}
                aria-disabled={!editPhone.trim()}
              >
                <span aria-hidden>💾</span> 저장
              </button>
              <button type="button" className="em-ctrl" style={styles.ctrlBtnWide} onClick={backToMain} aria-label="취소하고 돌아가기">
                취소
              </button>
              <p style={styles.helpNote}>
                번호는 이 휴대폰에만 저장돼요. 다른 곳으로 보내지 않아요.
              </p>
            </section>
          </>
        )}

      </main>
    </div>
  )
}

// ── Styles ─────────────────────────────────────────────────────────────────────

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
  topBar: {
    display: 'flex', justifyContent: 'space-between', gap: 12,
    position: 'sticky', top: 0, background: C.bg, paddingTop: 10, paddingBottom: 8, zIndex: 5,
  },
  ctrlBtn: {
    flex: 1, minHeight: 58, fontSize: 21, fontWeight: 700, color: C.ink,
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer', padding: '6px 12px',
  },
  ctrlBtnWide: {
    width: '100%', minHeight: 62, fontSize: 22, fontWeight: 800, color: C.ink,
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer', padding: '8px 16px',
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  headerEmoji: { fontSize: 46, lineHeight: 1 },
  h1: { fontSize: 34, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.25 },
  readBtn: {
    alignSelf: 'center', minHeight: 60, fontSize: 22, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `3px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '8px 26px',
  },
  // groups
  group: { display: 'flex', flexDirection: 'column', gap: 12 },
  groupTitle: { fontSize: 24, fontWeight: 900, margin: '2px 0 0' },
  // call buttons (big tap-to-call)
  callBtn: {
    display: 'flex', alignItems: 'center', gap: 16,
    width: '100%', minHeight: 96, boxSizing: 'border-box',
    borderRadius: 18, padding: '16px 20px', textDecoration: 'none',
    boxShadow: '0 4px 14px rgba(15,34,51,0.10)',
  },
  callRed: { background: C.warnBorder, border: `4px solid ${C.warnInk}` },
  callCalm: { background: C.calmBg, border: `3px solid ${C.sea}` },
  callFamily: { background: C.sea, border: `4px solid ${C.seaStrong}` },
  callEmoji: { fontSize: 42, lineHeight: 1, flexShrink: 0 },
  callTextWrap: { display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 },
  callTitle: { fontSize: 28, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.2 },
  callSub: { fontSize: 19, fontWeight: 600, color: '#FFE8E3', lineHeight: 1.35 },
  callPhone: { fontSize: 30, fontWeight: 900, color: '#FFFFFF', flexShrink: 0 },
  // family / center primary
  primaryBtn: {
    minHeight: 76, fontSize: 26, fontWeight: 800, color: '#FFFFFF', background: C.sea,
    border: 'none', borderRadius: 16, cursor: 'pointer', padding: '12px 20px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  editBtn: {
    minHeight: 60, fontSize: 21, fontWeight: 700, color: C.sea, background: '#FFFFFF',
    border: `2px solid ${C.sea}`, borderRadius: 14, cursor: 'pointer', padding: '8px 18px',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  helpNote: {
    fontSize: 19, lineHeight: 1.55, color: C.inkSoft, margin: 0,
    background: '#F0F5F8', borderRadius: 12, padding: '12px 14px',
  },
  // card / inputs
  card: {
    background: C.surface, borderRadius: 20, padding: '24px 22px 28px',
    display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  errorLine: { fontSize: 20, color: C.warnInk, fontWeight: 700, margin: 0, textAlign: 'center' },
  inputLabel: { fontSize: 21, fontWeight: 800, color: C.ink, margin: '4px 0 -4px' },
  input: {
    fontSize: 24, lineHeight: 1.4, color: C.ink,
    background: '#FAFCFD', border: `3px solid ${C.sea}`, borderRadius: 14,
    padding: '14px 16px', width: '100%', boxSizing: 'border-box', minHeight: 64,
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif",
  },
  // city picker
  cityRow: { display: 'flex', gap: 14 },
  kindBtn: {
    flex: 1, minHeight: 96, fontSize: 30, fontWeight: 900,
    color: '#FFFFFF', background: C.sea, border: `3px solid ${C.seaStrong}`,
    borderRadius: 18, cursor: 'pointer',
  },
  // dong list
  dongNote: {
    fontSize: 21, lineHeight: 1.55, color: C.inkSoft, margin: 0, textAlign: 'center',
    background: '#FFF6DE', border: '2px solid #B7791F', borderRadius: 14, padding: '14px 16px',
  },
  dongList: { display: 'flex', flexDirection: 'column', gap: 12 },
  dongBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    width: '100%', minHeight: 74, boxSizing: 'border-box',
    background: C.surface, border: `3px solid ${C.sea}`, borderRadius: 16,
    padding: '14px 20px', textDecoration: 'none',
  },
  dongName: { fontSize: 26, fontWeight: 900, color: C.ink },
  dongPhone: { fontSize: 20, fontWeight: 700, color: C.sea, flexShrink: 0 },
}

const GLOBAL_CSS = `
  .em-ctrl:focus-visible, .em-read:focus-visible, .em-call:focus-visible,
  .em-primary:focus-visible, .em-edit:focus-visible, .em-kind:focus-visible,
  .em-input:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .em-input:focus { outline: 4px solid ${C.sea}; outline-offset: 0; border-color: ${C.seaStrong} !important; }
  .em-primary:hover:not(:disabled) { background: ${C.seaStrong}; }
  .em-primary:disabled { cursor: not-allowed !important; }
  .em-kind:hover { background: ${C.seaStrong}; }
  .em-call:hover { filter: brightness(0.96); }
  .em-ctrl, .em-read, .em-call, .em-primary, .em-edit, .em-kind {
    transition: transform 0.08s ease, background 0.15s ease, filter 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .em-call:active, .em-primary:active:not(:disabled), .em-kind:active, .em-ctrl:active { transform: scale(0.98); }
  @media (prefers-reduced-motion: reduce) {
    .em-ctrl, .em-read, .em-call, .em-primary, .em-edit, .em-kind {
      transition: none !important; transform: none !important;
    }
  }
`
