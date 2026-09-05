"use client";

/**
 * Per-system calculation display.
 *
 * Saju keeps the 팔자표. Tarot shows drawn card images. Every other system
 * uses a curated Korean summary — engine internals stay behind 자세히 보기.
 */
import { oracleSystemDisplayName } from "@/lib/oracle/system-display";
import SajuPillarsChart from "./SajuPillarsChart";
import ComputationSummary from "./ComputationSummary";

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
    <ComputationSummary
      system={system}
      systemName={oracleSystemDisplayName(system) || system}
      calculation={calculation}
      engineVersion={engineVersion}
      unreadable={unreadable}
    />
  );
}
