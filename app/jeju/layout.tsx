// Jeju section tokens now live in app/globals.css (the Tailwind entry) so the
// bg-jeju-* / text-jeju-* / border-jeju-* utilities are actually generated.
// This layout is a passthrough; per-mode theming is applied via the
// data-jeju-theme attribute on wrappers (JejuThemeShell / governance layout).
export default function JejuLayout({ children }: { children: React.ReactNode }) {
  return children
}
