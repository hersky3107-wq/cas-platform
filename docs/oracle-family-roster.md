# Oracle family roster (applied)

Accepted from the family bakeoffs with three corrections (2026-08-23).
Source of truth: `lib/oracle/ai/family-roster.ts`.

## Resolved synthesizer per family

| Family | Synthesizer | Cite |
|--------|-------------|------|
| East-Asian calendrical | **OpenAI** | saju bakeoff rank #7 (0 fab); not on east_asian reader panel |
| Draw-based | **DeepSeek** | runes bakeoff rank #5 (0 fab); not on draw_based reader panel |
| Western chart | **Google** | astro bakeoff rank #6 (0 fab); OpenAI #8 excluded; not on western reader panel |
| Self-IP / number | **xAI** | numerology bakeoff rank #6 (0 real fab after label-evidence fix); not on self_ip reader panel |

Four distinct synthesizer brands. Astro does **not** use OpenAI as synth.

## Reader seats 1–5 (+ overflow 6–7 for N=7)

| Family | Systems | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|--------|---------|---|---|---|---|---|---|---|
| East-Asian | saju, ziwei, ninestar*, sukuyou*, name* | Z.ai | Moonshot AI | xAI | NVIDIA | DeepSeek | Anthropic | Google |
| Draw-based | tarot, runes, iching* | xAI | Google† | NVIDIA | Z.ai | Moonshot AI | OpenAI | Anthropic |
| Western chart | astro | Moonshot AI | DeepSeek | xAI | Z.ai | Anthropic | NVIDIA | OpenAI |
| Self-IP / number | prism*, numerology, tzolkin* | Moonshot AI | Z.ai | Anthropic | DeepSeek | Google | OpenAI | NVIDIA |

\* evidence-by-family (not evidence-by-system) — no system bakeoff; inherits family roster.  
† Google on draw seats only with `thinkingLevel: minimal` (see `docs/oracle-gemini-reliability.md`).

## Rules

- Single-system `readerCount` ∈ {3, 5, 7} only (reject 9).
- No duplicate brand within a session; synthesizer ∉ readers.
- New brands: sequential 20× gate ≥19/20 — `docs/oracle-model-onboarding.md`.
