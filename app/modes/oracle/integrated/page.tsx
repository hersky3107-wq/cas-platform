/**
 * INTEGRATED 12-system verdict — the lobby's hero tier.
 *
 * Server wrapper: resolves the per-system dedicated reader BRANDS and the
 * combined synthesizer brand here so the client bundle never imports the
 * model registry (model ids are server-only; brands are public).
 */
import OracleIntegratedClient from "./OracleIntegratedClient";
import { LAYER1_REGISTRY } from "@/lib/oracle/ai/registry";
import { INTEGRATED_SYNTHESIZER_BRAND } from "@/lib/oracle/ai/family-roster";
import { SYSTEM_IDS } from "@/lib/oracle/axes/types";

export default function OracleIntegratedPage() {
  return (
    <OracleIntegratedClient
      readerBrands={SYSTEM_IDS.map((system) => ({
        system,
        brand: LAYER1_REGISTRY[system].brand,
      }))}
      synthesizerBrand={INTEGRATED_SYNTHESIZER_BRAND}
    />
  );
}
