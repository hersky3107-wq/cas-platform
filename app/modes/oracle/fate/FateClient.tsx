"use client";

/**
 * Fate is the saju alias of the shared reading page.
 * Keep this wrapper so /modes/oracle/fate stays a stable import surface.
 */
import OracleSystemReadingClient, {
  type ReadingRosterOption,
} from "../reading/OracleSystemReadingClient";
import { readingStorageKey } from "@/lib/oracle/system-requirements";

export type FateRosterOption = ReadingRosterOption;

export default function FateClient({ rosters }: { rosters: FateRosterOption[] }) {
  return (
    <OracleSystemReadingClient
      systemId="saju"
      rosters={rosters}
      storageKey={readingStorageKey("saju")}
    />
  );
}
