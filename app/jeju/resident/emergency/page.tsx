'use client'

/**
 * 긴급·상담 전화 — resident emergency & help directory.
 *
 * Sections:
 *   - 긴급 (red):   119 구급 / 112 경찰  (direct tap-to-call, user is here on purpose)
 *   - 상담 (calm):  129 보건복지상담 / 노인학대 신고 1577-1389
 *   - 가족:         one family number saved on THIS device (localStorage, no DB/login)
 *   - 우리 동네 주민센터: 시 선택 → 동 선택 → 행정복지센터 전화
 *
 * All phone numbers are public/documented. Where a specific 행정복지센터 direct
 * line isn't verified, we fall back to the city-hall main line rather than
 * inventing a number (제주시청 064-728-2114 / 서귀포시청 064-760-2114).
 *
 * Accessibility: large text (≥24px), high contrast, ≥60px tap targets, TTS,
 * reduced-motion, focus-visible, persistent 처음으로/메뉴 bar. No DB.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { residentHome, withSeniorOrigin } from '@/app/jeju/resident/_lib/origin'

// ── Theme (shared with medical/photo pages) ────────────────────────────────────

const C = {
  bg: '#FBF4E6',
  surface: '#FFFFFF',
  ink: '#12263A',
  inkSoft: '#3C4C60',
  sea: '#0E4E8A',
  seaStrong: '#0A3A66',
  focus: '#E8590C',
  muted: '#5E5A50',
  warnBg: '#FCE8E6',
  warnBorder: '#B91C1C',
  warnInk: '#7F1D1D',
  calmBg: '#EAF2FB',
}

// ── Public numbers ─────────────────────────────────────────────────────────────

const JEJU_CITY_HALL = '064-728-2114' // 제주시청 대표번호
const SEOGWIPO_CITY_HALL = '064-760-2114' // 서귀포시청 대표번호

interface CenterEntry {
  name: string
  /** Verified 행정복지센터 direct line, else undefined → city-hall fallback. */
  phone?: string
}

/**
 * Jeju 읍·면·동. Direct 행정복지센터 lines are not individually verified here,
 * so each falls back to the city-hall main line (see resolveCenterPhone). This
 * is intentional — it connects the user to a real public help line rather than
 * an invented number. Verified direct numbers can be filled into `phone` later.
 */
const JEJU_CENTERS: Record<'제주시' | '서귀포시', CenterEntry[]> = {
  제주시: [
    { name: '한림읍' }, { name: '애월읍' }, { name: '구좌읍' }, { name: '조천읍' },
    { name: '한경면' }, { name: '추자면' }, { name: '우도면' },
    { name: '일도1동' }, { name: '일도2동' }, { name: '이도1동' }, { name: '이도2동' },
    { name: '삼도1동' }, { name: '삼도2동' }, { name: '용담1동' }, { name: '용담2동' },
    { name: '건입동' }, { name: '화북동' }, { name: '삼양동' }, { name: '봉개동' },
    { name: '아라동' }, { name: '오라동' }, { name: '연동' }, { name: '노형동' },
    { name: '외도동' }, { name: '이호동' }, { name: '도두동' },
  ],
  서귀포시: [
    { name: '대정읍' }, { name: '남원읍' }, { name: '성산읍' },
    { name: '안덕면' }, { name: '표선면' },
    { name: '송산동' }, { name: '정방동' }, { name: '중앙동' }, { name: '천지동' },
    { name: '효돈동' }, { name: '영천동' }, { name: '동홍동' }, { name: '서홍동' },
    { name: '대륜동' }, { name: '대천동' }, { name: '중문동' }, { name: '예래동' },
  ],
}

function resolveCenterPhone(city: '제주시' | '서귀포시', entry: CenterEntry): string {
  if (entry.phone) return entry.phone
  return city === '제주시' ? JEJU_CITY_HALL : SEOGWIPO_CITY_HALL
}

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

type View = 'main' | 'family-edit' | 'center-city' | 'center-dong'

// ── Component ─────────────────────────────────────────────────────────────────

