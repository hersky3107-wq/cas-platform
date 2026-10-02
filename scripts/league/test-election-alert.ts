/**
 * Send one Telegram test message to the configured admin chat.
 *
 *   npx tsx --env-file=.env.local scripts/league/test-election-alert.ts
 */
import { sendKrElectionTestAlert } from '../../lib/league/politics/kr-election-alerts'

async function main() {
  const result = await sendKrElectionTestAlert({})
  if (!result.sent) {
    console.error(result.error ?? 'not sent')
    process.exit(1)
  }
  console.log('Sent test election alert to TELEGRAM_ADMIN_CHAT_ID.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
