/**
 * One-time setup: create AIMANI PayPal catalog product + 3 monthly billing plans (Live).
 *
 * Usage (from repo root):
 *   node scripts/create-paypal-subscription-plans.mjs
 *
 * Requires in .env.local:
 *   PAYPAL_CLIENT_ID
 *   PAYPAL_CLIENT_SECRET
 *
 * Does not modify .env.local — prints plan IDs for you to copy.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PAYPAL_API_BASE = 'https://api-m.paypal.com'

const PLANS = [
  {
    key: 'LIGHT',
    name: 'AIMANI Light',
    description: 'Light monthly plan',
    priceUsd: '10.00',
  },
  {
    key: 'STANDARD',
    name: 'AIMANI Standard',
    description: 'Standard monthly plan',
    priceUsd: '19.00',
  },
  {
    key: 'PRO',
    name: 'AIMANI Pro',
    description: 'Pro monthly plan',
    priceUsd: '38.00',
  },
]

function loadEnvLocal() {
  const path = join(process.cwd(), '.env.local')
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new Error(`Could not read ${path}. Create it with PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.`)
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

async function getAccessToken(clientId, clientSecret) {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      json.error_description || json.error || `OAuth failed (${res.status}): ${JSON.stringify(json)}`
    )
  }
  return json.access_token
}

async function paypalPost(token, path, body) {
  const res = await fetch(`${PAYPAL_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = json.details?.map((d) => d.description || d.issue).join('; ')
    throw new Error(detail || json.message || `POST ${path} failed (${res.status}): ${JSON.stringify(json)}`)
  }
  return json
}

function billingPlanPayload(productId, plan) {
  return {
    product_id: productId,
    name: plan.name,
    description: plan.description,
    status: 'ACTIVE',
    billing_cycles: [
      {
        frequency: {
          interval_unit: 'MONTH',
          interval_count: 1,
        },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: {
          fixed_price: {
            value: plan.priceUsd,
            currency_code: 'USD',
          },
        },
      },
    ],
    payment_preferences: {
      auto_bill_outstanding: true,
      setup_fee_failure_action: 'CONTINUE',
      payment_failure_threshold: 3,
    },
    taxes: {
      percentage: '0',
      inclusive: false,
    },
  }
}

async function main() {
  loadEnvLocal()

  const clientId = process.env.PAYPAL_CLIENT_ID?.trim()
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim()
  if (!clientId || !clientSecret) {
    throw new Error('Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET in .env.local')
  }

  console.log('PayPal API:', PAYPAL_API_BASE)
  console.log('Fetching access token…')

  const token = await getAccessToken(clientId, clientSecret)
  console.log('Access token obtained.\n')

  console.log('Creating catalog product…')
  const product = await paypalPost(token, '/v1/catalogs/products', {
    name: 'AIMANI Subscription',
    description: 'AIMANI AI Platform Monthly Subscription',
    type: 'SERVICE',
    category: 'SOFTWARE',
  })

  const productId = product.id
  if (!productId) {
    throw new Error(`Product created but no id in response: ${JSON.stringify(product)}`)
  }
  console.log('Product ID:', productId)
  console.log('')

  const createdPlans = {}

  for (const plan of PLANS) {
    console.log(`Creating billing plan: ${plan.name} ($${plan.priceUsd}/month)…`)
    const result = await paypalPost(token, '/v1/billing/plans', billingPlanPayload(productId, plan))
    const planId = result.id
    if (!planId) {
      throw new Error(`Plan ${plan.name} created but no id: ${JSON.stringify(result)}`)
    }
    createdPlans[plan.key] = planId
    console.log('  Plan ID:', planId)
    console.log('  Status:', result.status ?? '(unknown)')
    console.log('')
  }

  console.log('='.repeat(60))
  console.log('Copy these into .env.local when ready:')
  console.log('='.repeat(60))
  console.log(`PAYPAL_SUBSCRIPTION_PRODUCT_ID=${productId}`)
  console.log(`PAYPAL_SUBSCRIPTION_PLAN_LIGHT=${createdPlans.LIGHT}`)
  console.log(`PAYPAL_SUBSCRIPTION_PLAN_STANDARD=${createdPlans.STANDARD}`)
  console.log(`PAYPAL_SUBSCRIPTION_PLAN_PRO=${createdPlans.PRO}`)
  console.log('='.repeat(60))
}

main().catch((err) => {
  console.error('\nSetup failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
