/**
 * One tiny live ping per roster model. This is the only live call allowed
 * when wiring the pinned league ids.
 *
 *   npx tsx --env-file=.env.local scripts/crisis/engine-ping.ts
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { callEngineProvider, ProviderHttpError } from '../../lib/crisis/engine/providers'
import { resolveRoster } from '../../lib/crisis/engine/roster'

function uniqueSlots() {
  const only = process.argv.find((item) => item.startsWith('--only='))?.slice(7)
  const seen = new Set<string>()
  const slots = []
  for (const slot of resolveRoster().slots) {
    if (only && slot.model !== only) continue
    const key = `${slot.provider}:${slot.model}:${slot.search ? 'search' : 'chat'}`
    if (seen.has(key)) continue
    seen.add(key)
    slots.push(slot)
  }
  return slots
}

async function main(): Promise<void> {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!existsSync(envPath)) throw new Error('Copy cas-platform/.env.local into cas-platform-crisis first')
  console.log('model\tprovider\tstatus\tlatency_ms\tok')
  for (const slot of uniqueSlots()) {
    const started = Date.now()
    try {
      const result = await callEngineProvider({
        model: slot.model,
        provider: slot.provider,
        system: '',
        user: 'Reply with the word OK.',
        maxTokens: 20,
        timeoutMs: slot.search ? 45_000 : 30_000,
        search: false,
        extraBody: slot.extraBody,
        googleThinking: slot.googleThinking,
        anthropicThinking: slot.anthropicThinking,
      })
      const ok = /\bok\b/i.test(result.text) ? 'ok' : 'fail'
      console.log(`${slot.model}\t${slot.provider}\t${result.httpStatus}\t${Date.now() - started}\t${ok}`)
    } catch (error: unknown) {
      const status = error instanceof ProviderHttpError ? error.status : 0
      const message = error instanceof Error ? error.message.replace(/\s+/g, ' ').slice(0, 160) : 'fail'
      console.log(`${slot.model}\t${slot.provider}\t${status}\t${Date.now() - started}\tfail`)
      console.error(`  ${slot.model}: ${message}`)
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
