/**
 * Fate route shell — saju on the shared reading page.
 *
 * Server component on purpose: the reader roster is resolved here so the brand
 * names can be shown BEFORE the run without shipping the model registry into
 * the browser bundle.
 */
import HelpModal from "@/components/HelpModal";
import { oracleSystemHelpContent } from "@/lib/help-modal/oracle-system-content";
import { buildSystemRosters } from "@/lib/oracle/reading-rosters";
import FateClient from "./FateClient";

export default function OracleFatePage() {
  return (
    <>
      <HelpModal content={oracleSystemHelpContent("saju")} />
      <FateClient rosters={buildSystemRosters("saju")} />
    </>
  );
}
