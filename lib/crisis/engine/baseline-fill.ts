import { obviousList } from './hunter-rules'
import type { BaselineRisk, EngineCard } from './schema'

export interface AnalystFinding {
  department: string
  signal: string
}

function parseJudgeBaseline(rows: unknown): BaselineRisk[] {
  if (!Array.isArray(rows)) return []
  const out: BaselineRisk[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const stageRaw = typeof record.stage === 'number' ? record.stage : Number(record.stage)
    const stage = Number.isFinite(stageRaw) ? Math.min(5, Math.max(1, Math.round(stageRaw))) : 0
    const possibility = record.possibility
    const what = Array.isArray(record.what_to_do)
      ? record.what_to_do.filter((line): line is string => typeof line === 'string' && line.trim().length > 0).map((line) => line.trim())
      : []
    if (!title || !stage || (possibility !== 'low' && possibility !== 'medium' && possibility !== 'high') || what.length === 0) continue
    out.push({
      title,
      stage,
      possibility,
      what_to_do: what,
      reason: typeof record.reason === 'string' ? record.reason.trim() : undefined,
    })
  }
  return out.slice(0, 5)
}

/** Judge baseline rows first; pad to at least 3 from obvious-list lines and analyst signals. */
export function mergeBaselineRisks(
  judgeRows: unknown,
  card: EngineCard,
  analystFindings: AnalystFinding[],
): BaselineRisk[] {
  const out = parseJudgeBaseline(judgeRows)
  const seen = new Set(out.map((row) => row.title.toLowerCase()))
  const push = (row: BaselineRisk) => {
    const key = row.title.toLowerCase()
    if (seen.has(key) || out.length >= 5) return
    seen.add(key)
    out.push(row)
  }

  for (const finding of analystFindings) {
    if (out.length >= 5) break
    const signal = finding.signal.trim()
    if (signal.length < 8) continue
    push({
      title: signal.length > 120 ? `${signal.slice(0, 117)}…` : signal,
      stage: 3,
      possibility: 'medium',
      what_to_do: [`Follow ${card.name} official notices and local radio for ${finding.department.replace(/-/g, ' ')}.`],
      reason: `analyst ${finding.department}`,
    })
  }

  for (const entry of obviousList(card)) {
    if (out.length >= 5) break
    push({
      title: entry.line.replace(/\s→\s/g, ' may lead to '),
      stage: 2,
      possibility: 'medium',
      what_to_do: [`Know the official warning channels for ${card.name} before heavy rain or dam releases.`],
      reason: 'textbook baseline from the card',
    })
  }

  while (out.length < 3) {
    push({
      title: `${card.name}: heavy rain can flood low areas and cut roads`,
      stage: 2,
      possibility: 'medium',
      what_to_do: [`Keep a go-bag ready in ${card.name} during the monsoon.`],
      reason: 'generic regional baseline',
    })
  }

  return out.slice(0, 5)
}
