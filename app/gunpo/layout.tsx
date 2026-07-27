// Jeju section tokens live in app/globals.css (the Tailwind entry) so the
// bg-jeju-* / text-jeju-* / border-jeju-* utilities are generated. Per-theme
// theming is applied via the data-jeju-theme attribute on wrappers
// (JejuThemeShell / governance layout).
//
// STEP12: MotieModeProvider remains so existing useMotieMode() call sites
// keep working, but the mode is fixed (toggle removed).
import { MotieModeProvider } from '@/components/gunpo/mode-context'

export default function MotieLayout({ children }: { children: React.ReactNode }) {
  return <MotieModeProvider>{children}</MotieModeProvider>
}
