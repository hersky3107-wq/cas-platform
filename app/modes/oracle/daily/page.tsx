/**
 * Daily Fortune — 오늘의 운세.
 *
 * The page is a client (profile check + runner poll). Help copy is a static
 * import so the modal does not wait on the session.
 */
import HelpModal from "@/components/HelpModal";
import { oracleDailyHelpContent } from "@/lib/help-modal/oracle-daily-content";
import OracleDailyClient from "./OracleDailyClient";

export default function OracleDailyPage() {
  return (
    <>
      <HelpModal content={oracleDailyHelpContent} />
      <OracleDailyClient />
    </>
  );
}
