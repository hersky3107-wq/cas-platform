# Raw source CSVs — 제주 클린하우스

One-off inputs for `scripts/build-cleanhouse.ts`. Downloaded from data.go.kr
(FILE data, no API subscription — login-free download via the grey 다운로드 button).

Place these two files here with EXACTLY these names:

| File | data.go.kr dataset | Page |
| --- | --- | --- |
| `jeju-city-cleanhouse.csv` | 제주시 클린하우스 (15110514, ~1,359 rows) | https://www.data.go.kr/data/15110514/fileData.do |
| `seogwipo-cleanhouse.csv` | 서귀포시 클린하우스현황 (15056472, ~388 rows) | https://www.data.go.kr/data/15056472/fileData.do |

Encoding: leave as-downloaded (usually EUC-KR). The build script auto-detects
UTF-8 vs EUC-KR. Do not re-save/convert.

Run the converter:

```
npx tsx scripts/build-cleanhouse.ts
```

It normalizes + merges both cities and writes `lib/jeju/data/cleanhouse.json`.
