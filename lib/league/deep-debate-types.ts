export type DeepDebateResult = {
  ok: boolean
  kind: 'debate'
  instrument: string
  proposition: string
  briefing: string | null
  consensusScore: number | null
  vote: { approve: number; oppose: number; conditional: number; abstain: number; summary: string } | null
  verdict: {
    judgment: string | null
    keyIssues: string | null
    minorityReport: string | null
  } | null
  error?: string
}
