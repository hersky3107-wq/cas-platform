/** Sweep writes scores only when this is 1, true, or yes. score.ts --apply ignores it. */
export function scoreWriteEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CRISIS_SCORE_WRITE_ENABLED?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}
