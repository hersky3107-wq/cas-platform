# Oracle synthesizer reassignment (post synthesis bakeoff + spoiled re-runs)

Source: `docs/oracle-synthesis-bakeoff.md`, `docs/oracle-synthesis-rerun-spoiled.json`.
OpenAI excluded from every synthesizer seat until a clean pass.

## Final assignments

| mode / family | synthesizer | cite | notes |
|---|---|---|---|
| **integrated** | **Z.ai** | synthesis integrated #1 (0 univ DQ) | separate from single-panel ranking |
| east_asian | **NVIDIA** | synthesis single #1 (0 univ DQ) | off east_asian reader panels |
| draw_based | **DeepSeek** | clean re-run single DQ=false, ground=121 | prior integrated runs were empty-200 flake |
| western_chart | **Moonshot AI** | synthesis single #3 (0 univ DQ) | NVIDIA already used by east_asian |
| self_ip | **Google** | integrated #3; clean single pool exhausted | single was univ-conclusion DQ — best remaining |

## Alternatives considered (DQ status)

### Single-panel evidence

| brand | prior bakeoff | clean re-run | usable as family synth? |
|---|---|---|---|
| NVIDIA | ok #1 | n/a (clean) | **yes → east_asian** |
| Anthropic | ok #2 | **DQ** (univ conclusion / parse fail) | no |
| Moonshot AI | ok #3 | n/a (clean) | **yes → western_chart** |
| DeepSeek | DQ (univ) | **DQ=false on single** | **yes → draw_based** |
| Z.ai | DQ (univ) | n/a | no for single families; **yes → integrated** |
| Google | DQ (univ) | n/a | last resort → **self_ip** |
| xAI | DQ (univ) | n/a | no |
| OpenAI | DQ (univ) | n/a | **excluded everywhere** |

### Integrated-panel evidence

| brand | prior bakeoff | clean re-run | usable as integrated synth? |
|---|---|---|---|
| Z.ai | ok #1 | n/a | **yes → integrated** |
| Moonshot AI | ok #2 | n/a | held for western single |
| Google | ok #3 | n/a | held for self_ip |
| xAI | ok #4 | n/a | spare |
| DeepSeek | flake DQ | integrated still univ DQ on one run | not integrated primary |
| Anthropic | ceiling DQ | both runs parse-fail at 1200 | no |
| OpenAI | DQ (univ) | n/a | excluded |
| NVIDIA | DQ (univ) | n/a | held for east_asian single |
