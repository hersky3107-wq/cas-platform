import type { JejuUiPack } from '@/lib/gunpo/ui-labels'

/**
 * Static disclosure banner placed at the top of the deliberation flow —
 * tells a first-time visitor who the "8 AI" are and that a human official
 * makes the final call. Pure display, no state.
 */
export function GunpoPanelNotice({ t }: { t: JejuUiPack }) {
  return (
    <div className="mb-6 rounded-xl border border-jeju-accent/30 bg-jeju-accent/5 px-4 py-3">
      <p className="text-xs font-bold text-jeju-accent">{t.gunpoPanelNoticeTitle}</p>
      <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-jeju-fg-muted">
        {t.gunpoPanelNoticeBody}
      </p>
    </div>
  )
}

/**
 * Shown at the top of a result report only when the run had no user-submitted
 * attachments — explains why "미확인"/"[확인 필요]" markers appear instead of
 * inventing numbers, and how to get them filled in.
 */
export function PublicDataNotice({ t }: { t: JejuUiPack }) {
  return (
    <p className="whitespace-pre-line rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
      {t.publicDataNoticeBody}
    </p>
  )
}
