'use client'

/**
 * AX COUNCIL mode context (cloned from components/motie/mode-context.tsx).
 *
 * STEP12: urban/people toggle removed. GunpoMode type is kept for call-site
 * compatibility, but the provider always exposes a single fixed value and
 * setMode is a no-op. toJejuCouncilMode always returns the fixed engine mode.
 *
 * NOTE: Do NOT import from lib/gunpo/brief.ts here (server-only). The fixed
 * engine mode string is duplicated as a client-safe constant below.
 */

import { createContext, useContext } from 'react'

export type GunpoMode = 'urban' | 'people'

/** STEP12 fixed UI mode — toggle removed; always 'urban' for identifier stability. */
const FIXED_MODE: GunpoMode = 'urban'

/**
 * STEP12 fixed engine mode (client-safe duplicate of lib/gunpo/brief.ts's
 * FIXED_GUNPO_COUNCIL_MODE). Must stay in sync: 'trade'.
 */
export const FIXED_GUNPO_COUNCIL_MODE: 'trade' | 'warroom' = 'trade'

interface MotieModeContextValue {
  mode: GunpoMode
  setMode: (m: GunpoMode) => void
}

const MotieModeContext = createContext<MotieModeContextValue>({
  mode: FIXED_MODE,
  setMode: () => {},
})

export function MotieModeProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotieModeContext.Provider
      value={{
        mode: FIXED_MODE,
        setMode: () => {
          /* STEP12: mode toggle removed — ignore */
        },
      }}
    >
      {children}
    </MotieModeContext.Provider>
  )
}

export function useMotieMode(): MotieModeContextValue {
  return useContext(MotieModeContext)
}

/**
 * Maps GunpoMode → JejuCouncilMode. STEP12: always returns FIXED_GUNPO_COUNCIL_MODE
 * regardless of input (toggle removed).
 */
export function toJejuCouncilMode(_m?: GunpoMode): 'trade' | 'warroom' {
  return FIXED_GUNPO_COUNCIL_MODE
}
