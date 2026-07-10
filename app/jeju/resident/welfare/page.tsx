'use client'

/**
 * 복지·행정 — Jeju resident welfare / administration chip (last resident chip).
 *
 * THREE tabs:
 *   1. 지원금 찾기  → POST /api/domin/welfare/match  { age,job,situation,household }
 *   2. 민원 안내    → GET  /api/domin/welfare/guide?topic=
 *   3. 마감 임박 공고 → GET  /api/domin/welfare (deadline-soon calendar)
 *
 * Styling: adult density — mirrors prices / events chip tone.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FriendlyErrors } from '@/components/jeju/FriendlyErrors'

// ── Design tokens ─────────────────────────────────────────────────────────────

const C = {
  bg: '#FBF4E6',
  surface: '#FFFFFF',
  ink: '#12263A',
  inkSoft: '#3C4C60',
  sea: '#0E4E8A',
  seaStrong: '#0A3A66',
  seaLight: '#CFE3FA',
  focus: '#E8590C',
  mutedBg: '#F5EAD6',
  mutedBorder: '#D9C6A2',
  mutedInk: '#4E5568',
  green: '#166534',
  greenBg: '#DCFCE7',
  orange: '#E8590C',
  orangeBg: '#FFEDD5',
  blue: '#1D4ED8',
  blueBg: '#DBEAFE',
  warn: '#8A3F04',
  warnBg: '#FEF3C7',
}

// ── API types (mirrors lib/jeju/welfare.ts) ───────────────────────────────────

interface ContextMeta { source: string; retrievedAt: string; asOf: string | null }
interface SubsidyItem {
  name: string; org: string | null; target: string | null; deadline: string | null
  how: string | null; url: string | null; source: '보조금24' | '검색'
  asOf: string | null; note: string | null; deadlineDate: string | null
}
interface MatchResult { ok: boolean; matches: SubsidyItem[]; contextMeta: ContextMeta | null; disclaimer: string; errors: string[] }
interface WelfarePayload { ok: true; deadlineSoon: SubsidyItem[]; windowDays: number; today: string; contextMeta: ContextMeta | null; disclaimer: string; freshnessNote: string; updatedAt: string; errors: string[]; fromCache: boolean }
interface GuideStep { step: number; text: string }
interface GuideResult { ok: boolean; topic: string; intro: string; steps: GuideStep[]; documents: string[]; where: string | null; contextMeta: ContextMeta | null; disclaimer: string; errors: string[]; fromCache: boolean }

type Tab = 'match' | 'guide' | 'deadline'

// ── Situation chips for quick input ──────────────────────────────────────────

const SITUATION_CHIPS = ['임산부', '장애인', '노인', '한부모', '청년', '이주민', '저소득', '농어업인']
const HOUSEHOLD_CHIPS = ['1인 가구', '2인 가구', '다자녀 가구', '노인 가구', '영유아 가구']
const GUIDE_TOPICS = ['전입신고', '종량제봉투 구입', '자동차 등록', '건축 신고', '출생신고', '사망신고', '주민등록등본 발급', '대형폐기물 신고', '전월세 신고', '여권 발급']

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string | null, today: string): number | null {
  if (!dateStr) return null
  const t = new Date(today).getTime()
  const d = new Date(dateStr).getTime()
  return Math.ceil((d - t) / 86400000)
}

function fmtProvenance(meta: ContextMeta): string {
  const date = meta.retrievedAt.slice(0, 10)
  return meta.asOf ? `🔍 검색 · ${meta.asOf} 기준 · ${date} 조회` : `🔍 검색 · ${date} 조회`
}

function todayKst(): string {
  const d = new Date(Date.now() + 9 * 3600000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WelfarePage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('deadline')

  // Tab 1 — match
  const [age, setAge] = useState('')
  const [job, setJob] = useState('')
  const [situation, setSituation] = useState('')
  const [household, setHousehold] = useState('')
  const [matchLoading, setMatchLoading] = useState(false)
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null)
  const [matchError, setMatchError] = useState<string | null>(null)

  // Tab 2 — guide
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [guideLoading, setGuideLoading] = useState(false)
  const [guide, setGuide] = useState<GuideResult | null>(null)
  const [guideError, setGuideError] = useState<string | null>(null)

  // Tab 3 — deadline-soon
  const [welfare, setWelfare] = useState<WelfarePayload | null>(null)
  const [welfareLoading, setWelfareLoading] = useState(true)
  const [welfareError, setWelfareError] = useState<string | null>(null)

  const today = todayKst()
  const abortRef = useRef<AbortController | null>(null)

  // Cleanup
  useEffect(() => () => { abortRef.current?.abort() }, [])

  // Fetch deadline-soon on mount
  useEffect(() => {
    void (async () => {
      setWelfareLoading(true); setWelfareError(null)
      try {
        const res = await fetch('/api/domin/welfare', { cache: 'no-store' })
        const json = await res.json() as WelfarePayload | { ok: false; error: string }
        if (!json.ok) setWelfareError((json as {ok:false;error:string}).error)
        else setWelfare(json as WelfarePayload)
      } catch { setWelfareError('복지 정보를 불러오지 못했어요.') }
      finally { setWelfareLoading(false) }
    })()
  }, [])

  // Match handler
  const onMatch = useCallback(async () => {
    if (matchLoading) return
    setMatchLoading(true); setMatchError(null); setMatchResult(null)
    try {
      const body = {
        ...(age.trim() && Number.isFinite(Number(age)) ? { age: Number(age) } : {}),
        ...(job.trim() ? { job: job.trim() } : {}),
        ...(situation.trim() ? { situation: situation.trim() } : {}),
        ...(household.trim() ? { household: household.trim() } : {}),
      }
      const res = await fetch('/api/domin/welfare/match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
      })
      const json = await res.json() as MatchResult
      if (!json.ok) setMatchError('지원금 찾기에 실패했어요.')
      else setMatchResult(json)
    } catch (e) { setMatchError(e instanceof Error ? e.message : '오류가 발생했어요.') }
    finally { setMatchLoading(false) }
  }, [matchLoading, age, job, situation, household])

  // Guide handler
  const onGuide = useCallback(async (topic: string) => {
    setSelectedTopic(topic); setGuide(null); setGuideError(null); setGuideLoading(true)
    try {
      const res = await fetch(`/api/domin/welfare/guide?topic=${encodeURIComponent(topic)}`, { cache: 'no-store' })
      const json = await res.json() as GuideResult
      if (!json.ok && !json.steps?.length) setGuideError(`안내를 불러오지 못했어요. (${topic})`)
      else setGuide(json)
    } catch (e) { setGuideError(e instanceof Error ? e.message : '오류') }
    finally { setGuideLoading(false) }
  }, [])

  return (
    <div style={S.root}>
      <style>{GLOBAL_CSS}</style>

      {/* Top bar */}
      <div style={S.topBar}>
        <button type="button" className="wf-back" style={S.backBtn}
          onClick={() => router.push('/jeju/resident/general')} aria-label="뒤로 가기">← 뒤로</button>
        <h1 style={S.pageTitle}>🏥 복지·행정</h1>
        <div style={{ minWidth: 44 }} />
      </div>

      {/* Tab bar */}
      <div style={S.tabBar} role="tablist">
        {([['deadline', '📅 마감 공고'], ['match', '💰 지원금 찾기'], ['guide', '📋 민원 안내']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t}
            className="wf-tab"
            style={{ ...S.tabBtn, ...(tab === t ? S.tabBtnActive : {}) }}
            onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      <div style={S.body}>

        {/* ── TAB 3: 마감 임박 공고 ──────────────────────────────────────── */}
        {tab === 'deadline' && (
          <>
            {welfareLoading && <LoadingBox text="공고 불러오는 중…" />}
            {!welfareLoading && welfareError && <ErrorBox msg={welfareError} />}
            {!welfareLoading && welfare && (
              <>
                <div style={S.metaBar}>
                  <span style={S.metaBadge}>오늘부터 {welfare.windowDays}일 이내</span>
                  <span style={S.metaBadge}>{welfare.deadlineSoon.length}건</span>
                  {welfare.fromCache && <span style={{ ...S.metaBadge, color: C.green, background: C.greenBg }}>오늘 캐시</span>}
                </div>
                {welfare.deadlineSoon.length === 0
                  ? <EmptyBox />
                  : welfare.deadlineSoon.map((it, i) => (
                    <SubsidyCard key={i} it={it} today={today} showNote={false} />
                  ))}
                <BottomRow meta={welfare.contextMeta} freshness={welfare.freshnessNote}
                  disclaimer={welfare.disclaimer} errors={welfare.errors} />
              </>
            )}
          </>
        )}

        {/* ── TAB 1: 지원금 찾기 ─────────────────────────────────────────── */}
        {tab === 'match' && (
          <>
            <section style={S.card}>
              <h2 style={S.sectionTitle}>조건 입력 (모두 선택사항)</h2>

              <label style={S.label}>나이
                <input type="number" min={0} max={120} value={age} onChange={e => setAge(e.target.value)}
                  placeholder="예: 45" style={S.input} className="wf-input" />
              </label>

              <label style={S.label}>직업 / 주요 상황
                <input type="text" value={job} onChange={e => setJob(e.target.value)}
                  placeholder="예: 감귤농가, 프리랜서" style={S.input} className="wf-input" />
              </label>

              <div style={S.label}>
                <span>상황</span>
                <div style={S.chipRow}>
                  {SITUATION_CHIPS.map(ch => (
                    <button key={ch} type="button" className="wf-chip"
                      style={{ ...S.chip, ...(situation === ch ? S.chipActive : {}) }}
                      onClick={() => setSituation(s => s === ch ? '' : ch)}>
                      {ch}
                    </button>
                  ))}
                </div>
                <input type="text" value={situation} onChange={e => setSituation(e.target.value)}
                  placeholder="직접 입력" style={{ ...S.input, marginTop: 4 }} className="wf-input" />
              </div>

              <div style={S.label}>
                <span>가구 형태</span>
                <div style={S.chipRow}>
                  {HOUSEHOLD_CHIPS.map(ch => (
                    <button key={ch} type="button" className="wf-chip"
                      style={{ ...S.chip, ...(household === ch ? S.chipActive : {}) }}
                      onClick={() => setHousehold(s => s === ch ? '' : ch)}>
                      {ch}
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" className="wf-ctrl" style={S.searchBtn}
                onClick={() => void onMatch()} disabled={matchLoading}>
                {matchLoading ? '⏳ 찾는 중…' : '🔍 지원금 찾기'}
              </button>
            </section>

            {matchLoading && <LoadingBox text="해당 지원금 찾는 중…" />}
            {!matchLoading && matchError && <ErrorBox msg={matchError} />}
            {!matchLoading && matchResult && (
              <>
                <p style={S.matchCount}>
                  {matchResult.matches.length > 0
                    ? `${matchResult.matches.length}건 발견`
                    : '조건에 맞는 지원금을 찾지 못했어요.'}
                </p>
                {matchResult.matches.map((it, i) => (
                  <SubsidyCard key={i} it={it} today={today} showNote />
                ))}
                <BottomRow meta={matchResult.contextMeta} freshness={null}
                  disclaimer={matchResult.disclaimer} errors={matchResult.errors} />
              </>
            )}
          </>
        )}

        {/* ── TAB 2: 민원 안내 ───────────────────────────────────────────── */}
        {tab === 'guide' && (
          <>
            {!selectedTopic ? (
              <section style={S.card}>
                <h2 style={S.sectionTitle}>어떤 민원이 필요하세요?</h2>
                <div style={S.guideTopics}>
                  {GUIDE_TOPICS.map(t => (
                    <button key={t} type="button" className="wf-topic"
                      style={S.topicBtn} onClick={() => void onGuide(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <>
                <div style={S.guideBreadcrumb}>
                  <button type="button" className="wf-back" style={S.crumbBtn}
                    onClick={() => { setSelectedTopic(null); setGuide(null) }}>
                    ← 목록으로
                  </button>
                  <span style={S.crumbTopic}>{selectedTopic}</span>
                </div>
                {guideLoading && <LoadingBox text={`"${selectedTopic}" 안내 찾는 중…`} />}
                {!guideLoading && guideError && <ErrorBox msg={guideError} />}
                {!guideLoading && guide && (
                  <>
                    {guide.intro && (
                      <section style={S.card}>
                        <p style={S.guideIntro}>{guide.intro}</p>
                      </section>
                    )}
                    {guide.steps.length > 0 && (
                      <section style={S.card}>
                        <h2 style={S.sectionTitle}>신청 절차</h2>
                        <ol style={S.stepList}>
                          {guide.steps.map(s => (
                            <li key={s.step} style={S.stepItem}>
                              <span style={S.stepNum}>{s.step}</span>
                              <span style={S.stepText}>{s.text}</span>
                            </li>
                          ))}
                        </ol>
                      </section>
                    )}
                    {guide.documents.length > 0 && (
                      <section style={S.card}>
                        <h2 style={S.sectionTitle}>📎 준비물</h2>
                        <ul style={S.docList}>
                          {guide.documents.map((d, i) => <li key={i} style={S.docItem}>{d}</li>)}
                        </ul>
                      </section>
                    )}
                    {guide.where && (
                      <section style={S.card}>
                        <h2 style={S.sectionTitle}>📍 신청 장소</h2>
                        <p style={S.whereText}>{guide.where}</p>
                      </section>
                    )}
                    <BottomRow meta={guide.contextMeta} freshness={null}
                      disclaimer={guide.disclaimer} errors={guide.errors} />
                  </>
                )}
              </>
            )}
          </>
        )}

      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SubsidyCard({ it, today, showNote }: { it: SubsidyItem; today: string; showNote: boolean }) {
  const days = daysUntil(it.deadlineDate, today)
  const isUrgent = days != null && days <= 7
  const hasDeadline = it.deadline && it.deadline !== '상시'
  return (
    <article style={S.subsidyCard}>
      <div style={S.subsidyTop}>
        <span style={S.subsidyName}>{it.name}</span>
        <span style={it.source === '보조금24' ? S.srcBadge24 : S.srcBadgeSearch}>
          {it.source === '보조금24' ? '보조금24' : '🔍 검색'}
        </span>
      </div>
      {it.org && <p style={S.subsidyMeta}>🏛 {it.org}</p>}
      {it.target && <p style={S.subsidyMeta}>👤 {it.target}</p>}
      {hasDeadline && (
        <p style={S.subsidyMeta}>
          📅 마감: {it.deadline}
          {days != null && (
            <span style={{ ...S.dBadge, ...(isUrgent ? S.dBadgeUrgent : S.dBadgeSafe) }}>
              {days === 0 ? 'D-Day' : days > 0 ? `D-${days}` : '마감'}
            </span>
          )}
        </p>
      )}
      {!hasDeadline && it.deadline && <p style={S.subsidyMeta}>📅 {it.deadline}</p>}
      {it.how && <p style={S.subsidyMeta}>📝 {it.how}</p>}
      {showNote && it.note && (
        <p style={S.noteText}>ℹ {it.note}</p>
      )}
      {it.url && (
        <a href={it.url} target="_blank" rel="noopener noreferrer" style={S.subsidyLink}>
          자세히 보기 →
        </a>
      )}
    </article>
  )
}

function BottomRow({ meta, freshness, disclaimer, errors }: {
  meta: ContextMeta | null; freshness: string | null;
  disclaimer: string; errors: string[]
}) {
  return (
    <div style={S.bottomRow}>
      {meta && <p style={S.provenance}>{fmtProvenance(meta)}</p>}
      {freshness && <p style={S.freshnessNote}>{freshness}</p>}
      <p style={S.sourceCredit}>자료: 보조금24 + 🔍 검색</p>
      <p style={S.disclaimerText}>⚠ {disclaimer}</p>
      <FriendlyErrors errors={errors} />
    </div>
  )
}

function LoadingBox({ text }: { text: string }) {
  return (
    <div style={S.loadingBox} aria-live="polite" aria-busy="true">
      <span style={{ fontSize: 36 }} aria-hidden>⏳</span>
      <p style={S.loadingText}>{text}</p>
    </div>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div style={S.errorBox} role="alert">
      <p style={S.errorText}>⚠ {msg}</p>
    </div>
  )
}

function EmptyBox() {
  return (
    <div style={S.emptyBox}>
      <p style={S.emptyText}>정보 없음</p>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100dvh', background: C.bg, color: C.ink,
    fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif",
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '0 0 48px', boxSizing: 'border-box',
  },
  topBar: {
    width: '100%', maxWidth: 640, display: 'flex', alignItems: 'center',
    position: 'sticky', top: 0, background: C.bg,
    paddingTop: 12, paddingBottom: 10, paddingLeft: 16, paddingRight: 16,
    zIndex: 6, gap: 10, boxSizing: 'border-box',
  },
  backBtn: {
    minHeight: 44, fontSize: 17, fontWeight: 700, color: C.sea, background: C.surface,
    border: `2px solid ${C.sea}`, borderRadius: 10, cursor: 'pointer', padding: '5px 14px', whiteSpace: 'nowrap',
  },
  pageTitle: { flex: 1, fontSize: 22, fontWeight: 900, color: C.ink, margin: 0, textAlign: 'center', lineHeight: 1.2 },
  tabBar: {
    width: '100%', maxWidth: 640, display: 'flex', gap: 0,
    position: 'sticky', top: 62, background: C.bg, zIndex: 5,
    borderBottom: `2px solid ${C.mutedBorder}`, boxSizing: 'border-box',
  },
  tabBtn: {
    flex: 1, minHeight: 44, fontSize: 13, fontWeight: 700, color: C.mutedInk,
    background: 'transparent', border: 'none',
    borderBottomWidth: 3, borderBottomStyle: 'solid', borderBottomColor: 'transparent',
    cursor: 'pointer', padding: '8px 6px', transition: 'color 0.12s, border-color 0.12s',
  },
  tabBtnActive: { color: C.sea, borderBottomColor: C.sea },
  body: {
    width: '100%', maxWidth: 640, display: 'flex', flexDirection: 'column',
    gap: 14, padding: '14px 16px 0', boxSizing: 'border-box',
  },
  metaBar: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  metaBadge: { fontSize: 13, fontWeight: 700, color: C.sea, background: C.seaLight, borderRadius: 8, padding: '4px 10px' },
  card: {
    background: C.surface, border: `1.5px solid ${C.mutedBorder}`, borderRadius: 16,
    padding: '14px 14px 12px', display: 'flex', flexDirection: 'column', gap: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: 900, color: C.seaStrong, margin: 0, paddingBottom: 6, borderBottom: `1.5px solid ${C.mutedBorder}` },
  loadingBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '32px 0' },
  loadingText: { fontSize: 16, fontWeight: 700, color: C.inkSoft, margin: 0 },
  errorBox: { background: '#FEF2F2', border: '2px solid #FCA5A5', borderRadius: 12, padding: 14 },
  errorText: { fontSize: 15, fontWeight: 700, color: '#B91C1C', margin: 0 },
  emptyBox: { background: C.surface, border: `1.5px solid ${C.mutedBorder}`, borderRadius: 12, padding: '20px 16px', textAlign: 'center' },
  emptyText: { fontSize: 15, color: C.mutedInk, margin: 0 },
  // Match inputs
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 14, fontWeight: 700, color: C.inkSoft },
  input: {
    fontSize: 15, color: C.ink, background: C.mutedBg, border: `1.5px solid ${C.mutedBorder}`,
    borderRadius: 10, padding: '8px 11px', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
  },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip: { fontSize: 13, fontWeight: 700, color: C.sea, background: C.seaLight, borderWidth: '1.5px', borderStyle: 'solid', borderColor: C.mutedBorder, borderRadius: 20, padding: '4px 12px', cursor: 'pointer' },
  chipActive: { background: C.sea, color: '#fff', borderColor: C.sea },
  searchBtn: {
    minHeight: 44, fontSize: 16, fontWeight: 700, color: '#fff', background: C.sea,
    border: 'none', borderRadius: 12, cursor: 'pointer', padding: '8px 20px', alignSelf: 'flex-start',
  },
  matchCount: { fontSize: 14, fontWeight: 700, color: C.mutedInk, margin: 0 },
  // Subsidy card
  subsidyCard: {
    background: C.surface, border: `1.5px solid ${C.mutedBorder}`, borderRadius: 14,
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 5,
  },
  subsidyTop: { display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' },
  subsidyName: { flex: 1, fontSize: 15, fontWeight: 700, color: C.ink, lineHeight: 1.4, wordBreak: 'keep-all' },
  srcBadge24: { fontSize: 11, fontWeight: 700, color: C.blue, background: C.blueBg, borderRadius: 6, padding: '2px 7px', flexShrink: 0, whiteSpace: 'nowrap' },
  srcBadgeSearch: { fontSize: 11, fontWeight: 700, color: '#0E4E8A', background: '#EAF2FB', borderRadius: 6, padding: '2px 7px', flexShrink: 0, whiteSpace: 'nowrap' },
  subsidyMeta: { fontSize: 13, color: C.inkSoft, margin: 0, lineHeight: 1.5 },
  dBadge: { display: 'inline-block', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '1px 7px', marginLeft: 8 },
  dBadgeSafe: { color: C.green, background: C.greenBg },
  dBadgeUrgent: { color: C.orange, background: C.orangeBg },
  noteText: { fontSize: 12, color: C.warn, background: C.warnBg, borderRadius: 6, padding: '4px 8px', margin: 0, lineHeight: 1.4 },
  subsidyLink: { fontSize: 13, fontWeight: 700, color: C.sea, textDecoration: 'underline', alignSelf: 'flex-start', marginTop: 2 },
  // Guide
  guideTopics: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  topicBtn: {
    fontSize: 14, fontWeight: 700, color: C.sea, background: C.seaLight,
    border: `1.5px solid ${C.mutedBorder}`, borderRadius: 12, padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  guideBreadcrumb: { display: 'flex', alignItems: 'center', gap: 10 },
  crumbBtn: { fontSize: 14, fontWeight: 700, color: C.sea, background: C.surface, border: `1.5px solid ${C.sea}`, borderRadius: 8, cursor: 'pointer', padding: '4px 12px', minHeight: 36 },
  crumbTopic: { fontSize: 16, fontWeight: 900, color: C.ink },
  guideIntro: { fontSize: 15, lineHeight: 1.7, color: C.inkSoft, margin: 0 },
  stepList: { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 },
  stepItem: { display: 'flex', gap: 10, alignItems: 'flex-start' },
  stepNum: { minWidth: 24, height: 24, background: C.sea, color: '#fff', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 900, flexShrink: 0, marginTop: 1 },
  stepText: { fontSize: 14, lineHeight: 1.6, color: C.ink, flex: 1 },
  docList: { margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 4 },
  docItem: { fontSize: 14, color: C.inkSoft, lineHeight: 1.5 },
  whereText: { fontSize: 14, color: C.inkSoft, margin: 0, lineHeight: 1.6 },
  // Bottom
  bottomRow: { display: 'flex', flexDirection: 'column', gap: 4 },
  provenance: { fontSize: 12, color: C.mutedInk, margin: 0 },
  freshnessNote: { fontSize: 12, color: C.mutedInk, margin: 0 },
  sourceCredit: { fontSize: 12, color: C.mutedInk, margin: 0 },
  disclaimerText: { fontSize: 12, color: C.warn, background: C.warnBg, borderRadius: 8, padding: '6px 10px', margin: 0, lineHeight: 1.5 },
  errDetails: { background: '#FFFBEB', border: '1.5px solid #FCD34D', borderRadius: 10, padding: '6px 10px' },
  errSummary: { fontSize: 13, fontWeight: 700, color: '#8A3F04', cursor: 'pointer' },
  errList: { margin: '4px 0 0 12px', padding: 0, display: 'flex', flexDirection: 'column', gap: 2 },
  errItem: { fontSize: 12, color: C.mutedInk, lineHeight: 1.4 },
}

const GLOBAL_CSS = `
  .wf-back:focus-visible, .wf-ctrl:focus-visible, .wf-tab:focus-visible,
  .wf-chip:focus-visible, .wf-topic:focus-visible {
    outline: 3px solid ${C.focus}; outline-offset: 2px;
  }
  .wf-back:hover, .wf-ctrl:hover { background: #EAF2FB; }
  .wf-tab:hover { color: ${C.sea}; }
  .wf-chip:hover { background: #BFD9F5; }
  .wf-topic:hover { background: #BFD9F5; border-color: ${C.sea}; }
  .wf-input:focus { border-color: ${C.sea}; box-shadow: 0 0 0 3px ${C.sea}20; }
  .wf-back, .wf-ctrl, .wf-tab, .wf-chip, .wf-topic {
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    -webkit-tap-highlight-color: transparent;
  }
  .wf-back:active, .wf-ctrl:active, .wf-chip:active, .wf-topic:active { transform: scale(0.97); }
  @media (prefers-reduced-motion: reduce) {
    .wf-back, .wf-ctrl, .wf-tab, .wf-chip, .wf-topic { transition: none !important; transform: none !important; }
  }
`
