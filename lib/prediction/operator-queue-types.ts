export type OperatorQueueItem = {
  id: string
  proposition_text: string
  subject_label: string | null
  category: string
  instrument: string
  horizon: string
  proposition_kind: string
  side_a: string
  side_b: string
  resolves_at: string
  days_waiting: number
  tally: { a: number; b: number; abstain: number; total: number }
}
