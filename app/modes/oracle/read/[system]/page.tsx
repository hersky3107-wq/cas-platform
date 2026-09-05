/**
 * Parameterized single-system reading. Every id in SYSTEM_IDS (all 12,
 * PRISM included) is served here. /modes/oracle/fate remains the saju alias
 * so existing links and in-flight sessions keep working.
 */
import { notFound } from "next/navigation";
import HelpModal from "@/components/HelpModal";
import { oracleSystemHelpContent } from "@/lib/help-modal/oracle-system-content";
import { SYSTEM_IDS } from "@/lib/oracle/axes/types";
import { buildSystemRosters } from "@/lib/oracle/reading-rosters";
import {
  isReadingSystemId,
  readingStorageKey,
} from "@/lib/oracle/system-requirements";
import OracleSystemReadingClient from "../../reading/OracleSystemReadingClient";

type PageProps = {
  params: Promise<{ system: string }>;
};

export function generateStaticParams() {
  return SYSTEM_IDS.map((system) => ({ system }));
}

export default async function OracleReadPage({ params }: PageProps) {
  const { system } = await params;
  if (!isReadingSystemId(system)) notFound();

  return (
    <>
      <HelpModal content={oracleSystemHelpContent(system)} />
      <OracleSystemReadingClient
        systemId={system}
        rosters={buildSystemRosters(system)}
        storageKey={readingStorageKey(system)}
      />
    </>
  );
}
