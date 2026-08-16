/**
 * Verifies every LEAGUE_ROSTER slot is callable end-to-end, using the SAME
 * caller path the orchestrator uses (core → runSingleAiProvider, platform →
 * callPlatformModel) with a trivial prompt. This is a live smoke test —
 * each call spends a few tokens (≤ a couple of cents total).
 *
 * Run:
 *   npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/verify-roster-ping.ts
 */
import { supabaseAdmin } from '../lib/supabase/server'
import { runSingleAiProvider } from '../lib/ai/router'
import { callPlatformModel } from '../lib/ai/platform-providers'
import { LEAGUE_ROSTER, type RosterEntry } from '../lib/league/roster'

async function ping(entry: RosterEntry): Promise<{ ok: boolean; ms: number; actual: string; error?: string }> {
  const started = Date.now()
  try {
    if (entry.caller.kind === 'core') {
      const res = await runSingleAiProvider({
        supabase: supabaseAdmin,
        authSupabase: supabaseAdmin,
        sessionId: null,
        userId: null,
        provider: entry.caller.provider,
        prompt: 'Reply with exactly one word: OK',
        systemPrompt: '',
        skipLanguageInjection: true,
        maxCompletionTokens: entry.reasoning ? 900 : 200,
        modelOverride: entry.caller.modelOverride,
        allowGeminiThinking: entry.caller.allowGeminiThinking,
        searchTool: entry.caller.searchTool,
        timeoutMs: 90_000,
      })
      return {
        ok: !res.error && !!res.text?.trim(),
        ms: Date.now() - started,
        actual: res.model || entry.model_id,
        error: res.error ?? (res.text?.trim() ? undefined : 'empty response'),
      }
    }
    const res = await callPlatformModel({
      id: entry.caller.platformId,
      userPrompt: 'Reply with exactly one word: OK',
      maxCompletionTokens: entry.reasoning ? 900 : 200,
    })
    return {
      ok: !res.error && !!res.text?.trim(),
      ms: Date.now() - started,
      actual: entry.model_id,
      error: res.error ?? (res.text?.trim() ? undefined : 'empty response'),
    }
  } catch (e) {
    return { ok: false, ms: Date.now() - started, actual: entry.model_id, error: e instanceof Error ? e.message : String(e) }
  }
}

async function main() {
  console.log(`Roster size: ${LEAGUE_ROSTER.length}`)
  const byTier = new Map<string, number>()
  for (const e of LEAGUE_ROSTER) byTier.set(e.league_tier, (byTier.get(e.league_tier) ?? 0) + 1)
  console.log('Per tier:', Object.fromEntries(byTier))

  // Concurrency 6, same as the orchestrator default.
  const queue = [...LEAGUE_ROSTER]
  const results: { entry: RosterEntry; ok: boolean; ms: number; actual: string; error?: string }[] = []
  const worker = async () => {
    for (;;) {
      const entry = queue.shift()
      if (!entry) return
      const r = await ping(entry)
      results.push({ entry, ...r })
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${entry.league_tier.padEnd(10)} ${entry.model_id.padEnd(28)} ${(r.ms / 1000).toFixed(1)}s${r.error ? `  ERROR: ${r.error.slice(0, 160)}` : ''}`)
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))

  const failed = results.filter((r) => !r.ok)
  console.log(`\n== ${results.length - failed.length}/${results.length} callable ==`)
  if (failed.length) {
    console.log('Failures:')
    for (const f of failed) console.log(`  ${f.entry.league_tier}/${f.entry.model_id}: ${f.error}`)
  }
}

main()
