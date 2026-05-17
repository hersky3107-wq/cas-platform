import { NextResponse } from 'next/server'
import { getPayPalApiBase, getPayPalClientId } from '@/lib/payments/paypal'

/** Public PayPal client id + environment hint for the JS SDK (no secret). */
export async function GET() {
  const clientId = getPayPalClientId()
  if (!clientId) {
    return NextResponse.json({ error: 'PayPal is not configured' }, { status: 503 })
  }

  const apiBase = getPayPalApiBase()
  const sandbox = apiBase.includes('sandbox')

  return NextResponse.json({ clientId, sandbox })
}
