'use client'

/**
 * 말벗·안부 — daily companion + wellness check-in for Jeju resident senior mode.
 *
 * INDEPENDENT of the care app: this is a standalone Jeju copy. It imports
 * nothing from app/care/** or lib/care/**, fetches its own
 * /api/jeju/resident/companion route, and uses a Jeju-only check-in
 * localStorage key so the two apps share no mutable state.
 *
 * Flow:
 *   1. 안부 체크인 (once per day): 5 gentle questions, ONE at a time, big
 *      3-option buttons. Answers saved to localStorage (안부 기록) and sent to
 *      the companion API, which replies with a warm acknowledgement.
 *   2. 말벗 대화: free conversation. Big text input + optional 🎤 voice input
 *      (SpeechRecognition ko-KR, silent fallback to text) + 🔊 TTS of replies.
 *      History kept in React state and passed to the API each turn (stateless
 *      server, nothing stored off-device).
 *
 * ── SAFETY (crisis protocol) ──────────────────────────────────────────────────
 * The API classifies EVERY user message on a GRADUATED scale (see route.ts). The
 * response escalates as risk escalates:
 *   0   → warm reply only.
 *   1a  → mild/passing sadness → empathy only, NO resource card.
 *   1b  → deeper/persistent distress → gentle calm resource card (1577-0199, 24h).
 *   2   → suicidal ideation (no plan) → pinned RED crisis panel (109 + 1577-0199).
 *   3   → imminent/high risk (method, plan, or timing) → pinned red panel, MORE
 *         prominent, with an immediate "지금 혼자 계세요?" safety check and an
 *         urgent family-alert button. The AI hard-refuses any method info.
 * Levels 2 and 3 ALWAYS render the pinned red panel (not just inline text), so
 * crisis resources can never be buried in the chat.
 *
 * RESPONSIBLE-AI STANCE: this AI does NOT diagnose and is NOT a counselor. It
 * NEVER provides methods or means (hard refusal). It detects risk signals and
 * connects the person to professional resources (109) and family — an aid to
 * connection, not a replacement for help.
 *
 * ⚠️ PHONE NUMBERS — VERIFY BEFORE DEPLOYMENT:
 *   자살예방상담 109 (24h) · 정신건강위기상담 1577-0199 (24h) · 소방·구급 119
 *   NOTE: 129 (보건복지상담) is weekday-hours only — not used in crisis paths.
 *
 * Family link (kept light, on-device only):
 *   - Reuses the emergency module's family contact (same localStorage keys).
 *   - Today's check-in stored locally as a simple 안부 기록.
 *   - "가족에게 오늘 안부 보내기" → direct sms: link (opens Messages app prefilled;
 *     user taps 전송 once). If no number saved, an inline form appears here first.
 *
 * Accessibility: ≥20/24/32 fonts, high contrast, ≥60px targets, TTS ko-KR
 * cancel-before-speak, reduced-motion, focus-visible, persistent 처음으로 bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

// ── Theme (matches Jeju resident senior mode palette) ──────────────────────────

const C = {
  bg: '#FBF4E6',
  surface: '#FFFFFF',
  ink: '#12263A',
  inkSoft: '#3C4C60',
  sea: '#0E4E8A',
  seaStrong: '#0A3A66',
  focus: '#E8590C',
  muted: '#5E5A50',
  warm: '#C25A10', // companion accent (warm amber)
  warmBg: '#FDEBD2',
  warmBorder: '#D97706',
  warnBg: '#FCE8E6',
  warnBorder: '#B91C1C',
  warnInk: '#7F1D1D',
  calmBg: '#EAF2FB',
}

// ── Crisis / support phone numbers ─────────────────────────────────────────────
// As of 2024-01-01, 자살예방상담 consolidated to 109 (3-digit, 24h).
// ⚠️ VERIFY 109 / 1577-0199 / 119 with a human before deployment (also in API route).
// NOTE: 129 (보건복지상담) is weekday 09:00–18:00 ONLY — NOT appropriate for crisis.
//       129 is retained only for non-crisis general welfare contexts elsewhere.
const SUICIDE_PREVENTION_LINE = '109'    // 자살예방상담 · 24시간
const MENTAL_CRISIS_LINE = '1577-0199'  // 정신건강위기상담 · 24시간
const EMERGENCY_LINE = '119'            // 소방·구급 — level-3 imminent physical danger
// 129 (보건복지상담 · 평일 09:00–18:00) is NOT used in any crisis path here.
// It remains available in the emergency module for general welfare queries.

// ── localStorage ────────────────────────────────────────────────────────────────
// Family contact: SAME keys as the emergency module so one saved contact works
// in both places.
const LS_FAMILY_NAME = 'resident.family.name'
const LS_FAMILY_PHONE = 'resident.family.phone'
// Jeju-only check-in log key — DELIBERATELY isolated from the care app
// ('care.checkin.v1') so the two apps never share mutable on-device state.
const LS_CHECKIN = 'jeju.resident.checkin.v1'

interface FamilyContact {
  name: string
  phone: string
}

function loadFamily(): FamilyContact | null {
  try {
    if (typeof window === 'undefined') return null
    const phone = window.localStorage.getItem(LS_FAMILY_PHONE) ?? ''
    if (!phone.trim()) return null
    const name = window.localStorage.getItem(LS_FAMILY_NAME) ?? ''
    return { name, phone }
  } catch {
    return null
  }
}

/** Persist family contact — same keys as the emergency module. */
function saveFamilyContact(name: string, phone: string): boolean {
  try {
    if (typeof window === 'undefined') return false
    window.localStorage.setItem(LS_FAMILY_PHONE, phone.trim())
    window.localStorage.setItem(LS_FAMILY_NAME, name.trim())
    return true
  } catch {
    return false
  }
}

interface CheckinRecord {
  date: string // YYYY-MM-DD (local)
  meal: string
  sleep: string
  mood: string
  medicine: string
  body: string
}

function todayStr(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function loadCheckinLog(): CheckinRecord[] {
  try {
    if (typeof window === 'undefined') return []
    const raw = window.localStorage.getItem(LS_CHECKIN)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (r): r is CheckinRecord =>
        !!r && typeof r === 'object' && typeof (r as CheckinRecord).date === 'string'
    )
  } catch {
    return []
  }
}

function saveCheckinRecord(rec: CheckinRecord) {
  try {
    if (typeof window === 'undefined') return
    const log = loadCheckinLog().filter((r) => r.date !== rec.date)
    log.push(rec)
    // keep the most recent 30 days on-device
    log.sort((a, b) => (a.date < b.date ? 1 : -1))
    window.localStorage.setItem(LS_CHECKIN, JSON.stringify(log.slice(0, 30)))
  } catch {
    /* storage unavailable — check-in still works for this session */
  }
}

// ── Check-in questions ──────────────────────────────────────────────────────────

