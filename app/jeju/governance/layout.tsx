/**
 * Wraps every governance page (deep / lite / media) in the governance theme so
 * the dark-premium token set applies structurally — pages must not hardcode
 * backgrounds. The data attribute scopes the CSS variables defined in
 * app/globals.css (the Tailwind entry) to this whole subtree.
 */
export default function JejuGovernanceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div data-jeju-theme="governance" className="min-h-screen bg-jeju-bg text-jeju-fg">
      {children}
    </div>
  )
}
