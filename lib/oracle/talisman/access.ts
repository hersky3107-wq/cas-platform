/**
 * Access gate for the talisman calculation. Same rule the rest of the
 * session uses: finished && !stub && consensus. Never generate from a
 * partial session.
 */

import { ORACLE_PROMPT_VERSION } from '../runner/conventions'
import type { TalismanAccessInput } from './types'

export function canComputeTalisman(input: TalismanAccessInput): boolean {
  if (input.status !== 'done') return false
  if (input.promptVersion === ORACLE_PROMPT_VERSION) return false
  if (!input.hasConsensus) return false
  return true
}
