import dynamic from "next/dynamic";

/** Throwaway SVG preview — client-only so the dense SVG tree is not hydrated. */
const TalismanPreviewClient = dynamic(() => import("./TalismanPreviewClient"), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-[#0a0f1e] px-4 py-8 text-white">
      <p className="text-[10px] tracking-[0.32em] text-white/40 uppercase">throwaway · no engine</p>
      <h1 className="mt-2 text-2xl font-semibold">부적 preview</h1>
    </main>
  ),
});

export default function TalismanPreviewPage() {
  return <TalismanPreviewClient />;
}
