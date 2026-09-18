"use client";

import {
  collapseTextInferences,
  formatAiJudgementLine,
  type TextInference,
} from "@/lib/oracle/tier2";

export default function AiJudgementNote({
  inferences,
}: {
  inferences: TextInference[];
  /** Kept so call sites compile; never rendered. A TIER 2 request with no answer stays silent. */
  pending?: string;
}) {
  const collapsed = collapseTextInferences(inferences);
  if (collapsed.length === 0) return null;
  return (
    <div className="mt-3 space-y-1 rounded-xl border border-amber-300/25 bg-amber-400/[0.08] px-3 py-2">
      {collapsed.map((row) => (
        <p key={`${row.text}-${row.brand ?? "all"}`} className="text-sm leading-relaxed text-amber-50">
          {formatAiJudgementLine(row.text)}
          {row.brand ? ` (${row.brand})` : ""}
        </p>
      ))}
    </div>
  );
}
