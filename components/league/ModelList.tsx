'use client'

import { useMemo, useState } from 'react'
import {
  CAMPS,
  CAMP_LABEL,
  LEAGUE_TIERS,
  TIER_LABEL,
  type Camp,
  type CardModelPrediction,
  type LeagueTier,
} from '@/lib/league/card-types'
import type { LeagueUiPack } from '@/lib/league/i18n/dictionary'
import { ModelRow } from './ModelRow'

type GroupBy = 'tier' | 'camp'

/**
 * The per-model list, grouped/sortable by tier or by camp (US vs China vs
 * other). Grouping is purely a client-side VIEW of the already-final
 * `models` array — it never recomputes consensus/camp/tier aggregates
 * (those come from `CardData` and are server-computed, see card-types.ts).
 *
 * Also the re-sort target for Layer 4 streaming: when `useCardStream` merges
 * newly-arrived models into `data.models` (arrival order) and then the round
 * completes, this component naturally re-groups on the next render — no
 * separate "re-sort on completion" step is needed here.
 */
export function ModelList({ models, t }: { models: CardModelPrediction[]; t: LeagueUiPack }) {
  const [groupBy, setGroupBy] = useState<GroupBy>('tier')
  const groups = useMemo(() => groupModels(models, groupBy), [models, groupBy])

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-league-fg-muted">
          {t.modelList.title(models.length)}
        </p>
        <div className="flex gap-0.5 rounded-full bg-league-bg-elevated p-0.5 text-[11px]">
          <GroupToggleButton active={groupBy === 'tier'} onClick={() => setGroupBy('tier')} label={t.modelList.tierTab} />
          <GroupToggleButton active={groupBy === 'camp'} onClick={() => setGroupBy('camp')} label={t.modelList.campTab} />
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.key}>
          <p className="bg-league-bg-elevated px-4 py-1 text-[10px] font-semibold uppercase tracking-wide text-league-fg-muted">
            {group.label} · {group.models.length}
          </p>
          <ul>
            {group.models.map((model) => (
              <ModelRow key={model.model_id} model={model} t={t} />
            ))}
          </ul>
        </div>
      ))}
      {models.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-league-fg-muted">{t.modelList.empty}</p>
      ) : null}
    </div>
  )
}

function GroupToggleButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-2.5 py-0.5 font-semibold transition ${
        active ? 'bg-league-accent text-white' : 'text-league-fg-muted'
      }`}
    >
      {label}
    </button>
  )
}

type Group = { key: string; label: string; models: CardModelPrediction[] }

function groupModels(models: CardModelPrediction[], groupBy: GroupBy): Group[] {
  if (groupBy === 'tier') {
    return LEAGUE_TIERS.map((tier: LeagueTier) => ({
      key: tier,
      label: TIER_LABEL[tier],
      models: models.filter((m) => m.league_tier === tier),
    })).filter((g) => g.models.length > 0)
  }
  return CAMPS.map((camp: Camp) => ({
    key: camp,
    label: CAMP_LABEL[camp],
    models: models.filter((m) => m.camp === camp),
  })).filter((g) => g.models.length > 0)
}
