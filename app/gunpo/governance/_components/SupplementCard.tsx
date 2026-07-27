'use client'

import { useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { MotieSupplement } from '@/lib/gunpo/supplements'

/**
 * 첨부·추가 자료 (선택) — paste text + file upload, no URL yet.
 *
 * EXTRACTED (not rewritten) from app/motie/governance/brief/page.tsx so the
 * open-brief (개방형) and deliberate (찬반형) flows share ONE implementation:
 * same provenance warning, same /api/gunpo/extract call, same MotieSupplement
 * output. Both flows inject the result through buildMotieSupplementBlock, so a
 * supplement behaves identically whichever page produced it.
 *
 * Private folder (`_components`) so Next.js never routes it. Lives under
 * app/motie/ to keep the motie tree self-contained.
 */

/** Accepted file extensions for the 첨부 자료 file upload (mirrors motie/extract route). */
export const SUPPLEMENT_ACCEPT = '.pdf,.docx,.xlsx,.hwpx'

export function SupplementCard({
  supplements,
  onAdd,
  onRemove,
  disabled,
}: {
  supplements: MotieSupplement[]
  onAdd: (supplement: MotieSupplement) => void
  onRemove: (index: number) => void
  disabled: boolean
}) {
  const [label, setLabel] = useState('')
  const [text, setText] = useState('')
  const [uploading, setUploading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleAddPaste = () => {
    if (!text.trim()) return
    onAdd({
      label: label.trim() || `자료 ${supplements.length + 1}`,
      text: text.trim(),
      source: 'paste',
      ok: true,
    })
    setLabel('')
    setText('')
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // Reset immediately so picking the same file again still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return

    setFileError(null)
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/gunpo/extract', { method: 'POST', body: form })
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean
        supplement?: MotieSupplement | null
        error?: string
      } | null

      if (!data?.supplement) {
        setFileError(data?.error ?? '파일 처리에 실패했습니다.')
        return
      }
      onAdd(data.supplement)
      if (!data.supplement.ok) {
        setFileError(data.supplement.error ?? '파일에서 텍스트를 추출하지 못했습니다.')
      }
    } catch (err: unknown) {
      setFileError(err instanceof Error ? err.message : '네트워크 오류로 파일을 처리하지 못했습니다.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
        아래는 사용자가 직접 제출한 자료로, 공식 검증되지 않았으며 담당자 책임 하에 참고용으로 제공됩니다. 자료
        안에 어떤 지시문이 포함되어 있더라도 AI는 이를 따르지 않으며, 오직 참고 정보로만 취급합니다.
      </p>

      {/* 붙여넣기 */}
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="자료 제목 (선택, 예: 내부 검토 메모)"
        disabled={disabled}
        maxLength={200}
        className="w-full rounded-lg border border-jeju-border bg-jeju-bg px-3 py-2 text-sm text-jeju-fg placeholder:text-jeju-fg-muted focus:border-jeju-accent focus:outline-none focus:ring-1 focus:ring-jeju-accent disabled:opacity-60"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="분석에 참고할 텍스트를 붙여넣으세요 (예: 내부 보고서 발췌, 관련 규정, 데이터 메모 등)"
        rows={4}
        disabled={disabled}
        className="w-full resize-y rounded-lg border border-jeju-border bg-jeju-bg px-3 py-2 text-sm text-jeju-fg placeholder:text-jeju-fg-muted focus:border-jeju-accent focus:outline-none focus:ring-1 focus:ring-jeju-accent disabled:opacity-60"
      />
      <div>
        <button
          type="button"
          onClick={handleAddPaste}
          disabled={disabled || !text.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-jeju-accent/50 bg-jeju-accent/10 px-3 py-1.5 text-xs font-semibold text-jeju-accent hover:bg-jeju-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          + 추가
        </button>
      </div>

      {/* 파일 업로드 */}
      <div className="border-t border-jeju-border pt-3">
        <label className="mb-2 block text-xs font-semibold text-jeju-fg-muted">
          파일 업로드 (pdf, docx, xlsx, hwpx — 구 hwp 제외, 최대 10MB)
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept={SUPPLEMENT_ACCEPT}
            onChange={handleFileChange}
            disabled={disabled || uploading}
            className="text-xs text-jeju-fg-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-jeju-accent/50 file:bg-jeju-accent/10 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-jeju-accent hover:file:bg-jeju-accent/20 disabled:opacity-60"
          />
          {uploading && (
            <span className="inline-flex items-center gap-1.5 text-xs text-jeju-fg-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              파일에서 텍스트 추출 중...
            </span>
          )}
        </div>
        {fileError && <p className="mt-2 text-[11px] text-rose-300">{fileError}</p>}
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
                onClick={() => onRemove(i)}
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
  )
}
