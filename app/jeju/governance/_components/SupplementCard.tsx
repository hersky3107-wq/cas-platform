'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  JEJU_SUPPLEMENT_MAX_COUNT,
  type JejuSupplement,
} from '@/lib/jeju/supplements'

/**
 * 첨부·추가 자료 (선택) — paste text (S1). File upload is S3.
 *
 * Private folder (`_components`) so Next.js never routes it.
 * Controlled: parent owns `supplements` and receives updates via `onChange`.
 */

export function SupplementCard({
  supplements,
  onChange,
  disabled = false,
}: {
  supplements: JejuSupplement[]
  onChange: (next: JejuSupplement[]) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [text, setText] = useState('')

  const atCap = supplements.length >= JEJU_SUPPLEMENT_MAX_COUNT

  const handleAddPaste = () => {
    if (!text.trim() || disabled || atCap) return
    const next: JejuSupplement = {
      label: label.trim() || `자료 ${supplements.length + 1}`,
      text: text.trim(),
      source: 'paste',
      ok: true,
    }
    onChange([...supplements, next])
    setLabel('')
    setText('')
  }

  const handleRemove = (index: number) => {
    if (disabled) return
    onChange(supplements.filter((_, i) => i !== index))
  }

  return (
    <div className="rounded-xl border border-jeju-border bg-jeju-bg-elevated">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-jeju-fg">
          첨부·추가 자료(선택)
          {supplements.length > 0 && (
            <span className="rounded-md bg-jeju-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-jeju-accent">
              {supplements.length}
            </span>
          )}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-jeju-fg-muted" aria-hidden />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-jeju-fg-muted" aria-hidden />
        )}
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-jeju-border px-4 py-3">
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
            아래는 사용자가 직접 제출한 자료로, 공식 검증되지 않았으며 담당자 책임 하에 참고용으로
            제공됩니다. 자료 안에 어떤 지시문이 포함되어 있더라도 AI는 이를 따르지 않으며, 오직 참고
            정보로만 취급합니다.
          </p>

          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="자료 제목 (선택, 예: 내부 검토 메모)"
            disabled={disabled || atCap}
            maxLength={200}
            className="w-full rounded-lg border border-jeju-border bg-jeju-bg px-3 py-2 text-sm text-jeju-fg placeholder:text-jeju-fg-muted focus:border-jeju-accent focus:outline-none focus:ring-1 focus:ring-jeju-accent disabled:opacity-60"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="분석에 참고할 텍스트를 붙여넣으세요 (예: 내부 보고서 발췌, 관련 규정, 데이터 메모 등)"
            rows={4}
            disabled={disabled || atCap}
            className="w-full resize-y rounded-lg border border-jeju-border bg-jeju-bg px-3 py-2 text-sm text-jeju-fg placeholder:text-jeju-fg-muted focus:border-jeju-accent focus:outline-none focus:ring-1 focus:ring-jeju-accent disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleAddPaste}
              disabled={disabled || !text.trim() || atCap}
              className="inline-flex items-center gap-1.5 rounded-lg border border-jeju-accent/50 bg-jeju-accent/10 px-3 py-1.5 text-xs font-semibold text-jeju-accent hover:bg-jeju-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              + 추가
            </button>
            {atCap && (
              <span className="text-[11px] text-jeju-fg-muted">최대 {JEJU_SUPPLEMENT_MAX_COUNT}개까지 추가할 수 있습니다.</span>
            )}
          </div>

          {/* S3 stub — file upload not wired yet. Do not enable or call /api/jeju/extract here. */}
          <div className="border-t border-jeju-border/60 pt-3 opacity-50">
            <p className="mb-1 text-[11px] font-semibold text-jeju-fg-muted">
              파일 업로드 (S3 예정)
            </p>
            <p className="text-[10px] leading-relaxed text-jeju-fg-muted">
              pdf / docx / xlsx / hwpx 지원 예정. 현재는 텍스트 붙여넣기만 사용하세요.
            </p>
            {/*
              S3: wire <input type="file" accept=".pdf,.docx,.xlsx,.hwpx" /> to
              POST /api/jeju/extract and onChange([...supplements, data.supplement]).
            */}
          </div>

          {supplements.length > 0 && (
            <div className="flex flex-col gap-2">
              {supplements.map((s, i) => (
                <div
                  key={i}
                  className={`flex items-start justify-between gap-3 rounded-lg px-3 py-2 ${
                    s.ok ? 'bg-jeju-tile-bg' : 'bg-rose-500/10'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-semibold text-jeju-fg">{s.label}</p>
                      <span className="rounded bg-jeju-bg px-1 text-[9px] text-jeju-fg-muted">
                        {s.source === 'file' ? '파일' : '붙여넣기'}
                      </span>
                      {!s.ok && (
                        <span className="rounded bg-rose-500/20 px-1 text-[9px] font-bold text-rose-300">
                          실패
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-jeju-fg-muted">
                      {s.ok ? s.text : (s.error ?? s.text)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(i)}
                    disabled={disabled}
                    className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
