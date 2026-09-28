import { activeRaceBlackouts } from '../jurisdiction/election-blackout'
import { telegramConfigured } from '../manual-grade/telegram'
import { raceBlackoutActive } from './kr-calendar'
import { readPoliticsSlateCache } from './slate-cache'

const TELEGRAM_API = 'https://api.telegram.org'
const notified = new Set<string>()

export function buildElectionBlackoutAlertText(title: string): string {
  return `🚨 [선거 블랙아웃] ${title} D-6 진입, 한국 노출 중단`
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

/** Optional Telegram. Badge is the always-on signal. Deduped per process per race. */
export async function notifyKrBlackoutEntered(
  atMs: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: string[] }> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID?.trim()
  if (!telegramConfigured(env) || !token || !chatId) return { sent: [] }
  const sent: string[] = []
  for (const alert of listKrBlackoutAlerts(atMs)) {
    if (notified.has(alert.raceKey)) continue
    try {
      const res = await fetchImpl(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: alert.text,
          disable_web_page_preview: true,
        }),
      })
      if (res.ok) {
        notified.add(alert.raceKey)
        sent.push(alert.raceKey)
      }
    } catch {
      /* badge still shows */
    }
  }
  return { sent }
}

/** Test seam. */
export function resetBlackoutNotifyMemory(): void {
  notified.clear()
}
