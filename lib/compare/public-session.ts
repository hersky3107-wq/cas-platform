import 'server-only'

import { parseCompareResponses, type CompareSessionRow } from '@/lib/compare/session-types'

export { PUBLIC_SHARE_BASE } from '@/lib/compare/session-types'
import { supabaseAdmin } from '@/lib/supabase/server'

export async function getPublicCompareSession(
  shareId: string
): Promise<CompareSessionRow | null> {
  const { data, error } = await supabaseAdmin
    .from('compare_sessions')
    .select('id, share_id, user_id, question, responses, is_public, voted_ai')
    .eq('share_id', shareId)
    .eq('is_public', true)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[compare] public session lookup:', error.message)
    return null
  }

  return {
    id: data.id,
    share_id: data.share_id,
    user_id: data.user_id,
    question: data.question,
    responses: parseCompareResponses(data.responses),
    is_public: Boolean(data.is_public),
    voted_ai: typeof data.voted_ai === 'string' ? data.voted_ai : null,
  }
}
