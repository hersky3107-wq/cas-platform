'use client'

/**
 * AX COUNCIL top-level MODE toggle, shared across the gunpo governance pages
 * (cloned from components/motie/mode-context.tsx).
 *
 *   - 'urban'  = 도시·정비 — DEFAULT
 *   - 'people' = 시민·정주
 *
 * Persisted on-device (localStorage, guarded) so the choice carries across
 * pages/reloads. For this step the mode only drives brand copy + a `councilMode`
 * param threaded into the API routes — no connector/prompt branching yet.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type GunpoMode = 'urban' | 'people'

const STORAGE_KEY = 'gunpo.mode'
const DEFAULT_MODE: GunpoMode = 'urban'

function isMotieMode(v: unknown): v is GunpoMode {
  return v === 'urban' || v === 'people'
}

interface MotieModeContextValue {
  mode: GunpoMode
  setMode: (m: GunpoMode) => void
}

const MotieModeContext = createContext<MotieModeContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
})

export function MotieModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<GunpoMode>(DEFAULT_MODE)

  // Restore persisted choice after mount (SSR-safe: default renders first).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (isMotieMode(stored)) setModeState(stored)
    } catch {
      /* localStorage unavailable — stay on default */
    }
  }, [])

  const setMode = useCallback((m: GunpoMode) => {
    setModeState(m)
    try {
      window.localStorage.setItem(STORAGE_KEY, m)
    } catch {
      /* ignore persistence failure */
    }
  }, [])

  return (
    <MotieModeContext.Provider value={{ mode, setMode }}>
      {children}
    </MotieModeContext.Provider>
  )
}

export function useMotieMode(): MotieModeContextValue {
  return useContext(MotieModeContext)
}

/**
 * Maps the UI-facing GunpoMode ('urban' | 'people') to the engine-facing
 * JejuCouncilMode ('trade' | 'warroom') used by lib/gunpo/brief.ts,
 * persona.ts, diagnostic-categories.ts, and the /api/gunpo/* routes — those
 * kept their original 'trade' | 'warroom' identifiers per STEP 2 scope.
 */
export function toJejuCouncilMode(m: GunpoMode): 'trade' | 'warroom' {
  return m === 'urban' ? 'trade' : 'warroom'
}