export default function EmergencyPage() {
  const router = useRouter()

  const [view, setView] = useState<View>('main')
  const [ttsSupported, setTtsSupported] = useState(false)

  const [family, setFamily] = useState<{ name: string; phone: string } | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const [city, setCity] = useState<'제주시' | '서귀포시' | null>(null)

  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) setTtsSupported(true)
    setFamily(loadFamily())
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
    router.push(residentHome())
  }, [router, stopSpeaking])

  const goMedical = useCallback(() => {
    stopSpeaking()
    router.push(withSeniorOrigin('/jeju/resident/medical'))
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

  // ── Center picker ──────────────────────────────────────────────────────────

  const openCenters = useCallback(() => {
    stopSpeaking()
    setCity(null)
    setView('center-city')
  }, [stopSpeaking])

  const pickCity = useCallback((c: '제주시' | '서귀포시') => {
    stopSpeaking()
    setCity(c)
    setView('center-dong')
  }, [stopSpeaking])

  const telDigits = (s: string) => s.replace(/[^0-9+]/g, '')

  const mainNarration =
    '긴급하고 상담이 필요할 때 거는 전화입니다. 119 구급, 112 경찰, 129 보건복지 상담, 노인학대 신고, 가족 전화, 우리 동네 주민센터를 고를 수 있어요.'

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

            {/* 주민센터 */}
            <section style={styles.group} aria-label="우리 동네 주민센터">
              <h2 style={{ ...styles.groupTitle, color: C.ink }}>우리 동네 주민센터</h2>
              <button type="button" className="em-primary" style={styles.primaryBtn} onClick={openCenters} aria-label="우리 동네 주민센터 찾기">
                <span aria-hidden>🏢</span> 우리 동네 주민센터
              </button>
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

        {/* ── CENTER: pick city ───────────────────────────────────────────── */}
        {view === 'center-city' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🏢</span>
              <h1 style={styles.h1}>어느 시에 사세요?</h1>
            </header>
            <section style={styles.card}>
              <a href={`tel:${telDigits(JEJU_CITY_HALL)}`} className="em-call" style={{ ...styles.callBtn, ...styles.callCalm }} aria-label={`잘 모르겠으면 여기 — 제주시청 ${JEJU_CITY_HALL} 전화하기`}>
                <span style={styles.callEmoji} aria-hidden>❓</span>
                <span style={styles.callTextWrap}>
                  <span style={{ ...styles.callTitle, color: C.ink }}>잘 모르겠으면 여기</span>
                  <span style={{ ...styles.callSub, color: C.inkSoft }}>제주시청 {JEJU_CITY_HALL}</span>
                </span>
                <span style={{ ...styles.callPhone, color: C.sea }} aria-hidden>📞</span>
              </a>

              <div style={styles.cityRow}>
                <button type="button" className="em-kind" style={styles.kindBtn} onClick={() => pickCity('제주시')} aria-label="제주시 선택">
                  제주시
                </button>
                <button type="button" className="em-kind" style={styles.kindBtn} onClick={() => pickCity('서귀포시')} aria-label="서귀포시 선택">
                  서귀포시
                </button>
              </div>
            </section>
          </>
        )}

        {/* ── CENTER: pick dong → tap to call ─────────────────────────────── */}
        {view === 'center-dong' && city && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>🏢</span>
              <h1 style={styles.h1}>{city} 주민센터</h1>
            </header>

            <p style={styles.dongNote}>
              동네를 누르면 <strong>주민센터로 전화</strong>가 걸려요. 연결되면 안내에 따라 말씀하세요.
            </p>

            <button type="button" className="em-ctrl" style={styles.ctrlBtnWide} onClick={() => { stopSpeaking(); setView('center-city') }} aria-label="시 다시 고르기">
              <span aria-hidden>↩</span> 시 다시 고르기
            </button>

            <div style={styles.dongList}>
              {JEJU_CENTERS[city].map((entry) => {
                const phone = resolveCenterPhone(city, entry)
                return (
                  <a
                    key={entry.name}
                    href={`tel:${telDigits(phone)}`}
                    className="em-call"
                    style={styles.dongBtn}
                    aria-label={`${entry.name} 행정복지센터 ${phone} 전화하기`}
                  >
                    <span style={styles.dongName}>{entry.name}</span>
                    <span style={styles.dongPhone}>
                      <span aria-hidden>📞</span> {phone}
                    </span>
                  </a>
                )
              })}
            </div>
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
    background: '#EFF4FB', borderRadius: 12, padding: '12px 14px',
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
    background: '#FDFBF6', border: `3px solid ${C.sea}`, borderRadius: 14,
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
