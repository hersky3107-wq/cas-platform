import type { HazardIconKind } from '@/lib/crisis/ui/hazards'

const PATHS: Record<HazardIconKind, string> = {
  rain: 'M12 3v2M7 6l1.2 1.6M17 6l-1.2 1.6M6 13a6 6 0 0 1 12 0c0 4-3 7-6 9-3-2-6-5-6-9z',
  river: 'M4 7c2 2 4 2 6 0s4-2 6 0 4 2 6 0M4 12c2 2 4 2 6 0s4-2 6 0 4 2 6 0M4 17c2 2 4 2 6 0s4-2 6 0 4 2 6 0',
  dam: 'M4 20V8l8-5 8 5v12M8 20V11h8v9M10 14h4',
  disease: 'M12 3v18M5 8h14M7 16h10M9 5l6 14M15 5L9 19',
  conflict: 'M5 19 9 5l3 4 3-4 4 14M8 13h8',
  fire: 'M12 21c4 0 6-3 6-7 0-5-4-8-6-11-2 3-6 6-6 11 0 4 2 7 6 7z',
  quake: 'M3 13h4l2-6 3 10 2-6h7',
}

export function HazardIcon({ kind, color = 'currentColor', size = 18 }: { kind: HazardIconKind; color?: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[kind]} />
    </svg>
  )
}

export function HazardIconRow({
  kinds,
  color,
}: {
  kinds: HazardIconKind[]
  color?: string
}) {
  if (kinds.length === 0) return null
  return (
    <span className="inline-flex items-center gap-1.5">
      {kinds.map((kind) => (
        <HazardIcon key={kind} kind={kind} color={color} />
      ))}
    </span>
  )
}
