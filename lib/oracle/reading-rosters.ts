import {
  ORACLE_SINGLE_READER_COUNTS,
  resolveSingleSystemRoster,
} from "@/lib/oracle/ai/family-roster";
import type { SystemId } from "@/lib/oracle/axes/types";
import { creditsForOracleSession } from "@/lib/oracle/runner/conventions";

export type ReadingRosterOption = {
  readerCount: number;
  readers: string[];
  synthesizer: string;
  credits: number;
};

export function buildSystemRosters(systemId: SystemId): ReadingRosterOption[] {
  return ORACLE_SINGLE_READER_COUNTS.map((readerCount) => {
    const roster = resolveSingleSystemRoster(systemId, readerCount);
    return {
      readerCount,
      readers: [...roster.readers],
      synthesizer: roster.synthesizer,
      credits: creditsForOracleSession("single", readerCount),
    };
  });
}
