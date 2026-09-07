/**
 * 궁합 (two-person compatibility) — tier-2 lobby entry, two modes on one page:
 * 단일 체계 궁합 (one system, N=3/5) and 통합 12체계 궁합 (N=3/5/7).
 *
 * Server wrapper: resolves reader/synthesizer BRANDS here so the client
 * bundle never imports the model registry (model ids are server-only).
 * The runner, roster, poll loop, archive projection and share page are the
 * SAME code paths as the reading side — compatibility is a scope, not a stack.
 */
import OracleCompatClient from "./OracleCompatClient";
import { LAYER1_REGISTRY } from "@/lib/oracle/ai/registry";
import { INTEGRATED_SYNTHESIZER_BRAND } from "@/lib/oracle/ai/family-roster";
import { SYSTEM_IDS, type SystemId } from "@/lib/oracle/axes/types";
import { buildCompatSystemRosters, type ReadingRosterOption } from "@/lib/oracle/reading-rosters";
import { COMPAT_SINGLE_SYSTEMS } from "@/lib/oracle/runner/compute-compat";

export default function OracleCompatPage() {
  const singleRosters = Object.fromEntries(
    COMPAT_SINGLE_SYSTEMS.map((system) => [system, buildCompatSystemRosters(system)]),
  ) as Record<SystemId, ReadingRosterOption[]>;

  return (
    <OracleCompatClient
      compatSingleSystems={[...COMPAT_SINGLE_SYSTEMS]}
      singleRosters={singleRosters}
      readerBrands={SYSTEM_IDS.map((system) => ({
        system,
        brand: LAYER1_REGISTRY[system].brand,
      }))}
      integratedSynthesizerBrand={INTEGRATED_SYNTHESIZER_BRAND}
    />
  );
}
