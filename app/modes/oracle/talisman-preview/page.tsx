import TalismanPreviewClient from "./TalismanPreviewClient";
import { constructedPreviews } from "./constructed";
import { previewFromStoredSession } from "./preview-session";
import { createSupabaseRouteAuthClient } from "@/lib/supabase/route-auth";

async function signedInUserId(): Promise<string | null> {
  try {
    const supabase = await createSupabaseRouteAuthClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export default async function TalismanPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; purpose?: string; fixture?: string }>;
}) {
  const params = await searchParams;
  const fixtures = constructedPreviews();
  const sinkang = fixtures.find((item) => item.id === "sinkang");
  if (!sinkang) throw new Error("constructed 신강 missing");
  const sessionPayload = params.session
    ? await previewFromStoredSession(params.session, params.purpose ?? null, await signedInUserId())
    : null;
  return (
    <TalismanPreviewClient
      sessionId={params.session ?? null}
      purpose={params.purpose ?? null}
      fixture={params.fixture ?? null}
      fixtures={fixtures}
      sinkangSpec={sinkang.spec}
      sinkangStats={sinkang.stats}
      sessionPayload={sessionPayload}
    />
  );
}
