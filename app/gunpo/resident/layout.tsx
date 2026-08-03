import { redirect } from 'next/navigation'

// ── TEMPORARY (mayor demo, 2026-08-03): resident (시민) mode hidden ──────────
// All routes under /gunpo/resident/* redirect straight to the governance
// unified page so the demo only ever shows the governance experience.
//
// This is a routing-only change: no resident page or lib/gunpo/resident/*
// file has been touched or deleted. To bring resident mode back, delete this
// file (or remove the `redirect(...)` call below) — every existing resident
// page starts working again immediately, unchanged.
export default function GunpoResidentLayout({
  children: _children,
}: {
  children: React.ReactNode
}) {
  redirect('/gunpo/governance/unified')
}
