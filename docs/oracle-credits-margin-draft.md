# Oracle credits vs measured cost (draft — not final prices)

Credit draft formula (updated):

```
credits = ORACLE_SESSION_BASE_CREDITS[kind] + 4 × readerCount + 4  // synthesizer
```

Personal base = 30. Owner credit-to-USD rate from Standard pack: **$19 / 400 credits = $0.0475 / credit**.

Measured \$ costs use per-brand means from family bakeoffs (ziwei/runes/astro/numerology + saju/tarot rows); Meta/MiniMax/Mistral/NAVER use prior smoke means. No new API calls for this table.

## Brand means used

| Brand | Mean \$ / call |
|-------|---------------:|
| Anthropic | 0.010212 |
| DeepSeek | 0.001360 |
| Google | 0.002973 |
| Meta | 0.000229 |
| MiniMax | 0.001529 |
| Mistral | 0.001944 |
| Moonshot AI | 0.005804 |
| NAVER | 0.000000 |
| NVIDIA | 0.003225 |
| OpenAI | 0.003918 |
| Z.ai | 0.000819 |
| xAI | 0.001643 |

## Single-system (family roster + family synthesizer)

At N=7 every family uses all eight eligible brands (5 seats + 2 overflow + synth), so measured cost converges.

| mode | system | N | measured \$ | credit draft | revenue @ \$0.0475 | margin \$ | margin % |
|------|--------|--:|------------:|-------------:|-------------------:|----------:|---------:|
| single | saju / ziwei / ninestar* / sukuyou* / name* | 3 | 0.012183 | 46 | 2.1850 | 2.1728 | 99.4% |
| single | east_asian family | 5 | 0.016768 | 54 | 2.5650 | 2.5482 | 99.3% |
| single | east_asian family | 7 | 0.029953 | 62 | 2.9450 | 2.9150 | 99.0% |
| single | tarot / runes / iching* | 3 | 0.009201 | 46 | 2.1850 | 2.1758 | 99.6% |
| single | draw_based family | 5 | 0.015823 | 54 | 2.5650 | 2.5492 | 99.4% |
| single | draw_based family | 7 | 0.029953 | 62 | 2.9450 | 2.9150 | 99.0% |
| single | astro | 3 | 0.011780 | 46 | 2.1850 | 2.1732 | 99.5% |
| single | astro | 5 | 0.022810 | 54 | 2.5650 | 2.5422 | 99.1% |
| single | astro | 7 | 0.029953 | 62 | 2.9450 | 2.9150 | 99.0% |
| single | prism* / numerology / tzolkin* | 3 | 0.018477 | 46 | 2.1850 | 2.1665 | 99.2% |
| single | self_ip family | 5 | 0.022810 | 54 | 2.5650 | 2.5422 | 99.1% |
| single | self_ip family | 7 | 0.029953 | 62 | 2.9450 | 2.9150 | 99.0% |

\* evidence-by-family inheritance.

## Integrated (combined): 12 × LAYER1_REGISTRY + OpenAI synthesizer

Measured layer-1+synth is fixed (~\$0.0376). `readerCount` still scales the **seer panel** credit line + synthesizer surcharge.

| mode | N (seer panel) | measured \$ | credit draft | revenue @ \$0.0475 | margin \$ | margin % |
|------|---------------:|------------:|-------------:|-------------------:|----------:|---------:|
| combined | 3 | 0.037572 | 46 | 2.1850 | 2.1474 | 98.3% |
| combined | 5 | 0.037572 | 54 | 2.5650 | 2.5274 | 98.5% |
| combined | 7 | 0.037572 | 62 | 2.9450 | 2.9074 | 98.7% |
| combined | 9 | 0.037572 | 70 | 3.3250 | 3.2874 | 98.9% |

**Note:** seer (layer-2 persona) API cost is not in `measured \$` — only layer-1 brands + synthesizer. Owner sets final prices from this draft.
