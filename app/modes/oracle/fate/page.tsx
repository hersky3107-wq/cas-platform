/**
 * Fate route shell.
 *
 * Server component on purpose: the reader roster is resolved here so the brand
 * names can be shown BEFORE the run without shipping the model registry (which
 * carries server-only model ids) into the browser bundle.
 */
import HelpModal from "@/components/HelpModal";
import { oracleFateHelpContent } from "@/lib/help-modal/oracle-fate-content";
import {
  ORACLE_SINGLE_READER_COUNTS,
  resolveSingleSystemRoster,
} from "@/lib/oracle/ai/family-roster";
import { creditsForOracleSession } from "@/lib/oracle/runner/conventions";
import FateClient, { type FateRosterOption } from "./FateClient";

export default function OracleFatePage() {
  const rosters: FateRosterOption[] = ORACLE_SINGLE_READER_COUNTS.map((readerCount) => {
    const roster = resolveSingleSystemRoster("saju", readerCount);
    return {
      readerCount,
      readers: [...roster.readers],
      synthesizer: roster.synthesizer,
      credits: creditsForOracleSession("single", readerCount),
    };
  });

  return (
    <>
      <HelpModal content={oracleFateHelpContent} />
      <FateClient rosters={rosters} />
    </>
  );
}
