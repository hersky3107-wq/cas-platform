'use client'

/**
 * Shared AX COUNCIL brand band + trade/warroom segmented toggle.
 * Rendered at the top of every motie page (inside JejuThemeShell) so the mode
 * choice is always visible and consistent. Copy is mode-specific (placeholder).
 */

import { useJejuUi } from './useJejuUi'
import { useMotieMode, type MotieMode } from './mode-context'

export function MotieModeBand() {
  const { t } = useJejuUi()
  const { mode, setMode } = useMotieMode()

  const options: { key: MotieMode; label: string; sub: string }[] = [
    { key: 'trade', label: t.modeTrade, sub: t.modeTradeEn },
    { key: 'warroom', label: t.modeWarroom, sub: t.modeWarroomEn },
  ]
  const copy = mode === 'trade' ? t.tradeCopy : t.warroomCopy

  return (
    <div className="border-b border-jeju-border bg-jeju-bg-elevated px-4 py-4 sm:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-black tracking-[0.25em] text-jeju-accent">
              {t.brandTitle}
            </p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-jeju-fg-muted">
              {t.brandSubtitle}
            </p>
          </div>

          <div
            role="tablist"
            aria-label={t.brandTitle}
            className="inline-flex rounded-xl border border-jeju-border bg-jeju-bg p-1"
          >
            {options.map((o) => {
              const active = o.key === mode
              return (
                <button
                  key={o.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMode(o.key)}
                  className={`rounded-lg px-3 py-1.5 text-center transition ${
                    active
                      ? 'bg-jeju-accent text-white shadow-sm'
                      : 'text-jeju-fg-muted hover:bg-jeju-tile-hover'
                  }`}
                >
                  <span className="block text-xs font-bold leading-tight sm:text-sm">
                    {o.label}
                  </span>
                  <span
                    className={`block text-[10px] font-medium leading-tight ${
                      active ? 'text-white/80' : 'text-jeju-fg-muted/70'
                    }`}
                  >
                    {o.sub}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <p className="text-xs leading-relaxed text-jeju-fg-muted sm:text-sm">{copy}</p>
      </div>
    </div>
  )
}
