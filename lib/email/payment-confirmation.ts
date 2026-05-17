import type { SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const FROM_ADDRESS = 'AIMANI <support@aimani.ai>'
const SUBJECT = 'AIMANI Credit Purchase Confirmed'

export type PaymentConfirmationParams = {
  userId: string
  toEmail?: string | null
  creditsPurchased: number
  totalCredits: number
  transactionId: string
  purchasedAt?: Date
}

function formatPurchaseDate(date: Date): string {
  return date.toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
}

function buildPaymentConfirmationHtml(params: {
  creditsPurchased: number
  totalCredits: number
  transactionId: string
  purchasedAt: Date
}): string {
  const { creditsPurchased, totalCredits, transactionId, purchasedAt } = params
  const dateLabel = formatPurchaseDate(purchasedAt)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b1020;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#0b1020;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background-color:#131c35;border-radius:16px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.2em;text-transform:uppercase;color:#67e8f9;">AIMANI</p>
              <h1 style="margin:12px 0 0;font-size:22px;font-weight:600;color:#ffffff;">Credit purchase confirmed</h1>
              <p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#94a3b8;">Thank you for your purchase. Your credits have been added to your account.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:rgba(255,255,255,0.04);border-radius:12px;border:1px solid rgba(255,255,255,0.08);">
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Credits purchased</p>
                    <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#22d3ee;">+${creditsPurchased.toLocaleString('en-US')}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Total credits now</p>
                    <p style="margin:6px 0 0;font-size:18px;font-weight:600;color:#ffffff;">${totalCredits.toLocaleString('en-US')}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.06);">
                    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Transaction ID</p>
                    <p style="margin:6px 0 0;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#e2e8f0;word-break:break-all;">${transactionId}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;">
                    <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;">Date</p>
                    <p style="margin:6px 0 0;font-size:14px;color:#e2e8f0;">${dateLabel} UTC</p>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;font-size:12px;line-height:1.5;color:#64748b;">If you did not make this purchase, contact <a href="mailto:support@aimani.ai" style="color:#22d3ee;text-decoration:none;">support@aimani.ai</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

async function resolveUserEmail(
  supabaseAdmin: SupabaseClient,
  userId: string,
  hint?: string | null
): Promise<string | null> {
  if (hint?.trim()) return hint.trim()
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
  if (error) {
    console.error('[payment-confirmation] getUserById failed', error.message)
    return null
  }
  return data.user?.email ?? null
}

/**
 * Sends PayPal credit purchase confirmation via Resend.
 * Logs errors; never throws to callers.
 */
export async function sendPaymentConfirmationEmail(
  supabaseAdmin: SupabaseClient,
  params: PaymentConfirmationParams
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey) {
    console.warn('[payment-confirmation] RESEND_API_KEY not set; skipping email')
    return
  }

  try {
    const to = await resolveUserEmail(supabaseAdmin, params.userId, params.toEmail)
    if (!to) {
      console.warn('[payment-confirmation] no email for user', params.userId)
      return
    }

    const purchasedAt = params.purchasedAt ?? new Date()
    const html = buildPaymentConfirmationHtml({
      creditsPurchased: params.creditsPurchased,
      totalCredits: params.totalCredits,
      transactionId: params.transactionId,
      purchasedAt,
    })

    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: SUBJECT,
      html,
    })

    if (error) {
      console.error('[payment-confirmation] Resend error', error)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[payment-confirmation] send failed', msg)
  }
}
