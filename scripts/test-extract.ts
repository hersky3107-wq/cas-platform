/**
 * Manual smoke-test for lib/extract url adapter.
 * Run from project root:
 *   npx tsx scripts/test-extract.ts
 */

import { extract } from '@/lib/extract'

const PREVIEW_LENGTH = 500

// Paste your KPX openapi.kpx.or.kr service key here to run the live json-api test.
// Leave as-is to see the graceful error path (auth/resultCode failure handled, no throw).
const SERVICE_KEY = 'PASTE_SERVICE_KEY_HERE'

// KPX Jeju 5-minute supply (solar/wind) — verified endpoint, returns XML.
const KPX_JEJU_URL =
  `https://openapi.kpx.or.kr/openapi/chejusukub5mToday/getChejuSukub5mToday?serviceKey=${encodeURIComponent(SERVICE_KEY)}`

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

  // Test 3: PDF — file not found (expect ok: false, no throw)
  // The adapter now dispatches to extractPdf. A missing path must return
  // ok:false with a clear error rather than throwing.
  const pdfMissing = await extract({
    type: 'pdf',
    value: '/tmp/does-not-exist-12345.pdf',
  })
  printResult('type: pdf — missing file (expect ok: false)', pdfMissing)

  // Manual real-PDF test (not automated — requires an actual file):
  //   copy any PDF to scripts/ then run:
  //   $env:NODE_PATH=".\scripts\stubs"; npx tsx scripts/test-extract.ts
  //   and temporarily add:
  //     const real = await extract({ type: 'pdf', value: './scripts/sample.pdf' })
  //     printResult('type: pdf — real file', real)

  // Test 4: CSV raw — standard comma-delimited with header (expect ok: true)
  const sampleCsv = `datetime,supply_mw,demand_mw,renewable_mw,solar_mw,wind_mw
2026-06-18 12:00,1014.0,625.0,101.2,0.0,89.2
2026-06-18 12:05,1020.5,630.2,105.4,2.1,90.1
2026-06-18 12:10,1009.8,618.7,98.6,1.4,85.3`
  const csvOk = await extract({
    type: 'csv',
    value: sampleCsv,
    meta: { raw: true, title: 'KPX Power Data', sourceLabel: 'kpx-power.csv' },
  })
  printResult('type: csv raw comma (expect ok: true)', csvOk)

  // Test 5: CSV raw — tab-delimited (TSV) (expect ok: true)
  const sampleTsv = `station\ttemp_c\thumidity\twind_kph\nJeju Airport\t24.5\t72\t15.3\nSeogwipo\t25.1\t78\t12.7\nHalla Summit\t14.2\t90\t31.8`
  const tsvOk = await extract({
    type: 'csv',
    value: sampleTsv,
    meta: { raw: true, sourceLabel: 'jeju-weather.tsv' },
  })
  printResult('type: csv raw tab-delimited/TSV (expect ok: true)', tsvOk)

  // Test 6: CSV raw — empty content (expect ok: false)
  const csvEmpty = await extract({
    type: 'csv',
    value: '   ',
    meta: { raw: true },
  })
  printResult('type: csv raw empty (expect ok: false)', csvEmpty)

  // Test 7: XML with resultCode 00 (KPX-style power data, expect ok: true)
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

  // Test 9: DOCX — missing file (expect ok: false, no throw)
  // Manual real-file test:
  //   const r = await extract({ type: 'docx', value: './scripts/sample.docx' })
  //   printResult('type: docx — real file', r)
  const docxMissing = await extract({
    type: 'docx',
    value: '/tmp/does-not-exist-12345.docx',
  })
  printResult('type: docx — missing file (expect ok: false)', docxMissing)

  // Test 10: XLSX — missing file (expect ok: false, no throw)
  // Manual real-file test:
  //   const r = await extract({ type: 'xlsx', value: './scripts/sample.xlsx' })
  //   printResult('type: xlsx — real file', r)
  const xlsxMissing = await extract({
    type: 'xlsx',
    value: '/tmp/does-not-exist-12345.xlsx',
  })
  printResult('type: xlsx — missing file (expect ok: false)', xlsxMissing)

  // Test 11: HWPX — missing file (expect ok: false, no throw)
  // Manual real-file test (modern XML-based HWPX only; legacy binary .hwp is rejected):
  //   const r = await extract({ type: 'hwpx', value: './scripts/sample.hwpx' })
  //   printResult('type: hwpx — real file', r)
  const hwpxMissing = await extract({
    type: 'hwpx',
    value: '/tmp/does-not-exist-12345.hwpx',
  })
  printResult('type: hwpx — missing file (expect ok: false)', hwpxMissing)

  // Test 12: JSON-API live — KPX Jeju power data.
  // With a valid SERVICE_KEY: shows real solar/wind data as a table.
  // With the placeholder: shows the graceful error (auth/resultCode), no throw.
  const kpx = await extract({
    type: 'json-api',
    value: KPX_JEJU_URL,
    meta: {
      format: 'xml',
      title: 'KPX Jeju Power',
      sourceLabel: 'kpx-jeju',
    },
  })
  printResult('type: json-api KPX Jeju (live — needs SERVICE_KEY)', kpx)

  console.log(`\n${'─'.repeat(60)}`)
  console.log('Done.')
}

main().catch((err) => {
  console.error('Uncaught error (this should not happen):', err)
  process.exit(1)
})
