import { Resend } from 'resend'

const ADMIN_ALERT_TO = 'hersky3107@gmail.com'
const FROM_ADDRESS = 'AIMANI <support@aimani.ai>'

export type AdminPaymentAlertParams = {
  userEmail: string
  creditsPurchased: number
  amountUsd: number
  purchasedAt: Date
  paypalOrderId: string
}

/**
 * Notifies admin of a new PayPal credit purchase via Resend.
 * Logs errors; never throws to callers.
 */
export async function sendAdminPaymentAlertEmail(params: AdminPaymentAlertParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.warn('[admin-payment-alert] RESEND_API_KEY not set; skipping email')
    return
  }

  const timestamp = params.purchasedAt.toISOString()
  const body = [
    'A new AIMANI credit purchase was completed.',
    '',
    `User email: ${params.userEmail}`,
    `Credits purchased: ${params.creditsPurchased}`,
    `Amount (USD): $${params.amountUsd.toFixed(2)}`,
    `Timestamp: ${timestamp}`,
    `PayPal order ID: ${params.paypalOrderId}`,
  ].join('\n')

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: ADMIN_ALERT_TO,
      subject: 'AIMANI: New Payment Received',
      text: body,
    })
    if (error) {
      console.error('[admin-payment-alert] Resend error', error)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[admin-payment-alert] send failed', msg)
  }
}