type CheckinKey = 'meal' | 'sleep' | 'mood' | 'medicine' | 'body'

const CHECKIN_STEPS: { key: CheckinKey; q: string; emoji: string; options: string[] }[] = [
  { key: 'meal', q: '식사하셨어요?', emoji: '🍚', options: ['잘 먹었어요', '조금 먹었어요', '아직 못 먹었어요'] },
  { key: 'sleep', q: '잘 주무셨어요?', emoji: '🌙', options: ['잘 잤어요', '그저 그래요', '못 잤어요'] },
  { key: 'mood', q: '오늘 기분은 어떠세요?', emoji: '🌤️', options: ['좋아요', '그저 그래요', '힘들어요'] },
  { key: 'medicine', q: '약은 드셨어요?', emoji: '💊', options: ['먹었어요', '안 먹었어요', '해당 없어요'] },
  { key: 'body', q: '몸은 어떠세요?\n어디 아픈 데 있어요?', emoji: '🤲', options: ['괜찮아요', '조금 불편해요', '많이 아파요'] },
]

// ── Chat types ──────────────────────────────────────────────────────────────────

/**
 * Matches API riskLevel (graduated) —
 *   '0' none · '1a' empathy only · '1b' calm resource card
 *   '2' red crisis panel (ideation) · '3' red crisis panel + urgent safety check
 */
type RiskLevel = '0' | '1a' | '1b' | '2' | '3'

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  riskLevel?: RiskLevel
}

type Phase = 'checkin' | 'chat'

// ── Component ─────────────────────────────────────────────────────────────────

