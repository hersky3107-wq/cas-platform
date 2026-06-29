'use client'

import { useEffect, useState } from 'react'
import {
  X,
  MapPin,
  Phone,
  Clock,
  Map as MapIcon,
  ExternalLink,
  Info,
} from 'lucide-react'
import {
  type PlaceDetail,
  googleMapsUrl,
  naverMapsUrl,
  kakaoMapsUrl,
} from './place-detail'

/**
 * Detail modal — bottom-sheet on mobile (slides up from bottom, rounded top,
 * drag-handle + X + backdrop dismiss), centered modal on desktop.
 *
 * Renders BOTH card families from the normalized PlaceDetail:
 *   - VisitJeju (isWeb=false): image, address, intro, tags, map links (coords),
 *     phone/hours when available.
 *   - web/sonar (isWeb=true): all known info + a WORKING map-search link by name,
 *     plus an honest "verify location/hours" note.
 */
export function PlaceDetailModal({
  detail,
  onClose,
}: {
  detail: PlaceDetail | null
  onClose: () => void
}) {
  const [show, setShow] = useState(false)
  // Touch drag-to-dismiss state for the mobile sheet.
  const [dragY, setDragY] = useState(0)
  const [dragStart, setDragStart] = useState<number | null>(null)

  const open = detail !== null

  // Enter animation + body scroll lock + Escape to close.
  useEffect(() => {
    if (!open) {
      setShow(false)
      return
    }
    const raf = requestAnimationFrame(() => setShow(true))
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open || !detail) return null

  function handleClose() {
    setShow(false)
    setDragY(0)
    setDragStart(null)
    // Let the exit transition play before unmounting.
    setTimeout(onClose, 200)
  }

  function onTouchStart(e: React.TouchEvent) {
    setDragStart(e.touches[0]!.clientY)
  }
  function onTouchMove(e: React.TouchEvent) {
    if (dragStart === null) return
    const delta = e.touches[0]!.clientY - dragStart
    if (delta > 0) setDragY(delta)
  }
  function onTouchEnd() {
    if (dragY > 90) {
      handleClose()
    } else {
      setDragY(0)
    }
    setDragStart(null)
  }

  const d = detail
  const hasMapLinks = true // every detail can produce at least a name-based search
  // For VisitJeju items coords are reliable; for web items only show buttons when
  // mapTarget is a concrete place (not null).
  const showMapButtons = !d.isWeb || d.mapTarget !== null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={d.title}
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="닫기"
        onClick={handleClose}
        className={`absolute inset-0 bg-[#0A2B30]/45 backdrop-blur-[2px] transition-opacity duration-200 ${
          show ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Sheet / Modal */}
      <div
        className={`relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-[26px] bg-white shadow-[0_-12px_40px_-8px_rgba(0,112,122,0.45)] transition-transform duration-200 ease-out sm:max-h-[86vh] sm:w-[440px] sm:rounded-[24px] sm:shadow-[0_24px_60px_-12px_rgba(0,112,122,0.5)] ${
          show ? 'translate-y-0' : 'translate-y-full sm:translate-y-4 sm:opacity-0'
        }`}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        {/* Mobile drag handle (also a touch target for swipe-down dismiss) */}
        <div
          className="flex shrink-0 cursor-grab justify-center pt-2.5 pb-1 sm:hidden"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <span className="h-1.5 w-11 rounded-full bg-[#00A8B5]/30" aria-hidden />
        </div>

        {/* Close button */}
        <button
          type="button"
          onClick={handleClose}
          aria-label="닫기"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-[#0A2B30] shadow-sm ring-1 ring-[#00A8B5]/15 backdrop-blur transition-colors hover:bg-white"
        >
          <X size={18} strokeWidth={2.5} aria-hidden />
        </button>

        <div className="overflow-y-auto overscroll-contain px-5 pb-7 pt-1 sm:pt-5">
          {/* Image — disabled pending copyright verification; re-enable by
              uncommenting when image rights are confirmed.
          {d.imageUrl && (
            <img src={d.imageUrl} alt={d.title}
              className="mb-4 h-44 w-full rounded-[18px] object-cover ring-1 ring-[#00A8B5]/10"
              loading="lazy" />
          )}
          */}

          {/* Title + subtitle */}
          <h2 className="pr-8 text-[19px] font-extrabold leading-snug tracking-tight text-[#0A2B30]">
            {d.title}
          </h2>
          {d.subtitle && (
            <p className="mt-1 flex items-center gap-1 text-[13px] font-bold text-[#00A8B5]">
              <MapPin size={13} strokeWidth={2.5} aria-hidden />
              {d.subtitle}
            </p>
          )}

          {/* Info rows (period/charm/fare/season/분류 …) */}
          {d.infoRows && d.infoRows.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5">
              {d.infoRows.map((row, i) => (
                <div
                  key={`${row.label}-${i}`}
                  className="flex gap-2 rounded-[12px] bg-[#F0FAFB] px-3 py-2 text-[12.5px] leading-relaxed"
                >
                  <span className="shrink-0 font-extrabold text-[#00707A]">{row.label}</span>
                  <span className="font-medium text-[#0A2B30]">{row.value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Description */}
          {d.description && (
            <p className="mt-3 text-[13px] leading-relaxed text-[#4A5C5F]">{d.description}</p>
          )}

          {/* Address (VisitJeju) */}
          {d.address && (
            <div className="mt-3 flex items-start gap-1.5 text-[12.5px] font-semibold text-[#0A2B30]">
              <MapPin size={14} strokeWidth={2.5} className="mt-0.5 shrink-0 text-[#00A8B5]" aria-hidden />
              <span>{d.address}</span>
            </div>
          )}

          {/* Phone (tap-to-call) */}
          {d.phone && (
            <a
              href={`tel:${d.phone.replace(/[^0-9+]/g, '')}`}
              className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#00707A] underline-offset-2 hover:underline"
            >
              <Phone size={13} strokeWidth={2.5} aria-hidden />
              {d.phone}
            </a>
          )}

          {/* Opening hours */}
          {d.openingHours && (
            <div className="mt-2 flex items-start gap-1.5 text-[12.5px] font-semibold text-slate-500">
              <Clock size={13} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden />
              <span>{d.openingHours}</span>
            </div>
          )}

          {/* Tags */}
          {d.tags && d.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d.tags.slice(0, 6).map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded-full bg-[#F0FAFB] px-2.5 py-0.5 text-[11px] font-semibold text-[#00A8B5]"
                >
                  #{t.replace(/^#/, '')}
                </span>
              ))}
            </div>
          )}

          {/* Caution */}
          {d.caution && (
            <p className="mt-3 flex items-start gap-1.5 rounded-[12px] bg-[#FFF6E5] px-3 py-2 text-[11.5px] font-medium leading-relaxed text-[#B8860B]">
              <span aria-hidden>⚠️</span>
              <span>{d.caution}</span>
            </p>
          )}

          {/* Map links */}
          {hasMapLinks && (
            <div className="mt-5">
              {showMapButtons ? (
                <>
                  <p className="mb-2 flex items-center gap-1.5 text-[12px] font-extrabold text-[#0A2B30]">
                    <MapIcon size={14} strokeWidth={2.5} className="text-[#00A8B5]" aria-hidden />
                    {d.isWeb ? '지도에서 검색해보기 (참고)' : '지도에서 보기 · 길찾기'}
                  </p>
                  {d.isWeb && (
                    <p className="mb-2 text-[11px] leading-relaxed text-slate-400">
                      정확한 위치는 검색 결과를 확인하세요. 행사·캠페인은 특정 장소가 없을 수 있어요.
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <a
                      href={googleMapsUrl(d)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1 rounded-[12px] bg-[#00A8B5] px-2 py-2.5 text-[12px] font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      Google
                      <ExternalLink size={11} strokeWidth={2.5} aria-hidden />
                    </a>
                    <a
                      href={naverMapsUrl(d)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1 rounded-[12px] bg-[#03C75A] px-2 py-2.5 text-[12px] font-bold text-white shadow-sm transition-opacity hover:opacity-90"
                    >
                      네이버
                      <ExternalLink size={11} strokeWidth={2.5} aria-hidden />
                    </a>
                    <a
                      href={kakaoMapsUrl(d)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1 rounded-[12px] bg-[#FEE500] px-2 py-2.5 text-[12px] font-bold text-[#3C1E1E] shadow-sm transition-opacity hover:opacity-90"
                    >
                      카카오
                      <ExternalLink size={11} strokeWidth={2.5} aria-hidden />
                    </a>
                  </div>
                </>
              ) : (
                <p className="flex items-start gap-1.5 rounded-[12px] bg-slate-50 px-3 py-2.5 text-[12px] font-medium leading-relaxed text-slate-500">
                  <Info size={13} strokeWidth={2.5} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />
                  {d.mapNote ?? '이 항목은 특정 장소가 지정되지 않았어요 (여러 장소·기간 진행 또는 캠페인).'}
                </p>
              )}
            </div>
          )}

          {/* Honest note for web items: shown only when there ARE map buttons
              (non-specific items already get an inline "no location" note above). */}
          {d.isWeb && showMapButtons && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
              <Info size={12} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden />
              정확한 위치·운영정보는 지도/공식 채널에서 확인하세요.
            </p>
          )}

          {/* Source footer */}
          <p className="mt-4 border-t border-[#00A8B5]/10 pt-3 text-center text-[11px] font-semibold text-[#00707A]/70">
            {d.isWeb ? '🌐 ' : '📋 '}
            {d.sourceLabel}
          </p>
        </div>
      </div>
    </div>
  )
}
