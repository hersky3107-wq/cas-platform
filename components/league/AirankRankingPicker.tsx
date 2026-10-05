'use client'

import { useState } from 'react'
import {
  BRAND_TABLE_FIELDS,
  currentBrandTableSlot,
  type BrandTableFieldId,
  type BrandTableHorizon,
} from '@/lib/league/ai-ranking/brand-table'
import { brandTableCopy } from '@/lib/league/ai-ranking/brand-table-copy'
import type { LeagueLocale } from '@/lib/league/i18n/locales'
import type { UiHorizon } from '@/lib/league/horizon'

export function AirankRankingPicker({
  locale,
  onOpen,
}: {
  locale: LeagueLocale
  onOpen: (instrument: string, horizon: UiHorizon) => void
}) {
  const c = brandTableCopy(locale)
  const [fieldId, setFieldId] = useState<BrandTableFieldId>('overall')
  const [period, setPeriod] = useState<BrandTableHorizon>('1w')
  const [busy, setBusy] = useState(false)

  function selectField(id: BrandTableFieldId) {
    setFieldId(id)
    if (id !== 'overall') setPeriod('1m')
  }

  function open() {
    if (busy) return
    setBusy(true)
    const slot = currentBrandTableSlot(fieldId, period)
    onOpen(slot.instrument, slot.horizon)
    setBusy(false)
  }

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white px-4 py-4"
      data-testid="airank-ranking-picker"
    >
      <p className="text-sm font-semibold text-slate-900">{c.sectionTitle}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {BRAND_TABLE_FIELDS.map((field) => (
          <button
            key={field.id}
            type="button"
            onClick={() => selectField(field.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              fieldId === field.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
            }`}
          >
            {c.fields[field.id]}
          </button>
        ))}
      </div>
      {fieldId === 'overall' ? (
        <div className="mt-2 flex gap-1.5">
          {(['1w', '1m'] as const).map((h) => (
            <button
              data-testid={h === '1w' ? 'airank-period-week' : 'airank-period-month'}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                period === h ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
              }`}
            >
              {h === '1w' ? c.periodWeek : c.periodMonth}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-2 flex gap-1.5">
          <button
            type="button"
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
          >
            {c.periodMonth}
          </button>
        </div>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={open}
        className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50 md:max-w-sm"
        data-testid="airank-ranking-open"
      >
        {c.viewButton}
      </button>
    </section>
  )
}
