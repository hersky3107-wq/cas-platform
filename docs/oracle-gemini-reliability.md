# Gemini tarot reliability (thinking-budget hypothesis)

## Call-site comparison (bakeoff vs smoke)

| knob | bakeoff (Google×tarot) | smoke (Google×tarot) |
| --- | --- | --- |
| entry point | `callLayer1Model` direct | `layer1-adapter` → `callLayer1Model` |
| HTTP | `streamGenerateContent?alt=sse` (streaming) | same |
| allowGeminiThinking | `true` (registry.tarot) | `true` (registry.tarot) |
| temperature | unset (provider default) | unset (provider default) |
| concurrency | sequential solo brand loops | parallel with other systems in `advance` chunk |
| request pacing | immediate back-to-back | burst with other 11 units |
| maxCompletionTokens | 1200 | 1200 |

This script matches bakeoff pacing (sequential, frozen payload, same prompts).

## 1. Model id check

- **Sent id:** `gemini-3.6-flash`
- **Resolves in Google models list:** yes
- **Catalog match:** {"name":"gemini-3.6-flash","displayName":"Gemini 3.6 Flash","version":"3.6-flash-07-2026"}
- **Other gemini-3 flash aliases in catalog:** gemini-3-flash-preview, gemini-3.1-flash-image, gemini-3.1-flash-image-preview, gemini-3.1-flash-lite, gemini-3.1-flash-lite-image, gemini-3.1-flash-lite-preview, gemini-3.1-flash-live-preview, gemini-3.1-flash-tts-preview, gemini-3.5-flash, gemini-3.5-flash-lite, gemini-3.6-flash, gemini-3.7-flash

Naming is ruled out if resolves=yes — failures are not a stale model id.

## thinkingBudget:0 probe

```
HTTP 400: {
  "error": {
    "code": 400,
    "message": "Request contains an invalid argument.",
    "status": "INVALID_ARGUMENT"
  }
}

```

## 2. Raw usage samples

### Successful call usageMetadata
```json
{
  "promptTokenCount": 844,
  "candidatesTokenCount": 278,
  "totalTokenCount": 1122,
  "promptTokensDetails": [
    {
      "modality": "TEXT",
      "tokenCount": 844
    }
  ],
  "serviceTier": "standard"
}
```

### Truncated/failed call usageMetadata
```json
{
  "promptTokenCount": 844,
  "candidatesTokenCount": 46,
  "totalTokenCount": 2040,
  "promptTokensDetails": [
    {
      "modality": "TEXT",
      "tokenCount": 844
    }
  ],
  "thoughtsTokenCount": 1150,
  "serviceTier": "standard"
}
```

## 3. Arm A — CURRENT (allowGeminiThinking default / no thinkingConfig)

- **Parse success: 0/20**
- Cluster: fails at runs [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20] — early(1-5)=5, mid(6-15)=10, late(16-20)=5

| run | parsed | content | thoughts | finish | textChars | rawBodyBytes |
| ---: | --- | ---: | ---: | --- | ---: | ---: |
| 1 | false | 46 | 1150 | MAX_TOKENS | 84 | 8015 |
| 2 | false | 48 | 1148 | MAX_TOKENS | 82 | 8085 |
| 3 | false | 43 | 1153 | MAX_TOKENS | 83 | 7665 |
| 4 | false | 47 | 1149 | MAX_TOKENS | 124 | 7893 |
| 5 | false | 45 | 1151 | MAX_TOKENS | 82 | 7761 |
| 6 | false | 44 | 1152 | MAX_TOKENS | 82 | 7621 |
| 7 | false | 45 | 1151 | MAX_TOKENS | 89 | 8428 |
| 8 | false | 48 | 1148 | MAX_TOKENS | 90 | 8081 |
| 9 | false | 48 | 1148 | MAX_TOKENS | 80 | 7871 |
| 10 | false | 131 | 1065 | MAX_TOKENS | 217 | 8988 |
| 11 | false | 47 | 1149 | MAX_TOKENS | 88 | 8046 |
| 12 | false | 123 | 1073 | MAX_TOKENS | 207 | 8853 |
| 13 | false | 120 | 1076 | MAX_TOKENS | 213 | 8746 |
| 14 | false | 63 | 1133 | MAX_TOKENS | 116 | 7940 |
| 15 | false | 48 | 1148 | MAX_TOKENS | 87 | 8164 |
| 16 | false | 45 | 1151 | MAX_TOKENS | 85 | 7690 |
| 17 | false | 146 | 1050 | MAX_TOKENS | 252 | 8839 |
| 18 | false | 104 | 1092 | MAX_TOKENS | 180 | 8416 |
| 19 | false | 44 | 1152 | MAX_TOKENS | 143 | 7487 |
| 20 | false | 47 | 1149 | MAX_TOKENS | 84 | 8255 |

