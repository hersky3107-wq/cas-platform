# 억부 용신 distribution

N = 20,000 synthetic subjects (1950–2010, 10% unknown birth time, seed 0x454f4b42).
Threshold: 신약 ≤ 2 · 중화 3–4 · 신강 ≥ 5.
종격 판정불가: one 오행 ≥ ceil(chars × 5/8) and lead ≥ 2.

Cutoff comparison on this same sample (before picking 5/8):
- half + gap ≥ 2 (old): 24.69% 판정불가, of which 43.60% 토
- 5/8 + gap ≥ 2 (chosen): 6.31%
- half + gap ≥ 3: 7.69%
- 토-aware only (토 uses 5/8 and gap ≥ 3; others keep half + gap 2): 16.91%

| bucket | count | share |
| --- | ---: | ---: |
| 신약 | 4865 | 24.32% |
| 중화 | 7032 | 35.16% |
| 신강 | 6841 | 34.21% |
| 판정불가 | 1262 | 6.31% |
| error | 0 | 0.00% |

Unknown birth time: 1952 (9.76%). Of those, 판정불가 179 (9.17% of unknown-time charts).

Dominant element when 판정불가:
- earth: 649 (51.43%)
- water: 210 (16.64%)
- fire: 167 (13.23%)
- metal: 122 (9.67%)
- wood: 114 (9.03%)

판정불가 is 6.31% — within a rare-종격 band; cutoff can stay.
