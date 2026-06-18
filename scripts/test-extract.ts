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

  // Test 4: XML with resultCode 00 (KPX-style power data, expect ok: true)
  const sampleXmlOk = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>00</resultCode>
    <resultMsg>OK</resultMsg>
  </header>
  <body>
    <items>
      <item>
        <baseDatetime>20260618120000</baseDatetime>
        <suppAbility>1014.0</suppAbility>
        <currPwrTot>625.0</currPwrTot>
        <renewPwrTot>101.17</renewPwrTot>
        <renewPwrSolar>0</renewPwrSolar>
        <renewPwrWind>89.19</renewPwrWind>
      </item>
      <item>
        <baseDatetime>20260618120500</baseDatetime>
        <suppAbility>1020.5</suppAbility>
        <currPwrTot>630.2</currPwrTot>
        <renewPwrTot>105.40</renewPwrTot>
        <renewPwrSolar>2.1</renewPwrSolar>
        <renewPwrWind>90.05</renewPwrWind>
      </item>
      <item>
        <baseDatetime>20260618121000</baseDatetime>
        <suppAbility>1009.8</suppAbility>
        <currPwrTot>618.7</currPwrTot>
        <renewPwrTot>98.60</renewPwrTot>
        <renewPwrSolar>1.4</renewPwrSolar>
        <renewPwrWind>85.30</renewPwrWind>
      </item>
    </items>
  </body>
</response>`
  const xmlOk = await extract({
    type: 'xml',
    value: sampleXmlOk,
    meta: { title: 'KPX Power Supply', sourceLabel: 'kpx-sample.xml' },
  })
  printResult('type: xml resultCode 00 (expect ok: true)', xmlOk)

  // Test 5: XML with non-00 resultCode (dead/unregistered key, expect ok: false)
  const sampleXmlErr = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header>
    <resultCode>30</resultCode>
    <resultMsg>SERVICE KEY IS NOT REGISTERED ERROR</resultMsg>
  </header>
  <body></body>
</response>`
  const xmlErr = await extract({
    type: 'xml',
    value: sampleXmlErr,
    meta: { sourceLabel: 'kpx-bad-key.xml' },
  })
  printResult('type: xml resultCode 30 (expect ok: false)', xmlErr)

  console.log(`\n${'─'.repeat(60)}`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Uncaught error (this should not happen):', err)
  process.exit(1)
})
