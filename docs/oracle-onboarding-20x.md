# Oracle onboarding 20× (sequential)

Gate: ≥19/20 parse success. Do not soften.

## Seat brands (synthesis where the brand is a synthesizer)

| brand | workload | parsed | pass | notes |
| --- | --- | ---: | --- | --- |
| Z.ai | synthesis | 20/20 | yes | prior pass |
| Moonshot AI | synthesis | 19/20 | yes | prior pass |
| xAI | reading | 20/20 | yes | prior pass |
| DeepSeek | synthesis | **20/20** | yes | after `effort:minimal` + ceiling 8000 |
| NVIDIA | synthesis | **20/20** | yes | after ceiling 4000 + one strict retry |
| Google | synthesis | 20/20 | yes | prior pass |
| Anthropic | synthesis | **20/20** | yes | brand-level thinking disabled (was reader-only 20/20) |

Prior DeepSeek/NVIDIA synthesis (unfixed): **12/20** and **15/20**.

## Deferred integrated readers (this pass)

| brand | workload | parsed | pass |
| --- | --- | ---: | --- |
| Meta | reading | 20/20 | yes |
| MiniMax | reading | 20/20 | yes |
| Mistral | reading | 20/20 | yes |
| NAVER | reading | 20/20 | yes |
| OpenAI | reading | 20/20 | yes |
| Cohere | reading | 20/20 | yes | new iching dedicated (Qwen retired) |

## Seer seats (verdict workload — integrated 12-reading panel, contrarian prompt)

| brand | workload | parsed | pass | notes |
| --- | --- | ---: | --- | --- |
| ByteDance | verdict | **20/20** | yes | NEW (CONTRARIAN seat, replaces retired Qwen). Probe: Seed 1.6 thinks by default (925 reasoning / 126 content tokens); oracle entry pins `reasoning:{enabled:false}` → 0 reasoning tokens, ~7s, finish=stop on all 20. Raw runs: `oracle-onboarding-bytedance.json`. |

Other seer seats (Moonshot AI, Google, xAI, NAVER, NVIDIA, DeepSeek, Anthropic,
OpenAI) reuse brands already gated above — no new pass required.

## Below 19/20

- (none after the DeepSeek/NVIDIA parameter fix)
