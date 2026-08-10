import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/require-admin'

export const maxDuration = 30

/**
 * Admin-only balance lookup for platform-level LLM providers.
 *
 * - OpenRouter: documented GET https://openrouter.ai/api/v1/key (+ /credits)
 * - You.com: documented GET https://api.you.com/v1/billing/account_balance
 * - Meta Muse / CLOVA: no plain API-key balance endpoint — billing links only
 *
 * GET /api/admin/platform-providers/balance
 */
export async function GET(req: Request) {
  const forbidden = await requireAdmin(req)
  if (forbidden) return forbidden

  const [openrouter, youcom, metaMuse, clova] = await Promise.all([
    fetchOpenRouterBalance(),
    fetchYouComBalance(),
    Promise.resolve({
      provider: 'meta-muse' as const,
      label: 'Meta Muse',
      kind: 'link' as const,
      billingUrl: 'https://ai.developer.meta.com/billing',
      note: 'No documented balance API for Meta Model API keys — open billing dashboard.',
    }),
    Promise.resolve({
      provider: 'clova' as const,
      label: 'NAVER CLOVA Studio',
      kind: 'link' as const,
      billingUrl: 'https://console.ncloud.com/clova-studio/product',
      note: 'No token-balance API on CLOVA Studio API keys — open NAVER Cloud console.',
    }),
  ])

  return NextResponse.json({ balances: [openrouter, youcom, metaMuse, clova] })
}

type BalanceOk = {
  provider: string
  label: string
  kind: 'balance'
  /** Remaining credit in USD (already converted). */
  remainingUsd: number | null
  /** Optional extra fields for the dashboard. */
  details?: Record<string, number | string | null>
  error?: undefined
}

type BalanceLink = {
  provider: string
  label: string
  kind: 'link'
  billingUrl: string
  note: string
}

type BalanceErr = {
  provider: string
  label: string
  kind: 'balance'
  remainingUsd: null
  error: string
}

type BalanceRow = BalanceOk | BalanceLink | BalanceErr

async function fetchOpenRouterBalance(): Promise<BalanceRow> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    return {
      provider: 'openrouter',
      label: 'OpenRouter',
      kind: 'balance',
      remainingUsd: null,
      error: 'OPENROUTER_API_KEY is not set',
    }
  }

  try {
    const [keyRes, creditsRes] = await Promise.all([
      fetch('https://openrouter.ai/api/v1/key', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
      fetch('https://openrouter.ai/api/v1/credits', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    ])

    const keyText = await keyRes.text().catch(() => '')
    const creditsText = await creditsRes.text().catch(() => '')

    if (!keyRes.ok && !creditsRes.ok) {
      return {
        provider: 'openrouter',
        label: 'OpenRouter',
        kind: 'balance',
        remainingUsd: null,
        error: `HTTP ${keyRes.status} key + HTTP ${creditsRes.status} credits — ${keyText.slice(0, 200)}`,
      }
    }

    let limitRemaining: number | null = null
    let usage: number | null = null
    if (keyRes.ok) {
      try {
        const keyJson = JSON.parse(keyText) as {
          data?: { limit_remaining?: number | null; usage?: number | null }
        }
        limitRemaining =
          typeof keyJson?.data?.limit_remaining === 'number' ? keyJson.data.limit_remaining : null
        usage = typeof keyJson?.data?.usage === 'number' ? keyJson.data.usage : null
      } catch {
        /* ignore parse — fall through to credits */
      }
    }

    let accountRemaining: number | null = null
    if (creditsRes.ok) {
      try {
        const creditsJson = JSON.parse(creditsText) as {
          data?: { total_credits?: number; total_usage?: number }
        }
        const total = creditsJson?.data?.total_credits
        const used = creditsJson?.data?.total_usage
        if (typeof total === 'number' && typeof used === 'number') {
          accountRemaining = total - used
        }
      } catch {
        /* ignore */
      }
    }

    // Prefer account remaining when available; otherwise key limit_remaining.
    const remainingUsd =
      accountRemaining != null
        ? accountRemaining
        : limitRemaining != null
          ? limitRemaining
          : null

    if (remainingUsd == null) {
      return {
        provider: 'openrouter',
        label: 'OpenRouter',
        kind: 'balance',
        remainingUsd: null,
        error: 'Could not parse remaining credit from OpenRouter responses',
      }
    }

    return {
      provider: 'openrouter',
      label: 'OpenRouter',
      kind: 'balance',
      remainingUsd,
      details: {
        accountRemainingUsd: accountRemaining,
        keyLimitRemainingUsd: limitRemaining,
        keyUsageUsd: usage,
        billingUrl: 'https://openrouter.ai/settings/credits',
      },
    }
  } catch (e: unknown) {
    return {
      provider: 'openrouter',
      label: 'OpenRouter',
      kind: 'balance',
      remainingUsd: null,
      error: e instanceof Error ? e.message : 'Unknown OpenRouter balance error',
    }
  }
}

async function fetchYouComBalance(): Promise<BalanceRow> {
  const apiKey = process.env.YOUCOM_API_KEY?.trim()
  if (!apiKey) {
    return {
      provider: 'youcom',
      label: 'You.com',
      kind: 'balance',
      remainingUsd: null,
      error: 'YOUCOM_API_KEY is not set',
    }
  }

  try {
    // Documented: GET https://api.you.com/v1/billing/account_balance
    // Balance is in cents — divide by 100 for USD.
    const res = await fetch('https://api.you.com/v1/billing/account_balance', {
      headers: {
        'X-API-Key': apiKey,
        Accept: 'application/json',
      },
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) {
      return {
        provider: 'youcom',
        label: 'You.com',
        kind: 'balance',
        remainingUsd: null,
        error: `HTTP ${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`,
      }
    }

    const json = JSON.parse(text) as {
      data?: { attributes?: { balance?: number } }
    }
    const cents = json?.data?.attributes?.balance
    if (typeof cents !== 'number') {
      return {
        provider: 'youcom',
        label: 'You.com',
        kind: 'balance',
        remainingUsd: null,
        error: 'Could not parse You.com balance (expected data.attributes.balance in cents)',
      }
    }

    return {
      provider: 'youcom',
      label: 'You.com',
      kind: 'balance',
      remainingUsd: cents / 100,
      details: {
        balanceCents: cents,
        billingUrl: 'https://you.com/platform',
      },
    }
  } catch (e: unknown) {
    return {
      provider: 'youcom',
      label: 'You.com',
      kind: 'balance',
      remainingUsd: null,
      error: e instanceof Error ? e.message : 'Unknown You.com balance error',
    }
  }
}
