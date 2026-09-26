import TalismanPreviewClient from "./TalismanPreviewClient";

export default async function TalismanPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; purpose?: string }>;
}) {
  const params = await searchParams;
  return <TalismanPreviewClient sessionId={params.session ?? null} purpose={params.purpose ?? null} />;
}
