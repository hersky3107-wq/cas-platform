# Oracle model onboarding

Permanent checks before any brand takes a layer-1 reader seat or a family synthesizer seat.

## Reasoning telemetry is not truth

**Cross-cutting finding (2026-08-23):** Gemini reported `reasoning: 0` in our cost telemetry while burning ~1150 `thoughtsTokenCount` into `maxOutputTokens`. Truncation looked like empty/short content with `finishReason: MAX_TOKENS`. Parallel smoke bursts hid the failure for weeks; sequential bakeoff runs exposed 0/20 parse until `thinkingLevel: minimal`.

**Rule:** `"reasoning 0"` in Oracle telemetry does **not** mean the model is not reasoning. Provider-specific thinking fields must be probed explicitly.

## Required onboarding gate (any new brand)

Before a brand may occupy a reader or synthesizer seat:

1. **Probe provider-specific thinking/reasoning fields** for the exact model id we will call (e.g. Gemini `usageMetadata.thoughtsTokenCount`, OpenRouter `reasoning_tokens`, Anthropic thinking blocks). Document which field is authoritative for that provider.
2. **Run the brand SEQUENTIALLY 20 times** against a frozen home-system `ai_payload` (same prompt version, same ceilings). Do **not** use parallel bursts for this gate — concurrency hid Gemini’s thinking-budget failure.
3. **Require ≥ 19/20 successful parses** (JSON parse + non-empty narrative) with a healthy finish reason (not length/MAX_TOKENS truncation). Report the raw count; do not soften it.
4. If the brand fails the gate because thinking consumes the completion budget, fix the **oracle-only** registry entry (thinking level / disable / ceiling) without changing league defaults, then re-run the sequential 20× gate.

## Related docs

- `docs/oracle-gemini-reliability.md` — Gemini 3.6 Flash thinking-budget case study
- `docs/oracle-quality-bakeoff-families.md` — family quality rankings
