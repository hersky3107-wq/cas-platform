import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirrors tsconfig.json's "@/*": ["./*"] — no test previously needed this
  // alias resolved at runtime (only type-only "@/..." imports existed), but
  // mocking lib/supabase/server for lib/oracle/oracle-db.ts requires it.
  resolve: {
    alias: { '@': import.meta.dirname },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/submission-donbanja/**'],
  },
})
