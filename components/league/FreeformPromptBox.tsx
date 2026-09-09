'use client'

import { useEffect, useState } from 'react'
import { creditsForLeagueGenerate } from '@/lib/credits'
import type { PublicCategoryId } from '@/lib/league/catalog'
import type { UiHorizon } from '@/lib/league/horizon'
import { useLeagueLocale } from '@/lib/league/i18n/use-league-locale'

type ClarifyOption = { id: string; label: string }
type ClarifyQuestion = {
  slot: string
  prompt: string
  allow_free_input?: boolean
  options: ClarifyOption[]
}

type CatalogChip = { id: string; label: string }

type GatewayResponse =
  | { status: 'refused'; refusal: { code: string; message: string }; catalog_chips?: CatalogChip[] }
  | {
      status: 'clarify'
      confirm?: boolean
      preview_proposition?: string | null
      questions: ClarifyQuestion[]
    }
  | {
      status: 'ready'
      instrument: string
      horizon: UiHorizon | string
      proposition_text: string
      charged_credits: number
      gateway_receipt: string
    }

export function FreeformPromptBox({
  categoryId,
  onRoundOpened,
  onPickInstrument,
}: {
  categoryId: PublicCategoryId
  onRoundOpened: (instrument: string, horizon: UiHorizon) => void
  onPickInstrument?: (instrument: string) => void
}) {
  const { t, locale } = useLeagueLocale()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [clarifyRound, setClarifyRound] = useState(0)
  const [answered, setAnswered] = useState<Record<string, string>>({})
  const [question, setQuestion] = useState<ClarifyQuestion | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [refusalChips, setRefusalChips] = useState<CatalogChip[]>([])
  const [freeDraft, setFreeDraft] = useState('')
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    setQuestion(null)
    setConfirm(false)
    setRefusal(null)
    setRefusalChips([])
    setAnswered({})
    setClarifyRound(0)
    setFreeDraft('')
    setPreview(null)
  }, [categoryId])

  async function submit(nextAnswered: Record<string, string>, nextRound: number) {
    if (busy) return
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    setRefusal(null)
    setRefusalChips([])
    try {
      const res = await fetch('/api/league/gateway', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: categoryId,
          raw_text: text,
          locale,
          answered_slots: nextAnswered,
          clarify_round: nextRound,
        }),
      })
      const body = (await res.json()) as GatewayResponse | { error?: string; code?: string }
      if (res.status === 401) {
        setRefusal(t.gateway.refusal.generic)
        return
      }
      if (res.status === 429) {
        setRefusal(t.hub.rateLimited)
        return
      }
      if (!res.ok || !('status' in body)) {
        setRefusal(t.hub.genericError)
        return
      }
      if (body.status === 'refused') {
        setQuestion(null)
        setConfirm(false)
        setPreview(null)
        setRefusal(body.refusal.message)
        setRefusalChips(body.catalog_chips ?? [])
        return
      }
      if (body.status === 'clarify') {
        setAnswered(nextAnswered)
        setClarifyRound(nextRound)
        setQuestion(body.questions[0] ?? null)
        setConfirm(Boolean(body.confirm))
        setPreview(body.preview_proposition ?? null)
        return
      }
      setQuestion(null)
      setConfirm(false)
      setPreview(null)
      await startGenerate(body)
    } catch {
      setRefusal(t.hub.genericError)
    } finally {
      setBusy(false)
    }
  }

  async function startGenerate(ready: Extract<GatewayResponse, { status: 'ready' }>) {
    const horizon = (['1d', '1w', '1m', '3m'] as const).includes(ready.horizon as UiHorizon)
      ? (ready.horizon as UiHorizon)
      : '1d'
    const res = await fetch('/api/league/generate-stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instrument: ready.instrument,
        horizon,
        gateway_receipt: ready.gateway_receipt,
      }),
    })
    if (res.status === 402) {
      setRefusal(t.hub.insufficientCredits(creditsForLeagueGenerate(), 0))
      return
    }
    if (!res.ok || !res.body) {
      setRefusal(t.hub.genericError)
      return
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let opened = false
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line) as { type?: string }
          if ((msg.type === 'round' || msg.type === 'done') && !opened) {
            opened = true
            onRoundOpened(ready.instrument, horizon)
          }
        } catch {
          /* skip a torn line */
        }
      }
    }
    if (!opened) onRoundOpened(ready.instrument, horizon)
  }

  function tapOption(optionId: string) {
    const slot = question?.slot
    if (!slot) return
    const next = { ...answered, [slot]: optionId }
    // Confirm is not a slot-clarify; it must not consume the 2-round cap.
    const nextRound = slot === 'entity_confirmed' ? clarifyRound : clarifyRound + 1
    void submit(next, nextRound)
  }

  function tapFreeInput() {
    const slot = question?.slot
    const mention = freeDraft.trim()
    if (!slot || !mention) return
    const next = { ...answered, [slot]: mention }
    void submit(next, clarifyRound + 1)
  }

  function retry() {
    setRefusal(null)
    setRefusalChips([])
    setQuestion(null)
    setConfirm(false)
    setAnswered({})
    setClarifyRound(0)
    setFreeDraft('')
    setPreview(null)
  }

  return (
    <div className="rounded-2xl bg-white px-3 py-3 shadow-sm">
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !question && !refusal) void submit({}, 0)
          }}
          placeholder={t.gateway.placeholder[categoryId]}
          maxLength={200}
          disabled={busy}
          className="min-h-[44px] flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none focus:border-slate-400"
        />
        <button
          type="button"
          disabled={busy || draft.trim().length < 4}
          onClick={() => void submit({}, 0)}
          className="min-h-[44px] shrink-0 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? t.gateway.opening : t.gateway.submit}
        </button>
      </div>

      {question && !refusal ? (
        <div className="mt-3">
          {preview ? <p className="mb-2 text-sm leading-relaxed text-slate-800">{preview}</p> : null}
          <p className="text-xs font-semibold text-slate-700">{question.prompt}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {question.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={busy}
                onClick={() => tapOption(opt.id)}
                className={`rounded-full px-3 py-2 text-xs font-semibold transition disabled:opacity-50 ${
                  confirm
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {question.allow_free_input ? (
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={freeDraft}
                onChange={(e) => setFreeDraft(e.target.value)}
                placeholder={t.gateway.freeInputPlaceholder}
                maxLength={80}
                disabled={busy}
                className="min-h-[40px] flex-1 rounded-xl border border-slate-200 px-3 text-xs outline-none focus:border-slate-400"
              />
              <button
                type="button"
                disabled={busy || freeDraft.trim().length < 1}
                onClick={tapFreeInput}
                className="rounded-full bg-slate-100 px-3 text-xs font-semibold text-slate-800 disabled:opacity-50"
              >
                {t.gateway.freeInput}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {refusal ? (
        <div className="mt-3 rounded-xl border border-dashed border-rose-200 bg-rose-50 px-3 py-3">
          <p className="text-sm font-semibold text-rose-900">{t.gateway.refuseTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-rose-800">{refusal}</p>
          {refusalChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {refusalChips.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    retry()
                    onPickInstrument?.(chip.id)
                  }}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-100 disabled:opacity-50"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={retry}
            className="mt-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 shadow-sm"
          >
            {t.gateway.retry}
          </button>
        </div>
      ) : null}
    </div>
  )
}
