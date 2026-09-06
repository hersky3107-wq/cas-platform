'use client'

/**
 * AI에게 물어보기 — 메인 화면 상단의 질문 상자 (사장님 스펙 그대로).
 *
 * "9월에 아직 안 들어온 거 뭐야" 같은 질문을 서버의 /ask 라우트로 보낸다.
 * 서버는 해당 월의 실제 데이터만(행 수 상한 있음) 모델에게 주고, 모델은
 * 그 안에서만 답한다. 답은 항상 "AI 추정" 라벨 + 신뢰도와 함께 표시되고,
 * 근거가 된 실제 행(citations)을 펼쳐 확인할 수 있다.
 */

import { useState } from 'react'
import {
  apiJson,
  BADGE_AI,
  BTN_PRIMARY,
  CARD,
  CONFIDENCE_BADGE,
  ERROR_TEXT,
  INPUT,
  confidenceKo,
  type AskResponse,
} from '../_lib/ui'

const EXAMPLES = ['이번 달에 아직 안 들어온 거 뭐야?', '하나카드로 얼마 팔았어?', '지난주 매출이랑 입금 맞아?']

export default function AskBox({ month }: { month: string }) {
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AskResponse | null>(null)
  const [showCitations, setShowCitations] = useState(false)

  const ask = async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed || asking) return
    setAsking(true)
    setError(null)
    setResult(null)
    setShowCitations(false)
    try {
      const res = await apiJson<AskResponse>('/api/reconciliation/ask', {
        method: 'POST',
        json: { question: trimmed, month },
      })
      setResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAsking(false)
    }
  }

  const truncated = result?.bounds.sales_truncated || result?.bounds.deposits_truncated

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <span className={BADGE_AI}>AI</span>
        <h2 className="text-base font-bold text-slate-900">궁금한 거 물어보세요</h2>
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void ask(question)
        }}
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={EXAMPLES[0]}
          maxLength={300}
          className={INPUT}
        />
        <button type="submit" className={`${BTN_PRIMARY} shrink-0`} disabled={asking || !question.trim()}>
          {asking ? '생각 중…' : '물어보기'}
        </button>
      </form>

      {!result && !asking ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-100"
              onClick={() => {
                setQuestion(ex)
                void ask(ex)
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className={ERROR_TEXT}>{error}</p> : null}

      {result ? (
        <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={BADGE_AI}>AI 추정 — 사실 확정 아님</span>
            <span className={CONFIDENCE_BADGE[result.confidence]}>믿을만함: {confidenceKo(result.confidence)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-900">{result.answer}</p>
          {truncated ? (
            <p className="mt-1.5 text-xs text-amber-700">
              자료가 많아 일부만 보고 답했어요 — 빠진 게 있을 수 있어요.
            </p>
          ) : null}
          {result.citations.length > 0 ? (
            <div className="mt-2">
              <button
                type="button"
                className="text-xs font-semibold text-sky-700 underline underline-offset-2"
                onClick={() => setShowCitations((v) => !v)}
              >
                {showCitations ? '근거 접기' : `근거 ${result.citations.length}줄 보기`}
              </button>
              {showCitations ? (
                <ul className="mt-1.5 space-y-1 rounded-lg bg-white/80 p-2">
                  {result.citations.map((c) => (
                    <li key={c.ref} className="text-xs leading-relaxed text-slate-700">
                      <span className="mr-1 font-mono font-semibold text-slate-500">{c.ref}</span>
                      {c.text.replace(/^\S+\s/, '')}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
