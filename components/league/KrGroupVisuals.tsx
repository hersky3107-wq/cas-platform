import type { KrGroupId } from '@/lib/league/korea-equity-catalog'

/**
 * Korean-lane group visual system: one fixed muted color + one simple inline
 * SVG icon per group. No external assets, no emoji, no company logos.
 * Tones are chosen to keep ≥ 4.5:1 contrast for text in light mode and to
 * stay legible on dark surfaces (the `dark:` variants).
 */
export type KrGroupVisual = {
  /** Solid accent (dots, icon strokes, left bars). */
  accent: string
  /** Subtle chip tint (hover/selected backgrounds). */
  tint: string
  /** Selected ring color. */
  ring: string
}

export const KR_GROUP_VISUALS: Record<KrGroupId, KrGroupVisual> = {
  semis: {
    accent: 'text-blue-700 dark:text-blue-300',
    tint: 'bg-blue-50 dark:bg-blue-950/40',
    ring: 'ring-blue-600 dark:ring-blue-400',
  },
  electronics: {
    accent: 'text-indigo-700 dark:text-indigo-300',
    tint: 'bg-indigo-50 dark:bg-indigo-950/40',
    ring: 'ring-indigo-600 dark:ring-indigo-400',
  },
  battery: {
    accent: 'text-teal-700 dark:text-teal-300',
    tint: 'bg-teal-50 dark:bg-teal-950/40',
    ring: 'ring-teal-600 dark:ring-teal-400',
  },
  auto: {
    accent: 'text-slate-700 dark:text-slate-300',
    tint: 'bg-slate-100 dark:bg-slate-800/60',
    ring: 'ring-slate-500 dark:ring-slate-400',
  },
  bio: {
    accent: 'text-emerald-700 dark:text-emerald-300',
    tint: 'bg-emerald-50 dark:bg-emerald-950/40',
    ring: 'ring-emerald-600 dark:ring-emerald-400',
  },
  ship_defense: {
    accent: 'text-cyan-700 dark:text-cyan-300',
    tint: 'bg-cyan-50 dark:bg-cyan-950/40',
    ring: 'ring-cyan-600 dark:ring-cyan-400',
  },
  power_machinery: {
    accent: 'text-amber-700 dark:text-amber-300',
    tint: 'bg-amber-50 dark:bg-amber-950/40',
    ring: 'ring-amber-600 dark:ring-amber-400',
  },
  robot_ai: {
    accent: 'text-violet-700 dark:text-violet-300',
    tint: 'bg-violet-50 dark:bg-violet-950/40',
    ring: 'ring-violet-600 dark:ring-violet-400',
  },
  internet_ent: {
    accent: 'text-fuchsia-700 dark:text-fuchsia-300',
    tint: 'bg-fuchsia-50 dark:bg-fuchsia-950/40',
    ring: 'ring-fuchsia-600 dark:ring-fuchsia-400',
  },
  finance: {
    accent: 'text-sky-700 dark:text-sky-300',
    tint: 'bg-sky-50 dark:bg-sky-950/40',
    ring: 'ring-sky-600 dark:ring-sky-400',
  },
  materials_energy: {
    accent: 'text-orange-700 dark:text-orange-300',
    tint: 'bg-orange-50 dark:bg-orange-950/40',
    ring: 'ring-orange-600 dark:ring-orange-400',
  },
  consumer: {
    accent: 'text-rose-700 dark:text-rose-300',
    tint: 'bg-rose-50 dark:bg-rose-950/40',
    ring: 'ring-rose-600 dark:ring-rose-400',
  },
  infra: {
    accent: 'text-lime-700 dark:text-lime-300',
    tint: 'bg-lime-50 dark:bg-lime-950/40',
    ring: 'ring-lime-600 dark:ring-lime-400',
  },
  other: {
    accent: 'text-neutral-600 dark:text-neutral-300',
    tint: 'bg-neutral-100 dark:bg-neutral-800/60',
    ring: 'ring-neutral-500 dark:ring-neutral-400',
  },
}

