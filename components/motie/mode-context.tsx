'use client'

/**
 * AX COUNCIL top-level MODE toggle, shared across the motie governance pages.
 *
 *   - 'trade'   = 수출참모 (Export Advisor) — DEFAULT
 *   - 'warroom' = 자원·에너지 워룸 (Resource War-Room)
 *
 * Persisted on-device (localStorage, guarded) so the choice carries across
 * pages/reloads. For this step the mode only drives brand copy + a `councilMode`
 * param threaded into the API routes — no connector/prompt branching yet.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

export type MotieMode = 'trade' | 'warroom'

const STORAGE_KEY = 'motie.mode'
const DEFAULT_MODE: MotieMode = 'trade'

function isMotieMode(v: unknown): v is MotieMode {
  return v === 'trade' || v === 'warroom'
}

interface MotieModeContextValue {
  mode: MotieMode
  setMode: (m: MotieMode) => void
}

const MotieModeContext = createContext<MotieModeContextValue>({
  mode: DEFAULT_MODE,
  setMode: () => {},
})

export function MotieModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<MotieMode>(DEFAULT_MODE)

  // Restore persisted choice after mount (SSR-safe: default renders first).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (isMotieMode(stored)) setModeState(stored)
    } catch {
      /* localStorage unavailable — stay on default */
    }
  }, [])

  const setMode = useCallback((m: MotieMode) => {
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
