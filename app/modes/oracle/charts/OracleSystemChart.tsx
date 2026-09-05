"use client";

/**
 * Per-system calculation display.
 *
 * Saju keeps the 팔자표. Every other system uses StructuredComputationPanel
 * until its real chart is registered here — swap by adding an entry to CHARTS,
 * not by forking the reading page.
 */
import type { SystemId } from "@/lib/oracle/axes/types";
import { oracleSystemDisplayName } from "@/lib/oracle/system-display";
import SajuPillarsChart from "./SajuPillarsChart";
import StructuredComputationPanel from "./StructuredComputationPanel";

type Json = Record<string, unknown>;

type ChartProps = {
  system: string;
  calculation: Json | null;
  engineVersion: string | null;
  unreadable?: boolean;
};

export default function OracleSystemChart({
  system,
  calculation,
  engineVersion,
  unreadable,
}: ChartProps) {
  if (system === "saju") {
    return (
      <SajuPillarsChart calculation={calculation} engineVersion={engineVersion} />
    );
  }
  return (
    <StructuredComputationPanel
      systemName={oracleSystemDisplayName(system) || system}
      calculation={calculation}
      engineVersion={engineVersion}
      unreadable={unreadable}
    />
  );
}

/** Registry hook: dedicated charts land here as they are built. */
export const ORACLE_SYSTEM_CHARTS: Partial<
  Record<SystemId, typeof SajuPillarsChart>
> = {
  saju: SajuPillarsChart,
};
