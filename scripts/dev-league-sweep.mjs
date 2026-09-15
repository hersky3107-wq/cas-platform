#!/usr/bin/env node
/**
 * Dev-only helper: periodically invokes GET /api/cron/league-generate locally
 * to drive background round generation jobs through all chunks and tiers
 * without manual curl repetition.
 *
 * Usage:
 *   node scripts/dev-league-sweep.mjs
 *   npm run league:sweep
 *   node scripts/dev-league-sweep.mjs --interval=10 --port=3000
 *   node scripts/dev-league-sweep.mjs --once
 *   node scripts/dev-league-sweep.mjs --continuous
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')

function loadCronSecret() {
  if (process.env.CRON_SECRET && process.env.CRON_SECRET.trim()) {
    return process.env.CRON_SECRET.trim()
  }

  const envPaths = [
    join(ROOT, '.env.local'),
    join(process.cwd(), '.env.local'),
    join(ROOT, '.env'),
    join(process.cwd(), '.env'),
  ]

  for (const envPath of envPaths) {
    try {
      const content = readFileSync(envPath, 'utf8')
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx <= 0) continue
        const key = trimmed.slice(0, eqIdx).trim()
        if (key === 'CRON_SECRET') {
          let val = trimmed.slice(eqIdx + 1).trim()
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1)
          }
          if (val) return val
        }
      }
    } catch {
      // Try next
    }
  }
  return null
}

function parseArgs() {
  const args = process.argv.slice(2)
  let intervalSec = 15
  let baseUrl = 'http://localhost:3000'
  let once = false
  let continuous = false
  let maxIdleTicks = 8 // ~120s of no candidates / running jobs before auto-exit

  for (const arg of args) {
    if (arg === '--once') {
      once = true
    } else if (arg === '--continuous' || arg === '-c') {
      continuous = true
    } else if (arg.startsWith('--interval=')) {
      const v = Number(arg.split('=')[1])
      if (Number.isFinite(v) && v > 0) intervalSec = v
    } else if (arg.startsWith('--port=')) {
      const p = arg.split('=')[1]
      baseUrl = `http://localhost:${p}`
    } else if (arg.startsWith('--url=')) {
      baseUrl = arg.split('=')[1]
    } else if (arg.startsWith('--max-idle=')) {
      const v = Number(arg.split('=')[1])
      if (Number.isFinite(v) && v > 0) maxIdleTicks = v
    }
  }

  return { intervalSec, baseUrl, once, continuous, maxIdleTicks }
}

function timestamp() {
  return new Date().toTimeString().slice(0, 8)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function sweepOnce(baseUrl, secret) {
  const endpoint = `${baseUrl.replace(/\/$/, '')}/api/cron/league-generate`
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: text || `HTTP ${res.status}` }
  }

  const json = await res.json()
  return { ok: true, status: res.status, data: json }
}

async function main() {
  const { intervalSec, baseUrl, once, continuous, maxIdleTicks } = parseArgs()
  const secret = loadCronSecret()

  if (!secret) {
    console.error('❌ [dev-league-sweep] CRON_SECRET not found in environment or .env.local')
    console.error('   Please add CRON_SECRET=<value> to .env.local.')
    process.exit(1)
  }

  console.log(`🚀 [dev-league-sweep] Dev league generation runner active.`)
  console.log(`   Target:   ${baseUrl}/api/cron/league-generate`)
  console.log(`   Cadence:  every ${intervalSec}s`)
  console.log(`   Auth:     Bearer (loaded from .env.local, length: ${secret.length})`)
  if (!once && !continuous) {
    console.log(`   Auto-stop: after ${maxIdleTicks} consecutive idle ticks (~${maxIdleTicks * intervalSec}s cooldown)`)
  }
  console.log(`   Press Ctrl+C at any time to exit.\n`)

  let tick = 0
  let consecutiveIdle = 0
  let totalClaimed = 0
  let hadActiveJobs = false

  for (;;) {
    tick += 1
    const ts = timestamp()
    try {
      const result = await sweepOnce(baseUrl, secret)

      if (!result.ok) {
        console.warn(`[${ts}] Tick #${tick} ⚠️  HTTP ${result.status}: ${result.error}`)
      } else {
        const gen = result.data?.summary?.generation
        const deep = result.data?.summary?.deep

        const candidates = gen?.candidates ?? 0
        const claimed = gen?.claimed ?? 0
        const runningBefore = gen?.runningBefore ?? 0
        const results = gen?.results ?? []

        totalClaimed += claimed
        if (claimed > 0 || runningBefore > 0 || candidates > 0) {
          hadActiveJobs = true
        }

        if (claimed > 0) {
          consecutiveIdle = 0
          console.log(`[${ts}] Tick #${tick} ⚡ Claimed ${claimed} job(s) (candidates: ${candidates}, runningBefore: ${runningBefore})`)
          for (const r of results) {
            console.log(`   ↳ Job ${r.jobId.slice(0, 8)}... stage: ${r.stage ?? 'unknown'} (status: ${r.status}, claimed: ${r.claimed})`)
          }
        } else if (runningBefore > 0) {
          consecutiveIdle = 0
          console.log(`[${ts}] Tick #${tick} ⏳ Chunk in flight (${runningBefore} running slot(s) active)`)
        } else if (candidates > 0) {
          console.log(`[${ts}] Tick #${tick} ⏸️  ${candidates} candidate(s) seen but budget full (runningBefore: ${runningBefore})`)
        } else {
          consecutiveIdle += 1
          const idleMsg = hadActiveJobs
            ? `waiting cooldown/finish (${consecutiveIdle}/${maxIdleTicks})`
            : `no active jobs queued (${consecutiveIdle}/${maxIdleTicks})`
          console.log(`[${ts}] Tick #${tick} 💤 Idle | ${idleMsg}`)
        }

        if (deep && (deep.claimed > 0 || deep.candidates > 0)) {
          console.log(`   ↳ [deep] candidates: ${deep.candidates}, claimed: ${deep.claimed}`)
        }
      }
    } catch (e) {
      console.error(`[${ts}] Tick #${tick} ❌ Error: ${e instanceof Error ? e.message : String(e)}`)
    }

    if (once) {
      console.log(`\n[dev-league-sweep] Single sweep complete. Exiting.`)
      break
    }

    if (!continuous && consecutiveIdle >= maxIdleTicks) {
      console.log(`\n✅ [dev-league-sweep] Done: no active or claimable jobs for ${maxIdleTicks * intervalSec}s. All rounds reached steady state.`)
      break
    }

    await sleep(intervalSec * 1000)
  }
}

main().catch((err) => {
  console.error('[dev-league-sweep] Fatal error:', err)
  process.exit(1)
})
