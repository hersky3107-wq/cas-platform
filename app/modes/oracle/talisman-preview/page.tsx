import TalismanPreviewClient from "./TalismanPreviewClient";
import { constructedSinkang } from "./constructed";
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
  const sinkang = constructedSinkang();
  const sessionPayload = params.session
    ? await previewFromStoredSession(params.session, params.purpose ?? null, await signedInUserId())
    : null;
  return (
    <TalismanPreviewClient
      sessionId={params.session ?? null}
      purpose={params.purpose ?? null}
      fixture={params.fixture ?? null}
      sinkangSpec={sinkang.spec}
      sinkangStats={sinkang.stats}
      sessionPayload={sessionPayload}
    />
  );
}
