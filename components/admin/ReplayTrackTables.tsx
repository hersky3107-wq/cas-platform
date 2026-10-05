export type ReplayCompareCell = {
  category: string
  horizon: string
  n: number
  replayHits: number
  replayN: number
  ensembleHits: number
  ensembleN: number
}

export type ReplayCostRow = {
  roundId: string
  instrument: string
  promptTokens: number | null
  completionTokens: number | null
  costUsd: number | null
}

export function ReplayTrackTables({
  cells,
  costs,
}: {
  cells: readonly ReplayCompareCell[]
  costs: readonly ReplayCostRow[]
}) {
  return (
    <>
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">복기 vs AI 종합</h3>
      {cells.length > 0 ? (
        <table className="mt-3 w-full text-left text-xs" data-testid="replay-vs-ensemble">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-2">카테고리</th>
              <th className="py-1 pr-2">기간</th>
              <th className="py-1 pr-2">복기</th>
              <th className="py-1 pr-2">n</th>
              <th className="py-1 pr-2">AI 종합</th>
              <th className="py-1">n</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((row) => (
              <tr key={`${row.category}-${row.horizon}`} className="text-slate-200">
                <td className="py-1 pr-2">{row.category}</td>
                <td className="py-1 pr-2">{row.horizon}</td>
                <td className="py-1 pr-2">{row.replayN === 0 ? '—' : `${row.replayHits}/${row.replayN}`}</td>
                <td className="py-1 pr-2">{row.n}</td>
                <td className="py-1 pr-2">{row.ensembleN === 0 ? '—' : `${row.ensembleHits}/${row.ensembleN}`}</td>
                <td className="py-1">{row.ensembleN}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-xs text-slate-500">복기 노트가 없습니다. rebuild-lesson-notes --apply 이후 표시됩니다.</p>
      )}
      <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">복기 호출 비용</h3>
      {costs.length > 0 ? (
        <table className="mt-3 w-full text-left text-xs" data-testid="replay-costs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-2">종목</th>
              <th className="py-1 pr-2">입력 토큰</th>
              <th className="py-1 pr-2">출력 토큰</th>
              <th className="py-1">USD</th>
            </tr>
          </thead>
          <tbody>
            {costs.map((row) => (
              <tr key={row.roundId} className="text-slate-200">
                <td className="py-1 pr-2">{row.instrument}</td>
                <td className="py-1 pr-2">{row.promptTokens ?? '—'}</td>
                <td className="py-1 pr-2">{row.completionTokens ?? '—'}</td>
                <td className="py-1">{row.costUsd ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-2 text-xs text-slate-500">복기 호출 기록이 없습니다.</p>
      )}
    </>
  )
}
