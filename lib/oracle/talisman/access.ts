/**
 * Access gate for the talisman calculation. Same rule the rest of the
 * session uses: finished && !stub && consensus. Never generate from a
 * partial session.
 *
 * `ORACLE_PROMPT_VERSION` is the stub stamp (`stub-0`), written when
 * ORACLE_AI_MODE is stub. Live sessions stamp `LAYER1_PROMPT_VERSION`
 * instead (currently `layer1-v4`). Refusing equality with the stub constant
 * blocks canned sessions only. It does not require the latest live prompt:
 * the current version and older live versions both pass.
 */

import { ORACLE_PROMPT_VERSION } from '../runner/conventions'
import type { TalismanAccessInput } from './types'

export function canComputeTalisman(input: TalismanAccessInput): boolean {
  if (input.status !== 'done') return false
  if (!input.promptVersion) return false
  if (input.promptVersion === ORACLE_PROMPT_VERSION || input.promptVersion.startsWith('stub')) return false
  if (input.promptVersion === 'legacy' || input.promptVersion.startsWith('legacy')) return false
  if (!input.hasConsensus) return false
  return true
}
