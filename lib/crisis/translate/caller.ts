import 'server-only'

import { callEngineProvider } from '@/lib/crisis/engine/providers'
import type { TranslateCaller } from './ensure'

export const CRISIS_TRANSLATE_MODEL = 'gemini-3.5-flash-lite'
export const CRISIS_TRANSLATE_PROVIDER = 'google' as const

export const cheapTranslateCaller: TranslateCaller = async ({ system, user }) => {
  const result = await callEngineProvider({
    model: CRISIS_TRANSLATE_MODEL,
    provider: CRISIS_TRANSLATE_PROVIDER,
    system,
    user,
    maxTokens: 4000,
    timeoutMs: 25_000,
    jsonMode: true,
    googleThinking: 'off',
  })
  return result.text
}
