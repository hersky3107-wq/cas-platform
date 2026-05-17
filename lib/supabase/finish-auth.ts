import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js'

export type AuthCallbackParams = {
  code: string | null
  token_hash: string | null
  type: string | null
  error_description: string | null
  error: string | null
}

export function parseAuthCallbackParams(
  searchParams: URLSearchParams,
  hash = ''
): AuthCallbackParams {
  const hashParams = hash.startsWith('#')
    ? new URLSearchParams(hash.slice(1))
    : new URLSearchParams(hash)

  return {
    code: searchParams.get('code') ?? hashParams.get('code'),
    token_hash: searchParams.get('token_hash') ?? hashParams.get('token_hash'),
    type: searchParams.get('type') ?? hashParams.get('type'),
    error_description: searchParams.get('error_description') ?? hashParams.get('error_description'),
    error: searchParams.get('error') ?? hashParams.get('error'),
  }
}

function otpType(raw: string | null): EmailOtpType | null {
  if (!raw) return null
  const allowed: EmailOtpType[] = ['email', 'magiclink', 'signup', 'recovery', 'invite', 'email_change']
  return allowed.includes(raw as EmailOtpType) ? (raw as EmailOtpType) : null
}

/** Complete magic-link / OAuth callback (client or server Supabase client). */
export async function finishAuthCallback(
  supabase: SupabaseClient,
  params: AuthCallbackParams,
  hash = ''
): Promise<{ ok: true } | { ok: false; message: string }> {
  const authError = params.error_description || params.error
  if (authError) {
    return { ok: false, message: authError }
  }

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code)
    if (error) {
      return { ok: false, message: error.message }
    }
    return { ok: true }
  }

  const type = otpType(params.type)
  if (params.token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: params.token_hash,
      type,
    })
    if (error) {
      return { ok: false, message: error.message }
    }
    return { ok: true }
  }

  const hashParams = hash.startsWith('#')
    ? new URLSearchParams(hash.slice(1))
    : new URLSearchParams(hash)
  const access_token = hashParams.get('access_token')
  const refresh_token = hashParams.get('refresh_token')

  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token })
    if (error) {
      return { ok: false, message: error.message }
    }
    return { ok: true }
  }

  return {
    ok: false,
    message:
      'Invalid or expired login link. Request a new link and open it in the same browser where you entered your email.',
  }
}
