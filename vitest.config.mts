import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirrors tsconfig.json's "@/*": ["./*"] — no test previously needed this
  // alias resolved at runtime (only type-only "@/..." imports existed), but
  // mocking lib/supabase/server for lib/oracle/oracle-db.ts requires it.
  // `server-only` is a Next build guard; tsx/vitest use the empty stub.
  resolve: {
    alias: {
      '@': import.meta.dirname,
      'server-only': path.join(import.meta.dirname, 'scripts/stubs/server-only-empty.cjs'),
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/submission-donbanja/**'],
  },
})