## 3. Arm B — thinkingLevel=minimal

- **Parse success: 20/20**
- Cluster: no failures

| run | parsed | content | thoughts | finish | textChars | rawBodyBytes |
| ---: | --- | ---: | ---: | --- | ---: | ---: |
| 1 | true | 278 | — | STOP | 592 | 6235 |
| 2 | true | 260 | — | STOP | 513 | 5849 |
| 3 | true | 316 | — | STOP | 674 | 6760 |
| 4 | true | 224 | — | STOP | 429 | 4871 |
| 5 | true | 242 | — | STOP | 490 | 5393 |
| 6 | true | 265 | — | STOP | 533 | 5843 |
| 7 | true | 261 | — | STOP | 546 | 5828 |
| 8 | true | 236 | — | STOP | 480 | 5402 |
| 9 | true | 269 | — | STOP | 555 | 5814 |
| 10 | true | 289 | — | STOP | 571 | 6226 |
| 11 | true | 241 | — | STOP | 486 | 5343 |
| 12 | true | 255 | — | STOP | 514 | 5380 |
| 13 | true | 266 | — | STOP | 564 | 5867 |
| 14 | true | 240 | — | STOP | 537 | 5436 |
| 15 | true | 277 | — | STOP | 592 | 6303 |
| 16 | true | 215 | — | STOP | 418 | 4904 |
| 17 | true | 259 | — | STOP | 592 | 5936 |
| 18 | true | 264 | — | STOP | 542 | 5822 |
| 19 | true | 255 | — | STOP | 527 | 5475 |
| 20 | true | 240 | — | STOP | 495 | 5390 |

## Failed-run raw body byte lengths

- arm=current run=1: rawBodyBytes=8015, finish=MAX_TOKENS, thoughts=1150, content=46, error=—
- arm=current run=2: rawBodyBytes=8085, finish=MAX_TOKENS, thoughts=1148, content=48, error=—
- arm=current run=3: rawBodyBytes=7665, finish=MAX_TOKENS, thoughts=1153, content=43, error=—
- arm=current run=4: rawBodyBytes=7893, finish=MAX_TOKENS, thoughts=1149, content=47, error=—
- arm=current run=5: rawBodyBytes=7761, finish=MAX_TOKENS, thoughts=1151, content=45, error=—
- arm=current run=6: rawBodyBytes=7621, finish=MAX_TOKENS, thoughts=1152, content=44, error=—
- arm=current run=7: rawBodyBytes=8428, finish=MAX_TOKENS, thoughts=1151, content=45, error=—
- arm=current run=8: rawBodyBytes=8081, finish=MAX_TOKENS, thoughts=1148, content=48, error=—
- arm=current run=9: rawBodyBytes=7871, finish=MAX_TOKENS, thoughts=1148, content=48, error=—
- arm=current run=10: rawBodyBytes=8988, finish=MAX_TOKENS, thoughts=1065, content=131, error=—
- arm=current run=11: rawBodyBytes=8046, finish=MAX_TOKENS, thoughts=1149, content=47, error=—
- arm=current run=12: rawBodyBytes=8853, finish=MAX_TOKENS, thoughts=1073, content=123, error=—
- arm=current run=13: rawBodyBytes=8746, finish=MAX_TOKENS, thoughts=1076, content=120, error=—
- arm=current run=14: rawBodyBytes=7940, finish=MAX_TOKENS, thoughts=1133, content=63, error=—
- arm=current run=15: rawBodyBytes=8164, finish=MAX_TOKENS, thoughts=1148, content=48, error=—
- arm=current run=16: rawBodyBytes=7690, finish=MAX_TOKENS, thoughts=1151, content=45, error=—
- arm=current run=17: rawBodyBytes=8839, finish=MAX_TOKENS, thoughts=1050, content=146, error=—
- arm=current run=18: rawBodyBytes=8416, finish=MAX_TOKENS, thoughts=1092, content=104, error=—
- arm=current run=19: rawBodyBytes=7487, finish=MAX_TOKENS, thoughts=1152, content=44, error=—
- arm=current run=20: rawBodyBytes=8255, finish=MAX_TOKENS, thoughts=1149, content=47, error=—

## Decision

- Current arm: **0/20**
- Minimal arm: **20/20**
- Threshold to keep Google on tarot: **≥19/20** in the winning arm
- Winning arm: **minimal**