/** Simple 16×16 stroke icons, one per group. `currentColor` inherits the accent. */
export function KrGroupIcon({ groupId }: { groupId: KrGroupId }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  }
  switch (groupId) {
    case 'semis':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="8" height="8" rx="1" />
          <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" />
        </svg>
      )
    case 'electronics':
      return (
        <svg {...common}>
          <rect x="2" y="4.5" width="12" height="8" rx="1" />
          <path d="M5 12.5v1.5M11 12.5v1.5M6.5 7.5h3" />
        </svg>
      )
    case 'battery':
      return (
        <svg {...common}>
          <rect x="2" y="5.5" width="10" height="6" rx="1" />
          <path d="M12 7v3M5 8l1.5-1M5 9.5 6.5 8.5" />
        </svg>
      )
    case 'auto':
      return (
        <svg {...common}>
          <path d="M2.5 10.5 4 6.5a1 1 0 0 1 1-.7h6a1 1 0 0 1 1 .7l1.5 4" />
          <rect x="2" y="10" width="12" height="3" rx="1" />
          <circle cx="5" cy="13" r="0.4" />
          <circle cx="11" cy="13" r="0.4" />
        </svg>
      )
    case 'bio':
      return (
        <svg {...common}>
          <path d="M6 2.5v3.2L2.8 11.5a1.6 1.6 0 0 0 1.4 2.3h7.6a1.6 1.6 0 0 0 1.4-2.3L10 5.7V2.5" />
          <path d="M5 2.5h6M4.5 10h7" />
        </svg>
      )
    case 'ship_defense':
      return (
        <svg {...common}>
          <path d="M2 11.5h12l-1.2 2H3.2L2 11.5Z" />
          <path d="M4 11.5V8.5h8v3M8 8.5V5.5M6 5.5h4" />
        </svg>
      )
    case 'power_machinery':
      return (
        <svg {...common}>
          <path d="M8.5 1.5 4 9h3.5L7 14.5 12.5 7H9l-.5-5.5Z" />
        </svg>
      )
    case 'robot_ai':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="10" height="8" rx="1.5" />
          <path d="M8 5V2.5M6.5 8.5h.01M9.5 8.5h.01M6 11h4" />
        </svg>
      )
    case 'internet_ent':
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M2 8h12M8 2c1.8 1.6 2.8 3.7 2.8 6S9.8 12.4 8 14c-1.8-1.6-2.8-3.7-2.8-6S6.2 3.6 8 2Z" />
        </svg>
      )
    case 'finance':
      return (
        <svg {...common}>
          <path d="M2 6.5 8 2l6 4.5" />
          <path d="M3.5 6.5v6M6.5 6.5v6M9.5 6.5v6M12.5 6.5v6M2 13.5h12" />
        </svg>
      )
    case 'materials_energy':
      return (
        <svg {...common}>
          <path d="M5 2.5h6M6 2.5v4L2.8 12a1.5 1.5 0 0 0 1.3 2.2h7.8A1.5 1.5 0 0 0 13.2 12L10 6.5v-4" />
          <path d="M5.5 10.5h5" />
        </svg>
      )
    case 'consumer':
      return (
        <svg {...common}>
          <path d="M3 5.5h10l-.8 7a1.4 1.4 0 0 1-1.4 1.3H5.2a1.4 1.4 0 0 1-1.4-1.3L3 5.5Z" />
          <path d="M5.5 5.5a2.5 2.5 0 0 1 5 0" />
        </svg>
      )
    case 'infra':
      return (
        <svg {...common}>
          <path d="M2 13.5h12M4 13.5v-8l4-3 4 3v8" />
          <path d="M6.5 13.5v-3h3v3" />
        </svg>
      )
    case 'other':
      return (
        <svg {...common}>
          <circle cx="4" cy="4" r="1.2" />
          <circle cx="12" cy="4" r="1.2" />
          <circle cx="4" cy="12" r="1.2" />
          <circle cx="12" cy="12" r="1.2" />
        </svg>
      )
  }
}

/** Small colored dot used on the group filter chips. */
export function KrGroupDot({ groupId }: { groupId: KrGroupId }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full bg-current ${KR_GROUP_VISUALS[groupId].accent}`}
    />
  )
}