export default function JejuResidentCompanionPage() {
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('checkin')
  const [stepIdx, setStepIdx] = useState(0)
  const [answers, setAnswers] = useState<Partial<Record<CheckinKey, string>>>({})
  const [todayDone, setTodayDone] = useState(false)

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  // Crisis mode — set on level 2 or 3, persists (pinned red panel) until the user
  // dismisses it, so it can never get buried in the chat. crisisHigh (level 3)
  // makes the panel more urgent: immediate-safety check + urgent family alert.
  const [crisisMode, setCrisisMode] = useState(false)
  const [crisisHigh, setCrisisHigh] = useState(false)
  // Gentle support card — shown only after level 1b (deeper/persistent distress).
  const [showSupportCard, setShowSupportCard] = useState(false)

  const [family, setFamily] = useState<FamilyContact | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  // Inline family-number form — shown in-place when SMS is tapped without a saved number.
  const [familyFormSlot, setFamilyFormSlot] = useState<'daily' | 'crisis' | null>(null)
  const [familyDraftName, setFamilyDraftName] = useState('')
  const [familyDraftPhone, setFamilyDraftPhone] = useState('')
  const [familyFormError, setFamilyFormError] = useState<string | null>(null)

  const [ttsSupported, setTtsSupported] = useState(false)
  const [micSupported, setMicSupported] = useState(false)
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const checkinRef = useRef<CheckinRecord | null>(null)
  // Best available Korean TTS voice — resolved once voices load.
  const koVoiceRef = useRef<SpeechSynthesisVoice | null>(null)

  // ── TTS voice selection ───────────────────────────────────────────────────────
  // Preference order: Neural/Natural > Google > Microsoft > any 'ko' voice > default.
  // Voices load asynchronously on first call; onvoiceschanged re-runs selection.

  const pickKoVoice = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const voices = window.speechSynthesis.getVoices()
    const ko = voices.filter((v) => v.lang.startsWith('ko'))
    if (ko.length === 0) { koVoiceRef.current = null; return }
    // Score each voice: higher = more natural-sounding.
    const PREF = ['neural', 'natural', 'google', 'microsoft', 'yuna', 'heami']
    let best: SpeechSynthesisVoice = ko[0]!
    let bestScore = -1
    for (const v of ko) {
      const name = v.name.toLowerCase()
      let score = 0
      PREF.forEach((kw, i) => { if (name.includes(kw)) score = Math.max(score, PREF.length - i) })
      if (score > bestScore) { bestScore = score; best = v }
    }
    koVoiceRef.current = best
  }, [])

  // ── Mount: TTS/mic support, family, today's check-in state ───────────────────

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setTtsSupported(true)
      // Voices may already be loaded synchronously on some browsers.
      pickKoVoice()
      // On others (Chrome/Edge) they load asynchronously — re-pick when ready.
      window.speechSynthesis.onvoiceschanged = pickKoVoice
    }
    const SR =
      typeof window !== 'undefined'
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null
    if (SR) setMicSupported(true)
    setFamily(loadFamily())

    // Already checked in today → greet and go straight to conversation.
    const today = loadCheckinLog().find((r) => r.date === todayStr())
    if (today) {
      checkinRef.current = today
      setTodayDone(true)
      setPhase('chat')
      setMessages([
        {
          role: 'assistant',
          content:
            '오늘 안부는 아까 여쭤봤지요. 다시 와 주셔서 반가워요! 오늘 어떻게 지내고 계세요? 편하게 이야기해 주세요.',
        },
      ])
    }
  }, [])

  // ── TTS ────────────────────────────────────────────────────────────────────

  const speak = useCallback(
    (text: string) => {
      if (!ttsSupported || typeof window === 'undefined' || !text) return
      try {
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'ko-KR'
        // Use the best available Korean voice if one was resolved; otherwise the
        // browser picks the default Korean voice.
        if (koVoiceRef.current) u.voice = koVoiceRef.current
        // Elderly-friendly: slightly slower, natural pitch, full volume.
        u.rate = 0.92
        u.pitch = 1.0
        u.volume = 1.0
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

  // Scroll chat to the newest message.
  useEffect(() => {
    if (phase === 'chat') {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [messages, phase])

  // ── Toast ──────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToastMsg(msg)
    toastTimer.current = setTimeout(() => setToastMsg(null), 3500)
  }, [])

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goHome = useCallback(() => {
    stopSpeaking()
    router.push('/jeju/resident/senior')
  }, [router, stopSpeaking])

  // ── API call ──────────────────────────────────────────────────────────────

  const parseRiskLevel = (v: unknown): RiskLevel => {
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase()
      if (s === '3') return '3'
      if (s === '2') return '2'
      if (s === '1b') return '1b'
      if (s === '1a') return '1a'
    }
    return '0'
  }

  const callCompanion = useCallback(
    async (
      history: ChatMsg[],
      opts: { checkin?: CheckinRecord | null; isCheckinSummary?: boolean } = {}
    ): Promise<{ reply: string; riskLevel: RiskLevel }> => {
      const res = await fetch('/api/jeju/resident/companion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          checkin: opts.checkin
            ? {
                meal: opts.checkin.meal,
                sleep: opts.checkin.sleep,
                mood: opts.checkin.mood,
                medicine: opts.checkin.medicine,
                body: opts.checkin.body,
              }
            : undefined,
          isCheckinSummary: opts.isCheckinSummary === true,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { reply?: string; riskLevel?: string | number }
      const reply = typeof data.reply === 'string' && data.reply ? data.reply : '네, 듣고 있어요.'
      const riskLevel = parseRiskLevel(data.riskLevel)
      return { reply, riskLevel }
    },
    []
  )

  /** Apply a reply + risk level to state (crisis mode, support card, TTS). */
  const applyReply = useCallback(
    (reply: string, riskLevel: RiskLevel) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: reply, riskLevel }])
      if (riskLevel === '3') {
        // Highest risk — pinned red panel, more urgent (safety check + family).
        setCrisisMode(true)
        setCrisisHigh(true)
        setShowSupportCard(false)
      } else if (riskLevel === '2') {
        setCrisisMode(true)
        // Do not downgrade an already-shown high-risk panel within the session.
        setShowSupportCard(false)
      } else if (riskLevel === '1b') {
        setShowSupportCard(true)
      } else {
        // 0 and 1a — empathy only, no resource card
        setShowSupportCard(false)
      }
      speak(reply)
    },
    [speak]
  )

  // ── Check-in flow ──────────────────────────────────────────────────────────

  const answerStep = useCallback(
    (option: string) => {
      stopSpeaking()
      const step = CHECKIN_STEPS[stepIdx]!
      const nextAnswers = { ...answers, [step.key]: option }
      setAnswers(nextAnswers)

      if (stepIdx < CHECKIN_STEPS.length - 1) {
        const next = stepIdx + 1
        setStepIdx(next)
        speak(CHECKIN_STEPS[next]!.q.replace('\n', ' '))
        return
      }

      // All 5 answered → persist + move to chat + fetch the warm summary reply.
      const rec: CheckinRecord = {
        date: todayStr(),
        meal: nextAnswers.meal ?? '',
        sleep: nextAnswers.sleep ?? '',
        mood: nextAnswers.mood ?? '',
        medicine: nextAnswers.medicine ?? '',
        body: nextAnswers.body ?? '',
      }
      checkinRef.current = rec
      saveCheckinRecord(rec)
      setTodayDone(true)
      setPhase('chat')
      setSending(true)

      const seed: ChatMsg[] = [{ role: 'user', content: '(오늘 안부 확인을 마쳤어요.)' }]
      callCompanion(seed, { checkin: rec, isCheckinSummary: true })
        .then(({ reply, riskLevel }) => applyReply(reply, riskLevel))
        .catch(() => {
          const fallback =
            '안부 잘 들었어요. 오늘도 와 주셔서 고마워요. 하고 싶은 이야기가 있으면 편하게 말씀해 주세요.'
          setMessages((prev) => [...prev, { role: 'assistant', content: fallback }])
          speak(fallback)
        })
        .finally(() => setSending(false))
    },
    [answers, stepIdx, stopSpeaking, speak, callCompanion, applyReply]
  )

  const skipCheckin = useCallback(() => {
    stopSpeaking()
    setPhase('chat')
    const greet =
      '네, 좋아요. 안부는 나중에 여쭤봐도 되지요. 오늘 어떻게 지내셨어요? 편하게 이야기해 주세요.'
    setMessages([{ role: 'assistant', content: greet }])
    speak(greet)
  }, [stopSpeaking, speak])

  // ── Chat send ──────────────────────────────────────────────────────────────

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return
    stopSpeaking()
    if (listening && recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* no-op */ }
      setListening(false)
    }
    setInput('')
    const history: ChatMsg[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setSending(true)
    try {
      const { reply, riskLevel } = await callCompanion(history, {
        checkin: checkinRef.current,
      })
      applyReply(reply, riskLevel)
    } catch {
      const fallback = '죄송해요, 지금 잠깐 연결이 어려워요. 조금 있다가 다시 말씀해 주시겠어요?'
      setMessages((prev) => [...prev, { role: 'assistant', content: fallback }])
      speak(fallback)
    } finally {
      setSending(false)
    }
  }, [input, sending, messages, listening, stopSpeaking, callCompanion, applyReply, speak])

  // ── Mic (SpeechRecognition ko-KR; silent fallback to text) ─────────────────

  const toggleMic = useCallback(() => {
    if (!micSupported || typeof window === 'undefined') return
    if (listening && recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* no-op */ }
      setListening(false)
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const rec = new SR()
    rec.lang = 'ko-KR'
    rec.interimResults = false
    rec.continuous = false
    rec.maxAlternatives = 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let transcript = ''
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0]?.transcript ?? ''
      }
      if (transcript) setInput((prev) => (prev ? prev + ' ' : '') + transcript)
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recognitionRef.current = rec
    try {
      stopSpeaking()
      rec.start()
      setListening(true)
    } catch {
      setListening(false)
    }
  }, [micSupported, listening, stopSpeaking])

  // ── Family SMS ────────────────────────────────────────────────────────────
  // No server-side SMS provider is configured in this project.
  // We use a direct `sms:` URI so the phone's native Messages app opens with
  // the recipient number and body pre-filled; the user taps 전송 once.
  //   iOS:     sms:01012345678&body=…  (iOS uses & before body)
  //   Android: sms:01012345678?body=…  (Android uses ?)
  // We emit the ?body= form, which works on most Android devices and modern iOS.
  // On desktop there is typically no SMS app — that's acceptable, this is a
  // phone-first feature.
  //
  // PRIVACY: only the structured check-in answers (식사/잠/기분/약/몸) or the
  // crisis alert are included — NEVER the free conversation text.

  const telDigits = (s: string) => s.replace(/[^0-9+]/g, '')

  /** Build the SMS body text. Returns structured check-in or crisis alert only. */
  const buildSmsBody = useCallback((urgent: boolean): string => {
    const rec = checkinRef.current
    const d = new Date()
    const dateLabel = `${d.getMonth() + 1}월 ${d.getDate()}일`

    if (urgent) {
      // Crisis alert — warm but actionable; no conversation detail.
      return `[긴급] ${dateLabel} 어르신이 지금 마음이 많이 힘드신 것 같아요. 지금 바로 전화해 주세요. 자살예방상담 109 (24시간)`
    }

    if (!rec) {
      // Visited but skipped the check-in.
      return `[어르신 도우미] ${dateLabel} 어르신이 오늘 말벗 앱에 다녀가셨어요.`
    }

    // Structured check-in summary only — the 5 answers, nothing from chat.
    return (
      `[어르신 도우미] ${dateLabel} 오늘 안부\n` +
      `식사: ${rec.meal} / 잠: ${rec.sleep} / 기분: ${rec.mood}\n` +
      `약: ${rec.medicine} / 몸: ${rec.body}\n` +
      `오늘도 잘 지내고 계세요.`
    )
  }, [])

  /**
   * Build the sms: href. Works on iOS and Android; may not work on desktop.
   * Body is URL-encoded. We use ?body= (widely supported on Android and iOS 17+).
   */
  const buildSmsHref = useCallback(
    (urgent: boolean, phoneOverride?: string): string | null => {
      const phone = phoneOverride ?? family?.phone
      if (!phone) return null
      const digits = telDigits(phone)
      if (!digits) return null
      const body = buildSmsBody(urgent)
      return `sms:${digits}?body=${encodeURIComponent(body)}`
    },
    [family, buildSmsBody]
  )

  /** Open the native SMS app with a prefilled message (phone-first feature). */
  const openSmsLink = useCallback((href: string) => {
    try {
      window.location.href = href
    } catch {
      /* desktop or no SMS app — acceptable */
    }
  }, [])

  const openFamilyForm = useCallback(
    (slot: 'daily' | 'crisis') => {
      setFamilyDraftName(family?.name ?? '')
      setFamilyDraftPhone(family?.phone ?? '')
      setFamilyFormError(null)
      setFamilyFormSlot(slot)
    },
    [family]
  )

  const cancelFamilyForm = useCallback(() => {
    setFamilyFormSlot(null)
    setFamilyFormError(null)
  }, [])

  /** Save family contact, then immediately open the SMS app — no page reload. */
  const submitFamilyForm = useCallback(() => {
    const phone = familyDraftPhone.trim()
    const name = familyDraftName.trim()
    if (!phone) {
      setFamilyFormError('전화번호를 넣어 주세요.')
      return
    }
    const ok = saveFamilyContact(name, phone)
    if (!ok) {
      setFamilyFormError('저장이 어려워요. 다시 한 번 시도해 주세요.')
      return
    }
    const urgent = familyFormSlot === 'crisis'
    setFamily({ name, phone })
    setFamilyFormError(null)
    setFamilyFormSlot(null)
    setFamilyDraftName('')
    setFamilyDraftPhone('')
    const href = buildSmsHref(urgent, phone)
    if (href) openSmsLink(href)
  }, [familyDraftPhone, familyDraftName, familyFormSlot, buildSmsHref, openSmsLink])

  const SMS_HINT = '문자 앱이 열리면 내용 확인 후 전송만 누르시면 돼요.'

  // ── Narrations ─────────────────────────────────────────────────────────────

  const checkinNarration =
    '안녕하세요, 말벗이에요. 오늘 하루 안부를 여쭤볼게요. 다섯 가지만 여쭤봐요. 화면의 큰 단추를 눌러 답해 주세요.'

  /** Inline family-number form — no detour to the emergency page. */
  const renderFamilyInlineForm = (slot: 'daily' | 'crisis') => {
    if (familyFormSlot !== slot) return null
    const id = slot === 'crisis' ? 'cp-fam-crisis' : 'cp-fam-daily'
    const onCrisisPanel = slot === 'crisis'
    return (
      <div
        style={onCrisisPanel ? { ...styles.familyForm, ...styles.familyFormOnCrisis } : styles.familyForm}
        aria-label="가족 번호 넣기"
      >
        <p style={onCrisisPanel ? styles.familyFormLeadCrisis : styles.familyFormLead}>
          {onCrisisPanel
            ? '가족 전화번호를 넣으면 바로 급히 알릴 수 있어요.'
            : '가족 전화번호를 넣으면 바로 안부 문자를 보낼 수 있어요.'}
        </p>
        {familyFormError && (
          <p style={styles.familyFormError} role="alert">{familyFormError}</p>
        )}
        <label style={styles.familyFormLabel} htmlFor={`${id}-name`}>
          이름 <span style={{ color: C.muted, fontWeight: 600 }}>(안 넣어도 돼요)</span>
        </label>
        <input
          id={`${id}-name`}
          className="cp-family-input"
          style={styles.familyFormInput}
          value={familyDraftName}
          onChange={(e) => setFamilyDraftName(e.target.value)}
          placeholder="예: 큰딸, 아들"
          inputMode="text"
          autoComplete="off"
        />
        <label style={styles.familyFormLabel} htmlFor={`${id}-phone`}>가족 전화번호</label>
        <input
          id={`${id}-phone`}
          className="cp-family-input"
          style={styles.familyFormInput}
          value={familyDraftPhone}
          onChange={(e) => setFamilyDraftPhone(e.target.value)}
          placeholder="예: 010-1234-5678"
          inputMode="tel"
          autoComplete="tel"
        />
        <div style={styles.familyFormActions}>
          <button
            type="button"
            className="cp-family-save"
            style={familyDraftPhone.trim() ? styles.familyFormSaveBtn : { ...styles.familyFormSaveBtn, opacity: 0.45, cursor: 'not-allowed' }}
            onClick={submitFamilyForm}
            disabled={!familyDraftPhone.trim()}
            aria-disabled={!familyDraftPhone.trim()}
            aria-label="가족 번호 저장하고 문자 보내기"
          >
            저장
          </button>
          <button
            type="button"
            className="cp-family-cancel"
            style={styles.familyFormCancelBtn}
            onClick={cancelFamilyForm}
            aria-label="가족 번호 입력 취소"
          >
            취소
          </button>
        </div>
        <p style={onCrisisPanel ? styles.familyFormHintCrisis : styles.familyFormHint}>{SMS_HINT}</p>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const step = CHECKIN_STEPS[stepIdx]!

  return (
    <div style={styles.root}>
      <style>{GLOBAL_CSS}</style>

      <main style={styles.frame}>
        {/* Persistent top bar */}
        <div style={styles.topBar}>
          <button type="button" className="cp-ctrl" style={styles.ctrlBtn} onClick={goHome} aria-label="처음으로 돌아가기">
            <span aria-hidden>↩</span> 처음으로
          </button>
          {ttsSupported && phase === 'checkin' && (
            <button
              type="button"
              className="cp-ctrl"
              style={styles.ctrlBtn}
              onClick={() => speak(`${checkinNarration} ${step.q.replace('\n', ' ')}`)}
              aria-label="이 화면 읽어주기"
            >
              <span aria-hidden>🔊</span> 읽어주기
            </button>
          )}
        </div>

        {/* ── CRISIS PANEL — pinned red, persists until dismissed ──────────────
            Shown for level 2 (ideation) AND level 3 (imminent). Level 3
            (crisisHigh) is visibly stronger: brighter border, an immediate
            "지금 혼자 계세요?" safety check, and an urgent family-alert button. */}
        {crisisMode && (
          <section
            style={crisisHigh ? { ...styles.crisisPanel, ...styles.crisisPanelHigh } : styles.crisisPanel}
            role="alert"
            aria-label={crisisHigh ? '지금 바로 도움이 필요해요' : '지금 도움받을 수 있는 곳'}
          >
            {crisisHigh ? (
              <>
                <p style={styles.crisisHighFlag}>지금 바로 도움이 필요해요</p>
                <p style={styles.crisisTitle}>
                  혼자 견디지 마세요.<br />지금 같이 도와줄 사람이 있어요.
                </p>
                {/* Immediate-safety check — the level-3 escalation */}
                <p style={styles.crisisSafetyCheck}>
                  지금 혼자 계세요?<br />곁에 누가 있나요?
                </p>
              </>
            ) : (
              <p style={styles.crisisTitle}>
                혼자가 아니에요.<br />지금 바로 이야기 나눌 수 있어요.
              </p>
            )}
            <a
              href={`tel:${SUICIDE_PREVENTION_LINE}`}
              className="cp-crisis-call"
              style={styles.crisisCallMain}
              aria-label="자살예방상담 109에 지금 바로 전화하기, 24시간 받아요"
            >
              <span style={styles.crisisCallEmoji} aria-hidden>📞</span>
              <span style={styles.crisisCallTextWrap}>
                <span style={styles.crisisCallTitle}>
                  {crisisHigh ? '지금 바로 전화 ' : '자살예방상담 '}{SUICIDE_PREVENTION_LINE}
                </span>
                <span style={styles.crisisCallSub}>자살예방상담 · 24시간</span>
              </span>
              <span style={styles.crisisCallNum} aria-hidden>{SUICIDE_PREVENTION_LINE}</span>
            </a>
            <a
              href={`tel:${telDigits(MENTAL_CRISIS_LINE)}`}
              className="cp-crisis-call"
              style={styles.crisisCallSecond}
              aria-label="정신건강상담 1577-0199에 전화하기"
            >
              <span style={styles.crisisCallEmoji} aria-hidden>📞</span>
              <span style={styles.crisisCallTextWrap}>
                <span style={{ ...styles.crisisCallTitle, color: C.ink }}>정신건강상담 {MENTAL_CRISIS_LINE}</span>
                <span style={{ ...styles.crisisCallSub, color: C.inkSoft }}>지금 바로 전화</span>
              </span>
            </a>
            {/* Level-3 only: 119 for imminent physical danger + urgent note.
                129 is NOT shown in crisis — it's weekday-hours only. */}
            {crisisHigh && (
              <>
                <a
                  href={`tel:${EMERGENCY_LINE}`}
                  className="cp-crisis-call"
                  style={styles.crisisCall119}
                  aria-label="119 소방·구급에 지금 바로 전화하기 — 지금 당장 위험할 때"
                >
                  <span style={styles.crisisCallEmoji} aria-hidden>🚒</span>
                  <span style={styles.crisisCallTextWrap}>
                    <span style={styles.crisisCallTitle}>지금 위험하면 119</span>
                    <span style={styles.crisisCallSub}>소방·구급 · 지금 당장 위험할 때</span>
                  </span>
                  <span style={styles.crisisCallNum} aria-hidden>{EMERGENCY_LINE}</span>
                </a>
                <p style={styles.crisisUrgentNote}>
                  지금 곁에 아무도 없으면, 가족이나 가까운 이웃에게 지금 바로 연락해 주세요.
                </p>
              </>
            )}
            {renderFamilyInlineForm('crisis') ?? (
              buildSmsHref(true) ? (
                <a
                  href={buildSmsHref(true)!}
                  className="cp-crisis-family"
                  style={styles.crisisFamilyBtn}
                  aria-label={crisisHigh ? '가족에게 지금 문자로 급히 알리기' : '가족에게 문자로 알리기'}
                >
                  <span aria-hidden>🚨</span>{' '}
                  {crisisHigh ? '가족에게 지금 알리기' : '가족에게 알리기'}
                </a>
              ) : (
                <button
                  type="button"
                  className="cp-crisis-family"
                  style={styles.crisisFamilyBtn}
                  onClick={() => openFamilyForm('crisis')}
                  aria-label="가족 번호 넣고 문자로 알리기"
                >
                  <span aria-hidden>🚨</span>{' '}
                  {crisisHigh ? '가족에게 지금 알리기' : '가족에게 알리기'}
                </button>
              )
            )}
            <button
              type="button"
              className="cp-crisis-dismiss"
              style={styles.crisisDismissBtn}
              onClick={() => {
                setCrisisMode(false)
                setCrisisHigh(false)
              }}
              aria-label="이 안내 닫기"
            >
              괜찮아요, 안내 닫기
            </button>
          </section>
        )}

        {/* ── CHECK-IN ─────────────────────────────────────────────────────── */}
        {phase === 'checkin' && (
          <>
            <header style={styles.header}>
              <span style={styles.headerEmoji} aria-hidden>💬</span>
              <h1 style={styles.h1}>말벗·안부</h1>
              <p style={styles.lead}>
                혼저 옵서! 오늘도 만나난 반갑수다.<br />
                하루 안부 다섯 가지만 여쭤볼게요.
              </p>
            </header>

            {/* Progress dots */}
            <div style={styles.dots} aria-label={`다섯 가지 중 ${stepIdx + 1}번째 질문`}>
              {CHECKIN_STEPS.map((s, i) => (
                <span
                  key={s.key}
                  aria-hidden
                  style={{
                    ...styles.dot,
                    background: i < stepIdx ? C.sea : i === stepIdx ? C.warm : '#C9D8EA',
                  }}
                />
              ))}
            </div>

            {/* Current question */}
            <section style={styles.qCard} aria-live="polite">
              <span style={styles.qEmoji} aria-hidden>{step.emoji}</span>
              <h2 style={styles.qText}>
                {step.q.split('\n').map((line, i) => (
                  <span key={i}>
                    {i > 0 && <br />}
                    {line}
                  </span>
                ))}
              </h2>
              <div style={styles.qOptions}>
                {step.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className="cp-opt"
                    style={styles.optBtn}
                    onClick={() => answerStep(opt)}
                    aria-label={`${opt} 라고 답하기`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </section>

            <button
              type="button"
              className="cp-skip"
              style={styles.skipBtn}
              onClick={skipCheckin}
              aria-label="안부는 건너뛰고 그냥 이야기하기"
            >
              그냥 이야기할래요
            </button>
          </>
        )}

        {/* ── CHAT ─────────────────────────────────────────────────────────── */}
        {phase === 'chat' && (
          <>
            <header style={{ ...styles.header, gap: 6 }}>
              <span style={{ ...styles.headerEmoji, fontSize: 38 }} aria-hidden>💬</span>
              <h1 style={{ ...styles.h1, fontSize: 30 }}>말벗</h1>
              {todayDone && (
                <p style={styles.doneBadge}>
                  <span aria-hidden>✅</span> 오늘 안부 확인 완료
                </p>
              )}
            </header>

            {/* Messages */}
            <section style={styles.chatList} aria-label="대화 내용" aria-live="polite">
              {messages.map((m, i) =>
                m.role === 'assistant' ? (
                  <div key={i} style={styles.aiRow}>
                    <div style={styles.aiBubble}>
                      <p style={styles.msgText}>{m.content}</p>
                      {ttsSupported && (
                        <button
                          type="button"
                          className="cp-replay"
                          style={styles.replayBtn}
                          onClick={() => speak(m.content)}
                          aria-label="이 말 다시 들려주기"
                        >
                          <span aria-hidden>🔊</span> 다시 듣기
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div key={i} style={styles.userRow}>
                    <div style={styles.userBubble}>
                      <p style={{ ...styles.msgText, color: '#FFFFFF' }}>{m.content}</p>
                    </div>
                  </div>
                )
              )}
              {sending && (
                <div style={styles.aiRow}>
                  <div style={{ ...styles.aiBubble, opacity: 0.75 }}>
                    <p style={styles.msgText}>생각하고 있어요…</p>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </section>

            {/* Gentle support card (level 1b only) — calm palette, 24h numbers only.
                129 (보건복지상담) is weekday-hours only → NOT shown here. */}
            {showSupportCard && !crisisMode && (
              <section style={styles.supportCard} aria-label="마음이 힘들 때 도움받을 수 있는 곳">
                <p style={styles.supportText}>
                  마음이 계속 힘드실 때, 언제든 이야기 나눌 수 있는 곳이에요.
                </p>
                <div style={styles.supportRow}>
                  <a href={`tel:${SUICIDE_PREVENTION_LINE}`} className="cp-support-call" style={styles.supportCallBtn} aria-label="자살예방상담 109 전화하기 24시간">
                    📞 자살예방상담 {SUICIDE_PREVENTION_LINE} · 24시간
                  </a>
                  <a href={`tel:${telDigits(MENTAL_CRISIS_LINE)}`} className="cp-support-call" style={styles.supportCallBtn} aria-label="정신건강위기상담 1577-0199 전화하기">
                    📞 정신건강상담 {MENTAL_CRISIS_LINE} · 24시간
                  </a>
                </div>
                <button
                  type="button"
                  className="cp-support-close"
                  style={styles.supportCloseBtn}
                  onClick={() => setShowSupportCard(false)}
                  aria-label="이 안내 닫기"
                >
                  닫기
                </button>
              </section>
            )}

            {/* Input area */}
            <section style={styles.inputArea} aria-label="말 입력하기">
              <textarea
                className="cp-input"
                style={styles.textInput}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="하고 싶은 말을 적어 주세요"
                rows={2}
                aria-label="하고 싶은 말 입력"
              />
              <div style={styles.inputBtnRow}>
                {micSupported && (
                  <button
                    type="button"
                    className="cp-mic"
                    style={listening ? { ...styles.micBtn, ...styles.micBtnOn } : styles.micBtn}
                    onClick={toggleMic}
                    aria-label={listening ? '말하기 멈추기' : '말로 하기'}
                    aria-pressed={listening}
                  >
                    <span aria-hidden>🎤</span> {listening ? '듣고 있어요…' : '말로 하기'}
                  </button>
                )}
                <button
                  type="button"
                  className="cp-send"
                  style={
                    input.trim() && !sending
                      ? styles.sendBtn
                      : { ...styles.sendBtn, opacity: 0.45, cursor: 'not-allowed' }
                  }
                  onClick={send}
                  disabled={!input.trim() || sending}
                  aria-disabled={!input.trim() || sending}
                  aria-label="보내기"
                >
                  보내기
                </button>
              </div>
            </section>

            {/* Family SMS — daily 안부. No number → inline form here, not emergency page. */}
            <section style={styles.familyArea} aria-label="가족에게 안부 문자 보내기">
              {renderFamilyInlineForm('daily') ?? (
                buildSmsHref(false) ? (
                  <a
                    href={buildSmsHref(false)!}
                    className="cp-family"
                    style={styles.familyBtn}
                    aria-label="가족에게 오늘 안부 문자 보내기 — 문자 앱이 열려요"
                  >
                    <span aria-hidden>💌</span> 가족에게 오늘 안부 보내기
                  </a>
                ) : (
                  <button
                    type="button"
                    className="cp-family"
                    style={styles.familyBtn}
                    onClick={() => openFamilyForm('daily')}
                    aria-label="가족 번호 넣고 오늘 안부 문자 보내기"
                  >
                    <span aria-hidden>💌</span> 가족에게 오늘 안부 보내기
                  </button>
                )
              )}
              {familyFormSlot !== 'daily' && (
                <p style={styles.familyNote}>
                  {family ? SMS_HINT : '가족 번호가 없으면 버튼을 눌러 여기서 바로 넣을 수 있어요.'}
                </p>
              )}
            </section>

            {/* Responsible-AI note */}
            <p style={styles.aboutNote}>
              말벗은 상담사가 아니에요. 마음이 많이 힘드실 때는 전문 상담 109 · 1577-0199 와
              가족에게 연결해 드리는 역할을 해요.
            </p>
          </>
        )}

        {/* Toast */}
        {toastMsg && (
          <div role="status" aria-live="polite" style={styles.toast}>
            {toastMsg}
          </div>
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
  frame: { width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 16 },
  topBar: {
    display: 'flex', justifyContent: 'space-between', gap: 12,
    position: 'sticky', top: 0, background: C.bg, paddingTop: 10, paddingBottom: 8, zIndex: 5,
  },
  ctrlBtn: {
    flex: 1, minHeight: 58, fontSize: 21, fontWeight: 700, color: C.ink,
    background: C.surface, border: `3px solid ${C.ink}`, borderRadius: 14, cursor: 'pointer', padding: '6px 12px',
  },
  header: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  headerEmoji: { fontSize: 46, lineHeight: 1 },
  h1: { fontSize: 34, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.25 },
  lead: { fontSize: 22, color: C.inkSoft, margin: 0, textAlign: 'center', lineHeight: 1.55 },
  doneBadge: {
    fontSize: 18, fontWeight: 700, color: '#1D6B3F', background: '#DDF3E4',
    borderRadius: 12, padding: '6px 14px', margin: 0,
  },
  // ── check-in ──
  dots: { display: 'flex', justifyContent: 'center', gap: 10 },
  dot: { width: 18, height: 18, borderRadius: '50%', display: 'inline-block' },
  qCard: {
    background: C.surface, borderRadius: 22, padding: '30px 22px',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18,
    boxShadow: '0 6px 22px rgba(15,34,51,0.10)',
  },
  qEmoji: { fontSize: 54, lineHeight: 1 },
  qText: { fontSize: 32, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.35 },
  qOptions: { display: 'flex', flexDirection: 'column', gap: 14, width: '100%' },
  optBtn: {
    width: '100%', minHeight: 76, fontSize: 26, fontWeight: 800,
    color: C.ink, background: C.calmBg, border: `3px solid ${C.sea}`,
    borderRadius: 18, cursor: 'pointer', padding: '12px 16px',
  },
  skipBtn: {
    width: '100%', minHeight: 60, fontSize: 20, fontWeight: 700,
    color: C.muted, background: 'transparent', border: `2px dashed ${C.muted}`,
    borderRadius: 14, cursor: 'pointer',
  },
  // ── crisis panel ──
  crisisPanel: {
    background: '#FFF6F4', border: `5px solid ${C.warnBorder}`, borderRadius: 22,
    padding: '22px 18px', display: 'flex', flexDirection: 'column', gap: 14,
    boxShadow: '0 8px 28px rgba(192,57,43,0.25)',
    position: 'sticky', top: 74, zIndex: 4,
  },
  // Level 3 — visibly stronger: thicker/darker border, deeper shadow.
  crisisPanelHigh: {
    background: '#FFECE8', border: `7px solid ${C.warnInk}`,
    boxShadow: '0 10px 34px rgba(138,36,26,0.42)',
  },
  crisisHighFlag: {
    alignSelf: 'center', margin: 0, fontSize: 20, fontWeight: 900, color: '#FFFFFF',
    background: C.warnInk, borderRadius: 999, padding: '6px 18px', letterSpacing: '0.02em',
  },
  crisisTitle: {
    fontSize: 27, fontWeight: 900, color: C.warnInk, margin: 0,
    textAlign: 'center', lineHeight: 1.4,
  },
  // Level 3 — immediate-safety check, high emphasis.
  crisisSafetyCheck: {
    fontSize: 26, fontWeight: 900, color: '#FFFFFF', margin: 0, textAlign: 'center',
    lineHeight: 1.4, background: C.warnBorder, border: `3px solid ${C.warnInk}`,
    borderRadius: 16, padding: '14px 16px',
  },
  crisisUrgentNote: {
    fontSize: 19, fontWeight: 700, color: C.warnInk, margin: 0, lineHeight: 1.5,
    background: '#FFFFFF', border: `2px solid ${C.warnBorder}`, borderRadius: 12,
    padding: '12px 14px',
  },
  crisisCallMain: {
    display: 'flex', alignItems: 'center', gap: 14,
    minHeight: 96, background: C.warnBorder, border: `4px solid ${C.warnInk}`,
    borderRadius: 18, padding: '14px 18px', textDecoration: 'none',
    boxShadow: '0 4px 14px rgba(138,36,26,0.30)',
  },
  crisisCallSecond: {
    display: 'flex', alignItems: 'center', gap: 14,
    minHeight: 76, background: '#FFFFFF', border: `3px solid ${C.warnBorder}`,
    borderRadius: 18, padding: '10px 18px', textDecoration: 'none',
  },
  // 119 — orange-red, distinct from the deep-red 109 button, level-3 only.
  crisisCall119: {
    display: 'flex', alignItems: 'center', gap: 14,
    minHeight: 96, background: '#E8590C', border: '4px solid #8A3F04',
    borderRadius: 18, padding: '14px 18px', textDecoration: 'none',
    boxShadow: '0 4px 14px rgba(208,90,0,0.35)',
  },
  crisisCallEmoji: { fontSize: 36, lineHeight: 1, flexShrink: 0 },
  crisisCallTextWrap: { display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 },
  crisisCallTitle: { fontSize: 26, fontWeight: 900, color: '#FFFFFF', lineHeight: 1.2 },
  crisisCallSub: { fontSize: 19, fontWeight: 700, color: '#FEE2E2', lineHeight: 1.3 },
  crisisCallNum: { fontSize: 34, fontWeight: 900, color: '#FFFFFF', flexShrink: 0 },
  crisisFamilyBtn: {
    width: '100%', minHeight: 76, fontSize: 24, fontWeight: 900, color: '#FFFFFF',
    background: C.sea, border: `3px solid ${C.seaStrong}`, borderRadius: 18,
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    textDecoration: 'none', fontFamily: 'inherit',
  },
  crisisDismissBtn: {
    minHeight: 56, fontSize: 19, fontWeight: 700, color: C.warnInk,
    background: 'transparent', border: `2px solid ${C.warnInk}`, borderRadius: 14, cursor: 'pointer',
  },
  // ── chat ──
  chatList: { display: 'flex', flexDirection: 'column', gap: 12, minHeight: 160 },
  aiRow: { display: 'flex', justifyContent: 'flex-start' },
  userRow: { display: 'flex', justifyContent: 'flex-end' },
  aiBubble: {
    maxWidth: '88%', background: C.surface, borderRadius: '20px 20px 20px 6px',
    padding: '16px 18px', boxShadow: '0 3px 12px rgba(15,34,51,0.10)',
    display: 'flex', flexDirection: 'column', gap: 10,
  },
  userBubble: {
    maxWidth: '85%', background: C.sea, borderRadius: '20px 20px 6px 20px',
    padding: '16px 18px', boxShadow: '0 3px 12px rgba(10,92,122,0.22)',
  },
  msgText: { fontSize: 24, lineHeight: 1.6, color: C.ink, margin: 0, whiteSpace: 'pre-wrap' },
  replayBtn: {
    alignSelf: 'flex-start', minHeight: 44, fontSize: 17, fontWeight: 700,
    color: C.sea, background: C.calmBg, border: `2px solid ${C.sea}`,
    borderRadius: 12, cursor: 'pointer', padding: '4px 14px',
  },
  // level-1 support card — calm palette on purpose (not the crisis red)
  supportCard: {
    background: C.calmBg, border: `3px solid ${C.sea}`, borderRadius: 18,
    padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 12,
  },
  supportText: { fontSize: 21, fontWeight: 700, color: C.ink, margin: 0, lineHeight: 1.5 },
  supportRow: { display: 'flex', flexDirection: 'column', gap: 10 },
  supportCallBtn: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    minHeight: 64, fontSize: 21, fontWeight: 800, color: C.sea,
    background: '#FFFFFF', border: `3px solid ${C.sea}`, borderRadius: 14,
    textDecoration: 'none', padding: '8px 14px',
  },
  supportCloseBtn: {
    alignSelf: 'center', minHeight: 48, fontSize: 18, fontWeight: 700,
    color: C.muted, background: 'transparent', border: `2px solid ${C.muted}`,
    borderRadius: 12, cursor: 'pointer', padding: '4px 22px',
  },
  // input
  inputArea: {
    background: C.surface, borderRadius: 20, padding: '16px 16px',
    display: 'flex', flexDirection: 'column', gap: 12,
    boxShadow: '0 4px 16px rgba(15,34,51,0.10)',
    position: 'sticky', bottom: 10, zIndex: 3,
  },
  textInput: {
    fontSize: 24, lineHeight: 1.5, color: C.ink,
    background: '#FDFBF6', border: `3px solid ${C.sea}`, borderRadius: 14,
    padding: '14px 16px', width: '100%', boxSizing: 'border-box', minHeight: 72,
    resize: 'none',
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif",
  },
  inputBtnRow: { display: 'flex', gap: 12 },
  micBtn: {
    flex: 1, minHeight: 68, fontSize: 21, fontWeight: 800, color: C.sea,
    background: '#FFFFFF', border: `3px solid ${C.sea}`, borderRadius: 16, cursor: 'pointer',
  },
  micBtnOn: { background: '#FDE8E8', color: C.warnInk, borderColor: C.warnBorder },
  sendBtn: {
    flex: 1, minHeight: 68, fontSize: 24, fontWeight: 900, color: '#FFFFFF',
    background: C.sea, border: 'none', borderRadius: 16, cursor: 'pointer',
  },
  // family
  familyArea: { display: 'flex', flexDirection: 'column', gap: 8 },
  familyBtn: {
    width: '100%', minHeight: 68, fontSize: 22, fontWeight: 800,
    color: C.warm, background: C.warmBg, border: `3px solid ${C.warmBorder}`,
    borderRadius: 16, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
    textDecoration: 'none', fontFamily: 'inherit',
  },
  familyNote: {
    fontSize: 18, lineHeight: 1.5, color: C.inkSoft, margin: 0,
    background: '#EFF4FB', borderRadius: 12, padding: '10px 14px',
  },
  // inline family-number form (daily + crisis)
  familyForm: {
    display: 'flex', flexDirection: 'column', gap: 10,
    background: '#FFFFFF', border: `3px solid ${C.sea}`, borderRadius: 16,
    padding: '16px 18px', boxShadow: '0 4px 16px rgba(15,34,51,0.08)',
  },
  familyFormOnCrisis: {
    border: '3px solid rgba(255,255,255,0.85)',
    boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
  },
  familyFormLead: {
    fontSize: 20, lineHeight: 1.5, color: C.inkSoft, margin: 0, fontWeight: 700,
  },
  familyFormLeadCrisis: {
    fontSize: 20, lineHeight: 1.5, color: C.ink, margin: 0, fontWeight: 800,
  },
  familyFormError: {
    fontSize: 19, lineHeight: 1.4, color: C.warnInk, margin: 0, fontWeight: 700,
    background: C.warnBg, borderRadius: 10, padding: '8px 12px', textAlign: 'center',
  },
  familyFormLabel: {
    fontSize: 20, fontWeight: 800, color: C.ink, margin: '2px 0 -2px',
  },
  familyFormInput: {
    fontSize: 24, lineHeight: 1.4, color: C.ink,
    background: '#FDFBF6', border: `3px solid ${C.sea}`, borderRadius: 14,
    padding: '14px 16px', width: '100%', boxSizing: 'border-box', minHeight: 64,
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', sans-serif",
  },
  familyFormActions: { display: 'flex', gap: 10, marginTop: 4 },
  familyFormSaveBtn: {
    flex: 1, minHeight: 64, fontSize: 22, fontWeight: 900, color: '#FFFFFF',
    background: C.sea, border: 'none', borderRadius: 14, cursor: 'pointer',
  },
  familyFormCancelBtn: {
    minHeight: 64, fontSize: 20, fontWeight: 700, color: C.inkSoft,
    background: '#EFF4FB', border: `2px solid ${C.muted}`, borderRadius: 14,
    cursor: 'pointer', padding: '0 18px',
  },
  familyFormHint: {
    fontSize: 17, lineHeight: 1.45, color: C.muted, margin: 0, textAlign: 'center',
  },
  familyFormHintCrisis: {
    fontSize: 17, lineHeight: 1.45, color: C.inkSoft, margin: 0, textAlign: 'center',
  },
  aboutNote: {
    fontSize: 17, lineHeight: 1.55, color: C.muted, margin: 0, textAlign: 'center',
    padding: '0 8px',
  },
  toast: {
    position: 'fixed', bottom: 28, left: '50%', transform: 'translateX(-50%)',
    background: C.ink, color: '#FFFFFF', fontSize: 21, fontWeight: 700,
    borderRadius: 16, padding: '16px 28px', maxWidth: 520, width: 'calc(100% - 32px)',
    textAlign: 'center', zIndex: 100, boxShadow: '0 6px 24px rgba(15,34,51,0.30)',
    boxSizing: 'border-box',
  },
}

// ── Global CSS ────────────────────────────────────────────────────────────────

const GLOBAL_CSS = `
  .cp-ctrl:focus-visible, .cp-opt:focus-visible, .cp-skip:focus-visible,
  .cp-mic:focus-visible, .cp-send:focus-visible, .cp-replay:focus-visible,
  .cp-family:focus-visible, .cp-crisis-call:focus-visible,
  .cp-crisis-family:focus-visible, .cp-crisis-dismiss:focus-visible,
  .cp-support-call:focus-visible, .cp-support-close:focus-visible,
  .cp-family-save:focus-visible, .cp-family-cancel:focus-visible,
  .cp-input:focus-visible, .cp-family-input:focus-visible {
    outline: 5px solid ${C.focus}; outline-offset: 3px;
  }
  .cp-input:focus, .cp-family-input:focus { outline: 4px solid ${C.sea}; outline-offset: 0; }
  .cp-opt:hover { background: #CFE3FA; }
  .cp-send:hover:not(:disabled) { background: ${C.seaStrong}; }
  .cp-mic:hover { background: #EAF2FB; }
  .cp-family:hover { filter: brightness(0.96); }
  .cp-crisis-call:hover { filter: brightness(0.96); }
  .cp-ctrl, .cp-opt, .cp-skip, .cp-mic, .cp-send, .cp-replay, .cp-family,
  .cp-crisis-call, .cp-crisis-family, .cp-crisis-dismiss,
  .cp-support-call, .cp-support-close, .cp-family-save, .cp-family-cancel {
    transition: transform 0.08s ease, background 0.15s ease, filter 0.15s ease;
    -webkit-tap-highlight-color: transparent;
  }
  .cp-opt:active, .cp-send:active:not(:disabled), .cp-mic:active,
  .cp-crisis-call:active, .cp-crisis-family:active, .cp-family:active,
  .cp-family-save:active:not(:disabled) {
    transform: scale(0.98);
  }
  @media (prefers-reduced-motion: reduce) {
    .cp-ctrl, .cp-opt, .cp-skip, .cp-mic, .cp-send, .cp-replay, .cp-family,
    .cp-crisis-call, .cp-crisis-family, .cp-crisis-dismiss,
    .cp-support-call, .cp-support-close, .cp-family-save, .cp-family-cancel {
      transition: none !important; transform: none !important; filter: none !important;
    }
  }
`
