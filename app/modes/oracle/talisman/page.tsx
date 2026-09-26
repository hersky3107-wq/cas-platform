import { Suspense } from "react";
import OracleTalismanClient from "./OracleTalismanClient";

export default function OracleTalismanPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-[#0a0f1e]" />}>
      <OracleTalismanClient />
    </Suspense>
  );
}
