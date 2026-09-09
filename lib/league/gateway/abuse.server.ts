import 'server-only'

import { supabaseAdmin } from '@/lib/supabase/server'
import { CACHE_TTL_MS, SEARCH_CIRCUIT_MAX, NORMALIZE_CIRCUIT_MAX, utcDayKey } from './abuse'

/**
 * Durable quota / cache / circuit with in-process fallback so local dev
 * works before the migration is applied. Fail-open on cache read; fail-closed
 * on circuit write errors (treat as at-cap) would lock the product — we
 * fail-open there too and rely on the per-account quota + rate limit.
 */

type CacheRow = { output: unknown; expiresAt: number }
const memCache = new Map<string, CacheRow>()
const memQuota = new Map<string, number>()
const memCircuit = { day: '', normalize: 0, search: 0 }

function qKey(userId: string, day: string) {
  return `${userId}:${day}`
}

export async function readNormalizeCache(cacheKey: string): Promise<unknown | null> {
  const hit = memCache.get(cacheKey)
  if (hit && hit.expiresAt > Date.now()) return hit.output
  if (hit) memCache.delete(cacheKey)

  const { data, error } = await supabaseAdmin
    .from('league_gateway_normalize_cache')
    .select('output, expires_at')
    .eq('cache_key', cacheKey)
    .maybeSingle()
  if (error || !data) return null
  const expires = new Date(String(data.expires_at)).getTime()
  if (!Number.isFinite(expires) || expires <= Date.now()) return null
  memCache.set(cacheKey, { output: data.output, expiresAt: expires })
  return data.output
}

export async function writeNormalizeCache(cacheKey: string, output: unknown, now = new Date()): Promise<void> {
  const expiresAt = now.getTime() + CACHE_TTL_MS
  memCache.set(cacheKey, { output, expiresAt })
  await supabaseAdmin.from('league_gateway_normalize_cache').upsert({
    cache_key: cacheKey,
    output,
    expires_at: new Date(expiresAt).toISOString(),
  })
}

export async function readQuotaUnits(userId: string, now = new Date()): Promise<number> {
  const day = utcDayKey(now)
  const local = memQuota.get(qKey(userId, day))
  if (typeof local === 'number') return local
  const { data } = await supabaseAdmin
    .from('league_gateway_quota')
    .select('units')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle()
  const units = typeof data?.units === 'number' ? data.units : Number(data?.units) || 0
  memQuota.set(qKey(userId, day), units)
  return units
}

export async function addQuotaUnits(userId: string, add: number, now = new Date()): Promise<number> {
  if (add <= 0) return readQuotaUnits(userId, now)
  const day = utcDayKey(now)
  const next = (await readQuotaUnits(userId, now)) + add
  memQuota.set(qKey(userId, day), next)
  await supabaseAdmin.from('league_gateway_quota').upsert({ user_id: userId, day, units: next })
  return next
}

function circuitDay(now: Date) {
  const day = utcDayKey(now)
  if (memCircuit.day !== day) {
    memCircuit.day = day
    memCircuit.normalize = 0
    memCircuit.search = 0
  }
  return day
}

export async function circuitAllowsNormalize(now = new Date()): Promise<boolean> {
  const day = circuitDay(now)
  const { data } = await supabaseAdmin.from('league_gateway_circuit').select('normalize_calls').eq('day', day).maybeSingle()
  const stored = typeof data?.normalize_calls === 'number' ? data.normalize_calls : memCircuit.normalize
  return stored < NORMALIZE_CIRCUIT_MAX
}

export async function circuitAllowsSearch(now = new Date()): Promise<boolean> {
  const day = circuitDay(now)
  const { data } = await supabaseAdmin.from('league_gateway_circuit').select('search_calls').eq('day', day).maybeSingle()
  const stored = typeof data?.search_calls === 'number' ? data.search_calls : memCircuit.search
  return stored < SEARCH_CIRCUIT_MAX
}

export async function bumpNormalizeCircuit(now = new Date()): Promise<void> {
  const day = circuitDay(now)
  memCircuit.normalize += 1
  await supabaseAdmin.from('league_gateway_circuit').upsert({
    day,
    normalize_calls: memCircuit.normalize,
    search_calls: memCircuit.search,
  })
}

export async function bumpSearchCircuit(now = new Date()): Promise<void> {
  const day = circuitDay(now)
  memCircuit.search += 1
  await supabaseAdmin.from('league_gateway_circuit').upsert({
    day,
    normalize_calls: memCircuit.normalize,
    search_calls: memCircuit.search,
  })
}

export async function writeGatewayAudit(args: {
  userId: string
  categoryId: string
  locale: string
  rawText: string
}): Promise<void> {
  await supabaseAdmin.from('league_gateway_audit').insert({
    user_id: args.userId,
    category_id: args.categoryId,
    locale: args.locale,
    raw_text: args.rawText,
    untrusted: true,
  })
}
