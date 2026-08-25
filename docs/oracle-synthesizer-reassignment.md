# Oracle synthesizer reassignment (post synthesis bakeoff + spoiled re-runs)

Source: `docs/oracle-synthesis-bakeoff.md`, `docs/oracle-synthesis-rerun-spoiled.json`,
`docs/oracle-synthesis-numerology-bakeoff.md`.
OpenAI excluded from every synthesizer seat until it passes a clean synthesis gate
(numerology bakeoff ranked it #5 ok — still held out of seating this pass).

## Final assignments

| mode / family | synthesizer | cite | notes |
|---|---|---|---|
| **integrated** | **Z.ai** | synthesis integrated #1 (0 univ DQ) | seat-only; iching dedicated is Cohere (Qwen retired) |
| east_asian | **NVIDIA** | synthesis single #1 (0 univ DQ) | off east_asian reader panels |
| draw_based | **DeepSeek** | clean re-run single DQ=false, ground=121 | prior integrated runs were empty-200 flake |
| western_chart | **Moonshot AI** | synthesis single #3 (0 univ DQ) | NVIDIA already used by east_asian |
| self_ip | **Google** | numerology single-panel #4 (0 univ DQ) | single-mode evidence only; not cross-mode |

## Integrated invariant

LAYER1 dedicated brands (readers in every combined session): Moonshot, DeepSeek, Cohere,
Meta, MiniMax, OpenAI, Google, xAI, Mistral, NAVER, NVIDIA, Anthropic.

Z.ai is seat-only (`ORACLE_SEAT_ONLY_BRANDS`) for single-mode readers + integrated synth.
`RETIRED_BRANDS` = Qwen, Xiaomi MiMo — never a reader, synthesizer, or seat-only brand.

## Alternatives considered (DQ status)

### Single-panel evidence (saju)

| brand | prior bakeoff | clean re-run | usable as family synth? |
|---|---|---|---|
| NVIDIA | ok #1 | n/a | **yes → east_asian** |
| Anthropic | ok #2 | **DQ** (univ / parse fail) | no (thinking probe: see below) |
| Moonshot AI | ok #3 | n/a | **yes → western_chart** |
| DeepSeek | DQ (univ) | **DQ=false on single** | **yes → draw_based** |
| Z.ai | DQ (univ) | n/a | no for single families; **yes → integrated** (after LAYER1 remove) |
| Google | DQ (univ) on saju | n/a | see numerology |
| xAI | DQ (univ) | n/a | no |
| OpenAI | DQ (univ) | n/a | **excluded** |

### Numerology single-panel (self_ip)

| brand | rank | seat | usable? |
|---|---|---|---|
| Moonshot AI | #1 ok | collides with western synth | no |
| xAI | #2 ok | in self_ip readers at N≥5 | no |
| NVIDIA | #3 ok | east synth + self_ip reader | no |
| Google | #4 ok | free | **yes → self_ip** |
| OpenAI | #5 ok | policy exclusion | held |

### Integrated-panel evidence

| brand | prior bakeoff | usable as integrated synth? |
|---|---|---|
| Z.ai | ok #1 | **yes** after removing from LAYER1 readers |
| Moonshot / Google / xAI | ok #2–4 | collide with LAYER1 dedicated seats |
| others | DQ | no |
