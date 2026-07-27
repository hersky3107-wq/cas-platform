// Jeju section tokens live in app/globals.css (the Tailwind entry) so the
// bg-jeju-* / text-jeju-* / border-jeju-* utilities are generated. Per-mode
// theming is applied via the data-jeju-theme attribute on wrappers
// (JejuThemeShell / governance layout).
//
// This layout also provides the AX COUNCIL trade/warroom mode context to the
// whole motie subtree.
import { MotieModeProvider } from '@/components/gunpo/mode-context'

export default function MotieLayout({ children }: { children: React.ReactNode }) {
  return <MotieModeProvider>{children}</MotieModeProvider>
}
