"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { OracleBirthProfileV1 } from "@/lib/oracle/types";
import OracleReadingClient from "../OracleReadingClient";

const BG = "min-h-screen bg-[#0a0f1e] text-white";

export default function OracleFatePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [oracleProfile, setOracleProfile] =
    useState<OracleBirthProfileV1 | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/oracle/profile").catch(() => null);
      if (cancelled) return;

      if (!res?.ok) {
        setOracleProfile(null);
        setReady(true);
        return;
      }

      const j = (await res.json().catch(() => null)) as {
        profile?: OracleBirthProfileV1 | null;
        complete?: boolean;
      };
      const hasProfile = j?.profile != null && typeof j.profile === "object";
      if (!hasProfile || !j?.complete) {
        router.replace("/modes/oracle/profile");
        return;
      }
      setOracleProfile(j.profile!);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready)
    return <main className={BG} aria-busy="true" />;

  return (
    <OracleReadingClient
      apiPath="/api/oracle/fate"
      title="Fate circle"
      blurb="Eastern pillar reading from your stored birth sketch. Claude · Gemini · Grok · DeepSeek · Mistral answer in prose, then gpt‑4.1 weaves them."
      {...(oracleProfile
        ? { skipProfileGate: true as const, oracleBirthProfile: oracleProfile }
        : {})}
    />
  );
}
