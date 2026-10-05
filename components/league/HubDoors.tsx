'use client'

import type { PublicCategoryId } from '@/lib/league/catalog'
import { chipsForDoor, type HubDoor, type HubDoorFilter } from '@/lib/league/hub-doors'
import { leagueSurfaceCopy } from '@/lib/league/i18n/surface-copy'
import type { LeagueLocale } from '@/lib/league/i18n/locales'

export function HubDoors({
  categories,
  door,
  locale,
  labelFor,
  onChooseDoor,
  onShowAll,
  onSelectCategory,
}: {
  categories: readonly { id: PublicCategoryId }[]
  door: HubDoorFilter
  locale: LeagueLocale
  labelFor: (id: PublicCategoryId) => string
  onChooseDoor: (door: HubDoor) => void
  onShowAll: () => void
  onSelectCategory: (id: PublicCategoryId) => void
}) {
  const copy = leagueSurfaceCopy(locale).doors
  const memecoinHidden = !categories.some((row) => row.id === 'memecoin')
  const financeBody =
    memecoinHidden && copy.financeBodyNoMemecoin ? copy.financeBodyNoMemecoin : copy.financeBody
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <DoorCard
          active={door === 'finance'}
          title={copy.financeTitle}
          body={financeBody}
          hint={copy.financeHint}
          testId="door-finance"
          chips={chipsForDoor(categories, 'finance')}
          labelFor={labelFor}
          onOpen={() => onChooseDoor('finance')}
          onSelectCategory={onSelectCategory}
        />
        <DoorCard
          active={door === 'world'}
          title={copy.worldTitle}
          body={copy.worldBody}
          hint={copy.worldHint}
          testId="door-world"
          chips={chipsForDoor(categories, 'world')}
          labelFor={labelFor}
          onOpen={() => onChooseDoor('world')}
          onSelectCategory={onSelectCategory}
        />
      </div>
      {door !== 'all' ? (
        <button
          type="button"
          onClick={onShowAll}
          className="self-start text-[11px] font-semibold text-league-accent-strong underline-offset-2 hover:underline"
          data-testid="door-show-all"
        >
          {copy.showAll}
        </button>
      ) : null}
    </div>
  )
}

function DoorCard({
  active,
  title,
  body,
  hint,
  testId,
  chips,
  labelFor,
  onOpen,
  onSelectCategory,
}: {
  active: boolean
  title: string
  body: string
  hint: string
  testId: string
  chips: readonly { id: PublicCategoryId }[]
  labelFor: (id: PublicCategoryId) => string
  onOpen: () => void
  onSelectCategory: (id: PublicCategoryId) => void
}) {
  return (
    <article
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
      className={`rounded-2xl border px-4 py-4 ${
        active
          ? 'border-league-accent bg-league-accent-soft'
          : 'border-league-border bg-league-bg-elevated'
      }`}
    >
      <button type="button" onClick={onOpen} className="w-full text-left">
        <p className="text-lg font-bold text-league-fg md:text-xl">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-league-fg-muted md:text-sm">{body}</p>
        <p className="mt-2 text-[11px] font-semibold text-league-accent-strong">{hint}</p>
      </button>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            onClick={() => onSelectCategory(chip.id)}
            className="rounded-full bg-league-bg px-2.5 py-1 text-[11px] font-semibold text-league-fg ring-1 ring-league-border"
          >
            {labelFor(chip.id)}
          </button>
        ))}
      </div>
    </article>
  )
}
