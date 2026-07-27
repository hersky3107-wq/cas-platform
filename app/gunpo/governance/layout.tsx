/**
 * Governance sub-layout — theme scoping is handled by JejuThemeShell on each
 * page (which reads councilMode and sets data-jeju-theme accordingly). This
 * layout is a pure passthrough; it must NOT set data-jeju-theme here or the
 * server-rendered attribute would freeze the palette at "governance" before
 * the client mode-context hydrates.
 */
export default function JejuGovernanceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
