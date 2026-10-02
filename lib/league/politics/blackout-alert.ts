import { activeRaceBlackouts } from '../jurisdiction/election-blackout'
import { raceBlackoutActive } from './kr-calendar'
import { readPoliticsSlateCache } from './slate-cache'
import { buildKrElectionAlertText, dispatchKrElectionAlerts } from './kr-election-alerts'

export function buildElectionBlackoutAlertText(title: string): string {
  return buildKrElectionAlertText(title, 'd6')
}

export function listKrBlackoutAlerts(atMs: number = Date.now()): Array<{ raceKey: string; title: string; text: string }> {
  const seen = new Set<string>()
  const out: Array<{ raceKey: string; title: string; text: string }> = []
  const push = (raceKey: string, title: string) => {
    if (seen.has(raceKey)) return
    seen.add(raceKey)
    out.push({ raceKey, title, text: buildElectionBlackoutAlertText(title) })
  }
  for (const w of activeRaceBlackouts(atMs, 'KR')) push(w.raceKey, w.title)
  for (const row of readPoliticsSlateCache(atMs) ?? []) {
    if (row.jurisdiction !== 'KR') continue
    if (!raceBlackoutActive(row.pollCloseIso, atMs)) continue
    push(`slate:${row.office}:${row.cycle}:${row.district}`, `${row.cycle} ${row.office} ${row.district}`)
  }
  return out
}

/** Optional Telegram. Badge is the always-on signal. Deduped per (election, milestone) in DB. */
export async function notifyKrBlackoutEntered(
  atMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: string[] }> {
  const result = await dispatchKrElectionAlerts({
    atMs,
    env,
    fetchImpl,
  })
  return { sent: result.sent.map((row) => `${row.electionId}:${row.milestone}`) }
}
