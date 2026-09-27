/**
 * Telegram push for the manual grading queue. OPTIONAL.
 *
 * Fires only when BOTH TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID are set.
 * Missing env, network errors, and non-2xx responses are swallowed — the
 * in-app badge is the always-on notification.
 */

const TELEGRAM_API = 'https://api.telegram.org'

export function telegramConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_ADMIN_CHAT_ID?.trim())
}

export function buildManualGradeTelegramText(args: {
  proposition: string
  category: string
  resolvesAt: string
  gradeUrl: string
}): string {
  const proposition = args.proposition.trim().slice(0, 280)
  return [
    '🚨 [AI 리그 채점 요청]',
    `• 카테고리: ${args.category}`,
    `• 명제: ${proposition}`,
    `• 마감: ${args.resolvesAt}`,
    `• 판정: ${args.gradeUrl}`,
  ].join('\n')
}

export async function notifyManualGradeQueued(
  args: {
    proposition: string
    category: string
    resolvesAt: string
    gradeUrl: string
  },
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<{ sent: boolean }> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = env.TELEGRAM_ADMIN_CHAT_ID?.trim()
  if (!token || !chatId) return { sent: false }

  try {
    const res = await fetchImpl(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: buildManualGradeTelegramText(args),
        disable_web_page_preview: true,
      }),
    })
    if (!res.ok) {
      console.warn(`[league/manual-grade] telegram ${res.status}`)
      return { sent: false }
    }
    return { sent: true }
  } catch (e: unknown) {
    console.warn(`[league/manual-grade] telegram failed: ${e instanceof Error ? e.message : 'unknown'}`)
    return { sent: false }
  }
}
