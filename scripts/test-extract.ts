/**
 * Manual smoke-test for lib/extract url adapter.
 * Run from project root:
 *   npx tsx scripts/test-extract.ts
 */

import { extract } from '@/lib/extract'

const PREVIEW_LENGTH = 500

function printResult(label: string, result: Awaited<ReturnType<typeof extract>>) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`TEST: ${label}`)
  console.log(`─`.repeat(60))
  console.log(`ok:        `, result.ok)
  console.log(`title:     `, result.title)
  console.log(`text.length:`, result.text.length)
  console.log(`truncated: `, result.truncated)
  if (!result.ok) {
    console.log(`error:     `, result.error)
  } else {
    console.log(`\n--- first ${PREVIEW_LENGTH} chars of text ---`)
    console.log(result.text.slice(0, PREVIEW_LENGTH))
    console.log(`--- end preview ---`)
  }
}

async function main() {
  console.log('Running extract smoke tests...\n')

  // Test 1: real public URL (Jeju provincial government site)
  const real = await extract({
    type: 'url',
    value: 'https://www.jeju.go.kr',
  })
  printResult('https://www.jeju.go.kr (expect ok: true)', real)

  // Test 2: deliberately broken domain (expect ok: false, no throw)
  const broken = await extract({
    type: 'url',
    value: 'https://this-domain-does-not-exist-12345.com',
  })
  printResult('https://this-domain-does-not-exist-12345.com (expect ok: false)', broken)

  // Test 3: unimplemented adapter type (expect ok: false, no throw)
  const pdf = await extract({
    type: 'pdf',
    value: '/tmp/fake.pdf',
  })
  printResult('type: pdf (expect ok: false, not implemented)', pdf)

  console.log(`\n${'─'.repeat(60)}`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Uncaught error (this should not happen):', err)
  process.exit(1)
})
