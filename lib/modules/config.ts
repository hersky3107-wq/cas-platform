export type ModuleStatus = 'active' | 'coming-soon'

export type ModuleId =
  | 'custom'
  | 'compare'
  | 'persona'
  | 'verdict'
  | 'arena'
  | 'suit'
  | 'council'
  | 'world-rank'
  | 'oracle'
  | 'journal'
  | 'relay'
  | 'duel'
  | 'simulation'

export type ModuleConfig = {
  id: ModuleId
  name: string
  icon: string
  imageSrc?: string
  status: ModuleStatus
  href?: string
  accent: string
  submodes?: string[]
}

export const activeModules: ModuleConfig[] = [
  {
    id: 'custom',
    name: 'CUSTOM',
    icon: 'Bird',
    imageSrc: '/icons/custom.png',
    status: 'active',
    href: '/modes/custom',
    accent: 'from-cyan-400 to-sky-600',
  },
  {
    id: 'compare',
    name: 'COMPARE',
    icon: 'Columns2',
    imageSrc: '/icons/compare.png',
    status: 'active',
    href: '/modes/compare',
    accent: 'from-blue-400 to-indigo-600',
  },
  {
    id: 'persona',
    name: 'PERSONA',
    icon: 'Theater',
    imageSrc: '/icons/persona.png',
    status: 'active',
    href: '/modes/persona',
    accent: 'from-violet-400 to-fuchsia-600',
  },
  {
    id: 'verdict',
    name: 'VERDICT',
    icon: 'Scale',
    imageSrc: '/icons/verdict.png',
    status: 'active',
    href: '/modes/verdict',
    accent: 'from-amber-300 to-yellow-600',
    submodes: ['SCORE', 'VOTE', 'RANK', 'PREDICT', 'FACT CHECK'],
  },
  {
    id: 'arena',
    name: 'ARENA',
    icon: 'Swords',
    imageSrc: '/icons/arena.png',
    status: 'active',
    href: '/modes/arena',
    accent: 'from-rose-500 to-red-700',
  },
  {
    id: 'suit',
    name: 'SUIT',
    icon: 'Gavel',
    imageSrc: '/icons/suit.png',
    status: 'active',
    href: '/modes/suit',
    accent: 'from-emerald-400 to-green-700',
  },
]

export const betaModules: ModuleConfig[] = [
  {
    id: 'council',
    name: 'COUNCIL',
    icon: 'Table2',
    status: 'coming-soon',
    accent: 'from-slate-500 to-slate-700',
  },
  {
    id: 'world-rank',
    name: 'WORLD RANK',
    icon: 'Globe',
    status: 'coming-soon',
    accent: 'from-slate-500 to-slate-700',
  },
  {
    id: 'oracle',
    name: 'ORACLE',
    icon: 'Sparkles',
    status: 'coming-soon',
    accent: 'from-slate-500 to-slate-700',
  },
  {
    id: 'journal',
    name: 'JOURNAL',
    icon: 'BookHeart',
    status: 'coming-soon',
    accent: 'from-slate-500 to-slate-700',
  },
  {
    id: 'relay',
    name: 'RELAY',
    icon: 'Footprints',
    status: 'coming-soon',
    accent: 'from-slate-500 to-slate-700',
  },
  {
    id: 'duel',
    name: 'DUEL',
    icon: 'Sword',
    status: 'coming-soon',
    accent: 'from-slate-500 to-slate-700',
  },
  {
    id: 'simulation',
    name: 'SIMULATION',
    icon: 'Handshake',
    status: 'coming-soon',
    accent: 'from-slate-500 to-slate-700',
  },
]

export const verdictSubmodes = [
  { id: 'score', name: 'SCORE', icon: 'BadgePercent' },
  { id: 'vote', name: 'VOTE', icon: 'Vote' },
  { id: 'predict', name: 'PREDICT', icon: 'BadgePercent' },
  { id: 'review', name: 'REVIEW', icon: 'FileSearch' },
  { id: 'rank', name: 'RANK', icon: 'Trophy' },
] as const

export const v1Placeholders = 3
