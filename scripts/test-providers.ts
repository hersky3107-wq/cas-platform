/**
 * Manual smoke-test for the two opt-in AI providers added to lib/ai/router.ts:
 *   - perplexity (Perplexity 'sonar', search-specialized)
 *   - meta       (Llama 3.3 70B via Groq)
 *
 * Reads platform keys from .env.local (PERPLEXITY_API_KEY, GROQ_API_KEY).
 * sessionId is null, so NO database rows are written — this only exercises the
 * provider call path. Run from project root:
 *
 *   $env:NODE_PATH=".\scripts\stubs"; npx tsx --env-file=.env.local scripts/test-providers.ts
 *
 * (NODE_PATH points at the server-only stub so the module loads outside Next.js.
 *  --env-file is supported natively on Node 20.6+/24.)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  runSingleAiProvider,
  MODEL_BY_PROVIDER,
  type ExtendedAiProviderName,
} from '@/lib/ai/router'

const PROMPT = 'What is the capital of Jeju? Answer in one sentence.'
const PROVIDERS: ExtendedAiProviderName[] = ['perplexity', 'meta']

// Throwaway client — never used for I/O because sessionId is null (no inserts).
const dummySupabase = createClient(
  'http://localhost',
  'anon-key-not-used'
) as unknown as SupabaseClient

async function main() {
  for (const provider of PROVIDERS) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`Provider: ${provider}  (model: ${MODEL_BY_PROVIDER[provider]})`)
    console.log('─'.repeat(60))

    const res = await runSingleAiProvider({
      supabase: dummySupabase,
      sessionId: null,
      userId: null,
      provider,
      prompt: PROMPT,
      systemPrompt: '',
      maxCompletionTokens: 256,
    })

    console.log('model:', res.model)
    if (res.error) {
      console.log('error:', res.error)
    } else {
      console.log('text: ', res.text)
    }
  }

  console.log(`\n${'─'.repeat(60)}`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Uncaught error (this should not happen):', err)
  process.exit(1)
})
