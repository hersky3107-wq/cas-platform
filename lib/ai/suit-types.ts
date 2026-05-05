import type { AiProviderName } from '@/lib/ai/router'

export type SuitFormat = 'criminal' | 'civil'

export type SuitParticipationMode = 'spectator' | 'witness' | 'counsel'

/** Legal roles argued by models or user. */
export type SuitLegalRole =
  | 'prosecutor'
  | 'defense'
  | 'counsel_a'
  | 'counsel_b'
  | 'judge'
  | 'user'

export type RoleAssignment = {
  provider: AiProviderName | 'user'
  model: string
  role: SuitLegalRole
  /** Prosecution-side vs defense-side bucket (criminal); A vs B (civil). */
  sideBucket: 'side_a' | 'side_b'
}

export type SuitMessage = {
  id: string
  role: SuitLegalRole
  sideBucket: 'side_a' | 'side_b' | 'neutral'
  provider: AiProviderName | 'user' | 'opus_judge'
  displayName: string
  phase: string
  round?: number
  content: string
  responseTimeMs?: number
  createdAt: number
}

export type SuitClientConfig = {
  topic: string
  format: SuitFormat
  participationMode: SuitParticipationMode
  /** criminal + spectator|witness — user's preferred verdict side (UI voting). */
  userPreferredSide?: 'prosecution' | 'defense'
  /** counsel — user's counsel role */
  userCounselRole?: 'prosecutor' | 'defense' | 'counsel_a' | 'counsel_b'
  /** counsel — AI the user selected as their counsel (persona / gallery; human still argues) */
  userCounselProvider?: AiProviderName
  opponentProvider?: AiProviderName
  assignments: RoleAssignment[]
}

export type RoundResult = {
  assignment: RoleAssignment
  round: number
  phase: string
  text: string | null
  responseTimeMs: number
  error?: string
}
