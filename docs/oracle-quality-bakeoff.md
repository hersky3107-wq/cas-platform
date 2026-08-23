# Oracle layer-1 quality bakeoff (v2 measurement)

Defects fixed before this run:
1. Reason codes carry locale labels in ai_payload (e.g. peer_dominant → 비견).
2. Machine-code leakage in narrative/one_line disqualifies a reader seat.
3. Phase ties must be reported as ties (prompt rule); scored mechanically.

---

# Oracle layer-1 quality bakeoff — saju

Fixed setup — only the reader model varies. Measurement fixes: labelled reason codes, machine-code leakage penalty, phase-tie rule.

- **Prompt version:** `layer1-v2`
- **System:** saju
- **Locale:** ko
- **Question:** 올해 일의 방향을 어떻게 잡아야 하는가?
- **As-of date:** 2026-08-23
- **Birth profile:** 1988-11-23 04:17:00 (Asia/Seoul), sex=F
- **Phase tie in payload:** yes (must report tie)
- **Runs per brand:** 2
- **Session id:** `c3ccbfa4-58fc-4160-a0ff-c5354e375089`

## Raw outputs

| brand | run | narrative | one_line | direction | focus | axis_emphasis | content tokens | ms | cost_usd |
| --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| Moonshot AI | 1 | 올해는 비견이 주도하는 흐름 속에서 물의 기운이 절반을 차지하며, 추진과 유지가 정확히 균형을 이루는 시기입니다. 혼자서 모든 것을 결정하기보다는 동료나 파트너와의 협력 관계를 점검하며 기존의 틀을 다지는 데 집중하세요. 새로운 확장보다는 현재의 자원을 재배치하고, 관계 속에서 실질적인 안정을 찾는 것이 올해 일의 핵심 방향입니다. 급하게 나아가려 하기보다는 주변과 보조를 맞추며 내실을 다지는 시기로 삼으세요. | 혼자 앞서가기보다 동료와 함께 기존 기반을 다지는 해 | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | 295 | 11408 | 0.006774 |
| Moonshot AI | 2 | 올해는 대운·세운이 나아가기와 머무르기가 정확히 반반으로 맞선 해입니다. 사주 네 기둥의 기운은 물이 절반을 차지하고 금이 비어 있어, 흐름은 깊은데 결실을 맺는 힘이 약합니다. 비견이 드러난 지금은 혼자 속도를 내기보다 같은 길을 가는 사람들과 보조를 맞출 때 일이 굳어집니다. 방향은 새로 벌이기보다 이미 잡은 일을 다듬고, 상반기에 판을 확인한 뒤 하반기에 밀어붙이는 식으로 잡으세요. | 물기운 깊은 해, 혼자 달리지 말고 동료와 보조를 맞춰 기존 일을 다듬으 | hold | work | saju.tengods.peer_dominant, water, metal, hold | 272 | 11666 | 0.004315 |
| DeepSeek | 1 | 사주 네 기둥에서 물이 절반을 차지해 유연함과 직관이 돋보이고, 그다음으로 흙이 자리 잡아 현실 감각과 안정성을 더해줍니다. 비견의 기운으로 주도력과 경쟁심이 강하지만, 대운·세운에서는 진취와 유지가 똑같은 비중이라 급한 추진보다 때를 살피는 균형이 중요합니다. 일의 방향은 물처럼 흐름을 타며 흙처럼 기반을 다지는 쪽으로 잡고, 주도권을 쥐되 혼자 치고나가기보다 주변과 호흡을 맞추세요. 성과를 서두르지 않고 꾸준히 쌓아가는 전략이 올해 당신을 지킵니다. | 물의 유연함과 흙의 안정감으로 진취와 유지 사이 균형을 잡는 한 해 | hold | work | water, earth, control, advance, hold | 276 | 42714 | 0.001219 |
| DeepSeek | 2 | 올해 당신의 일 방향은 비견(동료)의 협력 에너지와 사주 네 기둥에서 50%로 가장 강한 물의 유연함을 바탕으로 합니다. 그러나 대운·세운에서는 전진과 유지의 기운이 50% 동률로 팽팽히 맞서고 있어, 무리한 추진보다 현재 역할과 관계망을 공고히 다지는 전략이 유리합니다. 성급한 변화는 흐트러짐을 부르므로, 동료들과의 네트워크를 활용하며 내실을 쌓는 방향으로 중심을 잡으십시오. | 비견과 물의 유연 속 전진-유지 티격, 올해는 유지하며 준비하라 | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | 257 | 68464 | 0.001462 |
| Z.ai | 1 | 올해 일의 방향은 '전진'과 '유지'가 50 대 50으로 팽팽한 시기입니다. 무리하게 새 국면을 열기보다 현재 자리를 굳히는 것이 유리합니다. 수(水) 기운이 50으로 가장 강해 유연함과 흐름이 중요하며, 토(土)가 25로 이를 받쳐 기반을 다질 조건은 갖춰져 있습니다. 비견 기운이 작용해 동료나 경쟁자의 영향력이 크므로, 혼자 돌진하기보다 비슷한 위치에 있는 사람들과 관계를 조율하며 실속을 쌓는 것이 핵심입니다. | 전진과 유지가 팽팽한 해, 비견과 수 기운을 활용해 자리를 다져라. | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | 286 | 11244 | 0.000756 |
| Z.ai | 2 | 올해 일의 방향은 전진(50)과 유지(50)가 팽팽하게 맞선 시기로, 섣불리 확장하기보다 현재 자리를 공고히 하는 것이 유리합니다. 비견이 강하게 작용해 동료나 경쟁자의 영향이 크므로 무리한 개척은 부담이 될 수 있습니다. 수(水) 기운이 절반을 차지해 상황의 흐름을 읽고 유연하게 대응하는 힘이 충분하며, 드라이브(28.6)와 통제력(27.1)이 균형을 이루어 스스로 방향을 설정하는 능력은 갖춰져 있습니다. 대운·세운이 전환점에 있으니 기초를 다지며 다음 국면을 준비하십시오. | 전진과 유지가 맞선 해, 비견 아래 현 위치에서 기반을 다지세요. | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | 317 | 13441 | 0.001039 |
| Meta | 1 | 올해는 대운과 세운의 영향으로 발전과 유지의 균형이 중요한 해입니다. 물의 요소가 강해 새로운 도전에 대비해야 하며, 비견의 영향으로 주변과의 조율이 필요합니다. 일의 방향은 현재 상태를 유지하면서도 새로운 기회를 모색하는 '보합' 전략이 적합합니다. | 올해는 일의 방향을 유지하되 새로운 기회를 모색하세요. | hold | work | saju.phase.daewoon_sewoon, saju.tengods.peer_dominant, saju.elements.four_pillars | 140 | 1924 | 0.000400 |
| Meta | 2 | 올해는 대운과 세운의 영향으로 발전과 유지의 균형이 중요한 해입니다. 물의 요소가 강해 흐름에 유연하게 대처하는 것이 필요하며, 비견의 영향으로 자기 관리를 잘해야 합니다. 일의 방향은 큰 변화를 추구하기보다는 현재 상황을 유지하면서 점진적으로 발전시키는 것이 좋습니다. | 올해는 유지와 발전의 균형을 맞추며 일의 흐름에 유연하게 대처해야 합니다 | hold | work | saju.phase.daewoon_sewoon, saju.tengods.peer_dominant, saju.elements.water | 150 | 2071 | 0.000277 |
| MiniMax | 1 | 올해의 일운은 물 기운이 절반을 차지해 지적이고 유동적인 일에서의 역량이 강하게 부각됩니다. 흙 기운이 4분의 1 수준으로 이를 받쳐 주어 일정 부분의 안정감도 함께하지만, 금 기운이 비어 있어 결실을 재빨리 확정짓기보다 흐름을 따라가는 전략이 현실적입니다. 대운과 세운이 맞물린 올해는 전진과 유지의 기운이 정확히 반반으로 나란히 섰습니다. 이는 새 결단을 단행하기보다 현재의 발판을 점검하고 단단히 다지는 시점이 자연스럽다는 뜻입니다. 비견의 기운은 독립적 판단과 자기 주도성을 부각시키므로, 함께 달리는 협력자보다는 본인만의 영역을 조용히 구축해나가는 방향이 올해 일의 흐름과 어긋나지 않습니다. 물의 통찰과 흙의 실행을 잇되, 무리한 확장은 삼가고 현재의 위치를 확인하는 것이 핵심입니다. | 전진과 유지가 반반, 독립적 영역을 다지는 해 | hold | work | water, earth, advance, hold, saju.tengods.peer_dominant | 274 | 24158 | 0.002860 |
| MiniMax | 2 | 물 기운이 절반(50)을 차지해 유연하게 흐르려는 흐름이 강합니다. 추진력(28.6)과 주도성(27.1)이 함께 높아 스스로 방향을 잡고 움직이려 하지만, 안정성(11.4)과 성찰은 거의 없어 내면의 닻이 약합니다. 대운·세운의 시기적 특성상 진전과 유지가 반반(50·50)으로 묶여, 한쪽으로 과도하게 치우치기보다 지켜보며 조율하는 쪽이 맞습니다. 비견의 기운이 깔려 동료와의 경쟁을 견주기보다 자기 주도로 실적을 쌓는 것이 올해 일의 방향으로 어울립니다. | 물 위에서 주도적으로 밀되, 굳이 흔들지 않고 흐름을 따라잡는 방향 | hold | work | water, earth, drive, control, stability, saju.tengods.peer_dominant, saju.phase.daewoon_sewoon, saju.elements.four_pillars | 232 | 12640 | 0.001413 |
| OpenAI | 1 | 올해 일은 확장과 유지가 같은 비중이므로, 무리한 전환보다 현재 기반을 지키며 선택적으로 새 역할을 넓히는 방향이 맞습니다. 비견의 기운은 동료·동업자와의 경쟁과 협업을 함께 뜻하니, 독주보다 역할과 성과 기준을 분명히 하세요. 수 기운이 강하고 토가 받쳐 주므로 정보·기획·조율 능력을 실무 성과로 묶되, 금 기운의 부재를 보완할 계약·정산·문서 관리는 철저히 하세요. | 기반은 지키고, 협업의 기준을 세워 선별적으로 확장하세요. | hold | work | saju.tengods.peer_dominant, water, earth, advance, hold | 198 | 4222 | 0.003906 |
| OpenAI | 2 | 올해 일은 밀어붙이는 확장과 기존 기반을 지키는 선택이 같은 힘으로 맞섭니다. 대운·세운의 흐름상 성급한 전환보다, 비견의 협업·동료 경쟁을 활용해 역할과 기준을 분명히 하는 방향이 좋습니다. 사주 네 기둥에서 수 기운이 강하므로 정보, 기획, 분석, 조율처럼 흐름을 읽는 일에 집중하고, 금 기운의 빈자리는 마감·계약·수익 기준을 문서화해 보완하세요. | 확장과 유지의 균형 속에서, 협업 기준을 세운 기획형 일을 택하세요. | hold | work | saju.tengods.peer_dominant, water, metal, hold, advance, saju.phase.daewoon_sewoon | 202 | 3488 | 0.003954 |
| Google | 1 | {"narrative":"비견의 강한 주체성과 27.1%의 제어력, 그리고 사주 네 기둥에서 드러나는 수(水) 기운 50%의 깊은 |  | — | — |  | 45 | 8135 | 0.001561 |
| Google | 2 | {"narrative": "올해 일의 방향은 대운·세운의 흐름 속에서 나아감과 지킴의 기울기가 50대 50으로 팽팽하게 동률을 이루 |  | — | — |  | 47 | 7486 | 0.001576 |
| xAI | 1 | 올해 일의 방향은 비견의 강한 작용과 사주 네 기둥의 전체 구조, 대운·세운의 흐름을 동시에 고려해야 합니다. 전진과 유지가 정확히 50으로 맞서 있는 상황이므로 유지에 중심을 두고 안정적으로 일을 이어가는 것이 바람직합니다. 물의 기운이 두드러지는 가운데 토의 지지까지 받는 흐름을 활용해 유연하면서도 흔들리지 않는 태도로 접근하세요. | 유지 중심으로 안정적 방향을 설정하라 | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | 181 | 8493 | 0.001655 |
| xAI | 2 | 비견이 지배적인 사주 네 기둥과 대운·세운의 전진 50 유지 50 동점 상황에서 올해 일의 방향은 물 50 흙 25의 기운을 활용해 안정적으로 유지하며 동료 관계를 중심으로 차분히 나아가야 합니다. 전진과 유지가 맞서는 이 시기에는 무리한 추진보다 기존 기반을 다지는 것이 적합합니다. | 비견·사주 네 기둥·대운 세운 동점 속 유지로 방향 잡기 | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | 178 | 8938 | 0.001648 |
| Mistral | 1 | 비견의 기질로 대운·세운이 균형을 이룰 때, 물의 에너지를 활용해 일에서 안정과 전진을 동시에 추구하세요. | 물의 흐름 따라 안정과 전진 동시 추구 | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | 124 | 2270 | 0.002144 |
| Mistral | 2 | 물(水) 에너지가 강하고, 비견의 성향으로 동기부여가 높으며, 대운·세운의 균형에서 전진과 유지의 조화를 이뤄야 한다. 일에서 안정적으로 추진력과 협력을 조화시켜라. | 물 에너지와 비견으로 협력과 추진력 균형 | hold | work | saju.phase.daewoon_sewoon, saju.tengods.peer_dominant, saju.elements.four_pillars | 145 | 3499 | 0.002301 |
| NAVER | 1 | 올해는 물(水) 기운이 강하게 작용하며 비견의 영향으로 독립적이고 주도적인 자세를 취할 필요가 있습니다. 사주의 네 기둥을 고려하여 안정성을 유지하면서 새로운 기회를 탐색하세요. | 독립적 태도로 기회 탐색 및 안정성 강화 필요 | advance | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | — | 2370 | — |
| NAVER | 2 | 올해는 당신의 사주와 대운이 결합하여 강한 추진력을 발휘할 시기입니다. 비견의 영향으로 독립적이고 주도적인 자세를 취하며 일을 추진하는 것이 좋습니다. 특히 물 요소가 강하게 작용하므로 유연성과 적응력이 중요한 역할을 할 것입니다. | 독립적 추진과 유연한 대응을 통해 올해의 목표를 달성하세요. | advance | work | 비견, 사주 네 기둥, 대운·세운 | — | 2359 | — |
| NVIDIA | 1 | 비견이 강해 자기 주도력이 높고, 물 기운이 50%로 흐름을 타며, 대운·세운이 전진과 유지를 동시에 가리키니 올해는 무리한 확장보다 현상 유지를 기반으로 단계적 성장을 도모하세요. | 자기 주도력과 물 기운, 대운·세운의 균형으로 안정적 성장을 추구하세요. | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | 166 | 3308 | 0.002432 |
| NVIDIA | 2 | 올해는 물 기운이 50으로 강하게 흐르고 흙 25이 이를 받쳐주며, 비견의 주도적 성향이 드라이브 28.6과 컨트롤 27.1로 드러납니다. 대운·세운이 전진 50과 머묾 50으로 균형을 이루고 있어, 무리한 확장보다는 기존 기반을 다지고 안정적인 흐름을 유지하는 방향이 적절합니다. | 물·흙 조화 속 비견 주도력, 전진과 머묾 균형으로 기반 다지기 | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon | 207 | 6242 | 0.002722 |
| Anthropic | 1 | 올해 사주는 나아감과 멈춤이 정확히 50대50으로 팽팽하게 맞서는 시기입니다. 비견 기운이 두드러져 스스로의 힘과 주도권을 앞세우려는 마음이 강하지만, 물 기운이 전체의 절반을 차지할 만큼 압도적이어서 감정과 상황의 흐름을 무시하고 밀어붙이기엔 위험이 큽니다. 추진력과 통제력이 비슷하게 높은 만큼 성급한 확장보다는 현재 자리를 다지며 대운·세운의 흐름이 한쪽으로 기울 때까지 관망하는 편이 안전합니다. 무리한 결단보다 내실을 채우는 한 해로 삼으세요. | 전진과 정지가 팽팽한 해, 비견의 추진력을 억누르고 내실을 다질 때 | hold | work | saju.tengods.peer_dominant, saju.elements.four_pillars, saju.phase.daewoon_sewoon, water, advance, hold | 623 | 9647 | 0.008550 |
| Anthropic | 2 | {"narrative":"비견의 기운이 강하게 드러나 스스로의 힘으로 밀고 나가려는 의지가 뚜렷하지만, 사주 전반에 물의 기운이 짙게 흘러 유연하게 상황을 살 |  | — | — |  | 1200 | 14119 | 0.014320 |

## Mechanical scores (per brand)

### Moonshot AI

- **Payload grounding:** 7 — 관계, 금, 대운·세운, 비견, 사주 네 기둥, 안정, 추진
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 25%
- **Tie handling:** reported
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 231/218 chars (target 300–500)
- **Cost (2 runs):** $0.011089

### DeepSeek

- **Payload grounding:** 8 — 50, 관계, 대운·세운, 비견, 사주 네 기둥, 안정, 안정성, 추진
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 42%
- **Tie handling:** reported
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 255/212 chars (target 300–500)
- **Cost (2 runs):** $0.002680

### Z.ai

- **Payload grounding:** 15 — 1, 25, 27, 27.1, 28.6, 50, 土, 水, 관계, 대운·세운, 비견, 수, 조율, 토, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 13%
- **Tie handling:** reported
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 233/268 chars (target 300–500)
- **Cost (2 runs):** $0.001795

### Meta

- **Payload grounding:** 2 — 비견, 조율
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 67%
- **Tie handling:** reported
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 140/151 chars (target 300–500)
- **Cost (2 runs):** $0.000677

### MiniMax

- **Payload grounding:** 17 — 1, 11, 11.4, 27, 27.1, 28.6, 50, 금, 내면, 대운·세운, 비견, 성찰, 안정, 안정성, 조율, 추진, 추진력
- **Fabrication:** number:4; pillar:일운
- **Machine-code leakage:** (none)
- **Genericness:** 33%
- **Tie handling:** reported
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 389/256 chars (target 300–500)
- **Cost (2 runs):** $0.004273

### OpenAI

- **Payload grounding:** 7 — 금, 대운·세운, 비견, 사주 네 기둥, 수, 조율, 토
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 33%
- **Tie handling:** missed
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 207/197 chars (target 300–500)
- **Cost (2 runs):** $0.007860

### Google

- **Payload grounding:** 0 — (none)
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 100%
- **Tie handling:** missed
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=differ; focus=differ
- **Length:** 0/0 chars (target 300–500)
- **Cost (2 runs):** $0.003138

### xAI

- **Payload grounding:** 9 — 25, 50, 관계, 대운·세운, 비견, 사주 네 기둥, 안정, 추진, 토
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 0%
- **Tie handling:** reported
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 188/159 chars (target 300–500)
- **Cost (2 runs):** $0.003302

### Mistral

- **Payload grounding:** 6 — 水, 대운·세운, 비견, 안정, 추진, 추진력
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 0%
- **Tie handling:** reported
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 59/92 chars (target 300–500)
- **Cost (2 runs):** $0.004445

### NAVER

- **Payload grounding:** 7 — 水, 비견, 안정, 안정성, 추진, 추진력, 탐색
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 17%
- **Tie handling:** missed
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 99/129 chars (target 300–500)
- **Cost (2 runs):** $0.000000

### NVIDIA

- **Payload grounding:** 8 — 25, 27, 27.1, 28.6, 50, 대운·세운, 비견, 안정
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 0%
- **Tie handling:** reported
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 101/157 chars (target 300–500)
- **Cost (2 runs):** $0.005154

### Anthropic

- **Payload grounding:** 6 — 50, 대운·세운, 비견, 추진, 추진력, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 25%
- **Tie handling:** reported
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=differ; focus=differ
- **Length:** 253/0 chars (target 300–500)
- **Cost (2 runs):** $0.022870

## Ranking (eligible first; fabrication ↑, grounding ↓)

| rank | brand | fab | code leak | grounding | generic % | tie | length | dir/focus | cost_usd | seat |
| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| 1 | Z.ai | 0 | 0 | 15 | 13 | reported | 233/268 | yes/yes | 0.001795 | ok |
| 2 | xAI | 0 | 0 | 9 | 0 | reported | 188/159 | yes/yes | 0.003302 | ok |
| 3 | DeepSeek | 0 | 0 | 8 | 42 | reported | 255/212 | yes/yes | 0.002680 | ok |
| 4 | NVIDIA | 0 | 0 | 8 | 0 | reported | 101/157 | yes/yes | 0.005154 | ok |
| 5 | Moonshot AI | 0 | 0 | 7 | 25 | reported | 231/218 | yes/yes | 0.011089 | ok |
| 6 | NAVER | 0 | 0 | 7 | 17 | missed | 99/129 | yes/yes | 0.000000 | ok |
| 7 | OpenAI | 0 | 0 | 7 | 33 | missed | 207/197 | yes/yes | 0.007860 | ok |
| 8 | Anthropic | 0 | 0 | 6 | 25 | reported | 253/0 | no/no | 0.022870 | ok |
| 9 | Mistral | 0 | 0 | 6 | 0 | reported | 59/92 | yes/yes | 0.004445 | ok |
| 10 | Meta | 0 | 0 | 2 | 67 | reported | 140/151 | yes/yes | 0.000677 | ok |
| 11 | Google | 0 | 0 | 0 | 100 | missed | 0/0 | no/no | 0.003138 | ok |
| 12 | MiniMax | 2 | 0 | 17 | 33 | reported | 389/256 | yes/yes | 0.004273 | ok |

## Frozen ai_payload

```json
{
  "runnerVersion": "1.0.0",
  "axesLayerVersion": "1.0.0",
  "kind": "personal",
  "locale": "ko",
  "readingScope": "question",
  "system": "saju",
  "engineVersion": "1.2.0",
  "traits": {
    "drive": 28.6,
    "stability": 11.4,
    "relation": 22.9,
    "control": 27.1,
    "exploration": 10,
    "reflection": 0
  },
  "elements": {
    "wood": 12.5,
    "fire": 12.5,
    "earth": 25,
    "metal": 0,
    "water": 50
  },
  "phase": {
    "advance": 50,
    "hold": 50,
    "release": 0
  },
  "confidence": {
    "traits": {
      "weight": 1,
      "basis": "direct"
    },
    "elements": {
      "weight": 1,
      "basis": "direct"
    },
    "phase": {
      "weight": 1,
      "basis": "direct",
      "timescale": "era"
    }
  },
  "reasons": {
    "traits": [
      {
        "code": "saju.tengods.peer_dominant",
        "label": "비견"
      }
    ],
    "elements": [
      {
        "code": "saju.elements.four_pillars",
        "label": "사주 네 기둥"
      }
    ],
    "phase": [
      {
        "code": "saju.phase.daewoon_sewoon",
        "label": "대운·세운"
      }
    ]
  },
  "unreadable": [],
  "context": {
    "asOfDate": "2026-08-23",
    "question": "올해 일의 방향을 어떻게 잡아야 하는가?"
  }
}
```

---

# Oracle layer-1 quality bakeoff — tarot

Fixed setup — only the reader model varies. Measurement fixes: labelled reason codes, machine-code leakage penalty, phase-tie rule.

- **Prompt version:** `layer1-v2`
- **System:** tarot
- **Locale:** ko
- **Question:** 올해 일의 방향을 어떻게 잡아야 하는가?
- **As-of date:** 2026-08-23
- **Birth profile:** 1988-11-23 04:17:00 (Asia/Seoul), sex=F
- **Phase tie in payload:** no
- **Runs per brand:** 2
- **Session id:** `5997e7b0-5973-4d97-bd74-56d44e80655a`

## Raw outputs

| brand | run | narrative | one_line | direction | focus | axis_emphasis | content tokens | ms | cost_usd |
| --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: |
| Moonshot AI | 1 | 올해 일의 방향은 새로운 확장보다 지금 손에 쥔 것을 다지는 쪽에 무게가 실립니다. 카드 성향상 유지 흐름이 앞선다는 신호가 뚜렷하고, 전진보다 현상을 굳히는 리듬이 두 배 가까이 높게 나타납니다. 내면을 보면 통제와 성찰이 강하게 작동하는 반면 관계 에너지는 낮아, 혼자 기준을 세우고 판을 정비할 때 힘이 붙는 해입니다. 불과 물의 기운이 함께 높아 추진력과 직관은 충분하지만, 흙이 비어 있어 발붙일 기반이 약합니다. 그러니 새 벌이기보다 기존 일의 구조를 단단히 하고, 결정은 혼자 숙고한 뒤 내리되 속도는 늦추는 것이 맞습니다. | 확장보다 유지—기존 일의 기반을 다지고 결정은 신중히 미루는 해 | hold | work | control, reflection, fire, water, hold | 324 | 13057 | 0.005926 |
| Moonshot AI | 2 | 올해 일의 방향은 카드 성향상 멈춤과 유지(66.7%)가 전진(33.3%)을 압도합니다. 지금은 새로운 것을 벌이기보다 기존의 것을 다지고 지켜내야 할 때입니다. 내면의 통제력(30.8)과 성찰(20)이 강하게 작동하므로, 혼자서 깊이 파고드는 전문성을 키우는 데 집중하세요. 불(33.3)과 물(33.3)의 기운이 공존해 열정과 직관이 교차하지만, 흙(0)이 비어 있어 실질적인 기반이 약합니다. 무리한 확장보다는 기존 프로젝트의 완성도를 높이고, 재정·인력 등 현실적인 뿌리를 먼저 튼튼히 하는 것이 길합니다. | 확장보다 유지, 깊이 파고들어 기반을 다지는 해 | hold | work | control, reflection, fire, water, hold, tarot.phase.card_character | 309 | 11337 | 0.004880 |
| DeepSeek | 1 | 지금은 새로운 도전보다 현재의 자리를 굳건히 지키는 것이 중요합니다. 통제력과 내면의 성찰이 조화를 이루며, 불과 물의 이중적 에너지가 열정과 직관을 동시에 요구합니다. 성급한 변화는 피하고, 차분히 상황을 장악하며 기회를 기다리십시오. 올해 일의 방향은 전진보다 유지와 내실 다지기에 있습니다. | 열정과 직관으로 현재 위치를 단단히 지키는 해. | hold | work | control, fire, water, hold | 172 | 27316 | 0.000864 |
| DeepSeek | 2 | 올해 당신의 일 방향은 신중한 통제와 내적 반성이 필요합니다. 카드 성향은 전진보다 현재 상태 유지를 강력히 권하며, 요소상 불과 물이 지배적이어서 열정과 직관이 중요합니다. 반면 땅 기운이 전혀 없어 현실적인 기반이 부족할 수 있으니, 급격한 변화보다는 계획을 다지며 앞으로 나아가야 할 때입니다. | 올해는 속도보다 방향을 다지는 해, 통제와 내적 반성으로 일을 안정시키세 | hold | work | control, reflection, fire, water, hold | 191 | 48605 | 0.001502 |
| Z.ai | 1 | 올해 일의 방향은 '지키며 다듬기'가 핵심입니다. 유지 성향이 66.7%로 압도적이어서 무리한 확장보다 현재 자리에서 뿌리를 깊게 내리는 것이 유리합니다. 통제력이 30.8%로 가장 높고 반성이 20%로 뒤따르니, 업무 과정의 체계와 기준을 정비하는 데 에너지를 쏟으세요. 불과 물이 각각 33.3%로 균형을 이루어 열정과 직관이 함께 작용하므로, 감각적 판단보다 검증된 절차를 신뢰하십시오. 인간관계 에너지가 6.7%로 낮으므로 외부 협업보다는 내부 역량 강화가 효과적입니다. | 현 위치에서 체계를 정비하고 뿌리를 깊이세요. | hold | work | tarot.traits.arcana_and_suit, tarot.traits.reversals_reflected, tarot.elements.suit_to_classical_to_oheng, tarot.phase.card_character | 332 | 11825 | 0.000652 |
| Z.ai | 2 | 올해 일의 방향은 '통제력(30.8)'을 중심으로 현재 자리를 굳건히 다지는 해입니다. 유지(66.7)가 전진(33.3)의 두 배로 압도적이니, 새 프로젝트보다 기존 업무의 완성도와 체계 정비가 우선입니다. 화(33.3)와 수(33.3)가 동등하게 강해 열정과 직관이 균형을 이루지만, 토(0)가 완전히 비어 있으니 땅을 잃지 않도록 실무적 기반과 루틴을 의식적으로 보완해야 합니다. 반성(20)이 탐구(15)보다 높으니 외부 확장보다 내부 점검에서 성과가 나옵니다. 다만 관계(6.7)가 가장 약하니 혼자 몰입하기보다 소통 채널을 의식적으로 열어두어야 일의 흐름이 막히지 않습니다. | 통제와 유지로 현 역량을 다지되, 토(土)의 기반과 관계를 보완하라. | hold | work | control, reflection, fire, water, earth, hold, relation | 358 | 13792 | 0.000803 |
| Meta | 1 | 올해는 '보류'가 강한 해이므로 새로운 시작보다는 현재 진행 중인 일에 집중하는 것이 좋습니다. 안정성이 높고, 통제력이 강해 일의 진행 상황을 잘 관리할 수 있습니다. 다만, 탐색과 성찰의 균형을 맞추어 새로운 기회를 놓치지 않도록 주의해야 합니다. | 올해는 현재 일에 집중하고 신중하게 진행하세요. | hold | work | phase.hold, traits.control, elements.fire | 118 | 1765 | 0.000298 |
| Meta | 2 | 올해는 일의 방향을 '유지'하는 것이 중요합니다. 안정성을 유지하고 현재의 진행 상황을 계속 이어나가는 것이 좋습니다. 현재의 추진력과 안정성이 높은 상태이므로, 새로운 시도보다는 현재의 업무에 집중하는 것이 효과적입니다. | 올해는 업무의 방향을 유지하며 현재의 진행 상황을 계속 이어나가세요. | hold | work | phase.hold, traits.stability, elements.fire | 125 | 1702 | 0.000259 |
| MiniMax | 1 | 올해 일의 방향은 '지켜쥠'에 가깝습니다. 진행 33.3보다 유지 66.7이 앞서는 카드 성향은, 올해를 '움직이는 해'가 아니라 '다지는 해'로 받아들이라는 뜻입니다. 통제 욕구가 가장 큰 축(30.8)인데 안정성은 14.2에 머물고 흙의 기운이 0이라는 점은, 의지만으로 틀을 세우려 하면 발판이 비어 있음을 일깨웁니다. 불(33.3)과 물(33.3)이 팽팽하게 맞서니, 추진력과 흐름 중 한쪽으로 기울이지 말고 두 결을 동시에 듣는 것이 방향을 흐트러지지 않게 합니다. 결론적으로, 결과를 재촉하기보다 한 템포를 붙잡고 흙의 자리를 먼저 채우는 쪽이 올해의 일에 가장 단단한 축을 만들어 줍니다. | 지켜쥠의 해—다지고, 흙의 자리를 먼저 채우라. | hold | work | phase.hold, phase.advance, traits.control, traits.stability, elements.earth, elements.fire, elements.water, tarot.phase.card_character, tarot.elements.suit_to_classical_to_oheng | 288 | 19761 | 0.002339 |
| MiniMax | 2 | 올해 일의 방향은 '다스리고 붙잡는 것'에 무게가 실립니다. 진행보다 유지 단계가 66.7%로 가장 높아, 무리한 확장보다 지금 위치를 다지는 흐름이 우세합니다. 통제 능력이 30.8%로 가장 두드러져 한 가지 방향으로 결집하고 불필요한 가지를 쳐내는 선택이 한 해를 좌우합니다. 불(33.3%)과 물(33.3%)이 동률로 작용 열기와 직관이 나란히 움직이니 속도와 감각 사이의 균형을 의식적으로 잡아야 합니다. 다만 흙(0%)이 비어 있어 실행 기반·체력·체제 같은 현실 토대가 약해질 수 있으니, 큰 그림보다 '지금 서 있는 땅'을 점검하고 채우는 순서가 안전합니다. | 지금은 벌리는 해가 아니라 다스리고 다지는 해, 통제와 균형으로 한 점에 | hold | work | traits.control, phase.hold, elements.fire, elements.water, elements.earth | 244 | 19021 | 0.002234 |
| OpenAI | 1 | 올해 일의 방향은 확장보다 ‘기반을 단단히 고정하는 일’에 두는 편이 좋습니다. 카드 성향에서 유지가 66.7%로 높고, 통제력 30.8과 성찰 20이 두드러집니다. 업무 범위를 급히 넓히기보다 기준·일정·품질을 정비하고, 이미 가진 책임을 체계화하세요. 불과 물이 함께 강하므로 추진력과 직관은 있으나, 토가 0인 만큼 실행 구조와 자원 배분을 의식적으로 보완해야 합니다. | 올해는 넓히기보다 체계를 세워, 흔들리지 않는 일의 기반을 만들 때입니다 | hold | work | control, reflection, earth, fire, water, hold, tarot.phase.card_character | 200 | 4388 | 0.004004 |
| OpenAI | 2 | 올해 일의 방향은 확장보다 ‘정비하며 주도권을 세우는 것’에 두는 편이 좋습니다. 유지가 66.7로 우세하고 통제가 30.8, 성찰이 20으로 높아, 새 판을 크게 벌이기보다 업무 기준·권한·일정을 재설계할 때 성과가 납니다. 불과 물이 각각 33.3으로 맞서므로 추진력과 직관은 충분하지만, 토가 0인 만큼 실행 기반과 예산·절차를 먼저 단단히 하세요. 아르카나·수트와 역위 반영은 서두른 결정보다 재점검의 가치를 강조합니다. | 올해는 확장보다 업무 기반을 정비해 주도권을 굳힐 때입니다. | hold | work | hold, control, reflection, fire, water, earth, tarot.traits.arcana_and_suit, tarot.traits.reversals_reflected | 234 | 3093 | 0.004412 |
| Google | 1 | {   "narrative": "올해 일의 방향은 무리한 확장보다 기반을 다지는 것에 집중해야 합니다. 카드 성향상 유지 흐름이 66.7%로 |  | — | — |  | 43 | 7218 | 0.001605 |
| Google | 2 | 내실 있게 관리하는 조율 능력이 핵심입니다. 불과 물 원소가 각각 33.3%로 대립하는 흐름 속에서 성급한 확장보다 내실을 다지는 자세 |  | — | — |  | 43 | 7875 | 0.001605 |
| xAI | 1 | 제어 능력이 30.8로 가장 두드러지고 성찰이 20으로 이를 뒷받침하는 가운데 카드 성향이 가리키는 유지 국면 66.7을 따라 올해 일의 방향은 새로운 추진보다 현재 균형을 지키는 데 집중해야 합니다. 불 33.3과 물 33.3의 요소가 맞물린 상황에서 제어와 성찰을 통해 안정적인 흐름을 이어가는 것이 적합합니다. | 제어와 성찰로 유지하며 일의 균형을 지켜라 | hold | work | traits.control, traits.reflection, phase.hold | 169 | 8027 | 0.001672 |
| xAI | 2 | 통제력 30.8을 바탕으로 불 33.3과 물 33.3이 균형을 이루는 가운데 유지 66.7의 기운이 올해 일의 방향을 안내합니다. 아르카나·수트의 역위 반영과 카드 성향을 통해 서두르지 않고 안정적으로 계획을 세우며 신중하게 접근해야 합니다. | 통제와 불·물 균형 속 유지로 일 방향 잡기 | hold | work | traits.control, elements.fire, elements.water, phase.hold | 153 | 11231 | 0.001633 |
| Mistral | 1 | 불과 물의 균형으로 안정적 유지가 필요하며, 통제력과 탐험심이 조화를 이룰 때 일의 방향이 명확해진다. | 불·물 균형로 안정 유지, 통제와 탐험 조화 | hold | work | tarot.phase.card_character, tarot.elements.suit_to_classical_to_oheng, tarot.traits.arcana_and_suit | 123 | 1918 | 0.002191 |
| Mistral | 2 | 불과 물의 균형으로 안정적 유지가 필요하며, 통제력과 성찰을 바탕으로 일의 방향을 잡으세요. | 불과 물의 균형으로 일의 안정 유지 | hold | work | tarot.phase.card_character, tarot.elements.suit_to_classical_to_oheng, tarot.traits.reversals_reflected | 112 | 3502 | 0.002109 |
| NAVER | 1 | 올해는 일을 추진하는 데 있어 안정성과 통제를 중시해야 합니다. 높은 통제력과 안정성 점수는 신중하고 체계적인 접근을 필요로 하며, 이는 특히 복잡한 상황에서 유리합니다. 또한, 물과 불 요소의 균형이 중요하며, 이를 통해 창의적 에너지와 실용성을 동시에 발휘할 수 있습니다. | 안정적이고 체계적으로 추진하되, 창의성과 실용성의 균형을 유지하라. | hold | work | tarot.traits.control, tarot.traits.stability, tarot.elements.fire, tarot.elements.water | — | 2773 | — |
| NAVER | 2 | 올해는 일을 추진하는 데 있어 안정성과 통제를 중시해야 합니다. 높은 통제력과 안정성 점수는 신중하고 체계적인 접근을 필요로 하며, 이는 특히 복잡한 상황에서 유리합니다. 또한, 물과 불 요소의 균형이 중요하며, 이를 통해 창의적 에너지와 실용성을 동시에 발휘할 수 있습니다. | 안정적이고 체계적으로 추진하되, 창의성과 실용성의 균형을 유지하라. | hold | work | tarot.traits.control, tarot.traits.stability, tarot.elements.fire, tarot.elements.water | — | 2666 | — |
| NVIDIA | 1 | 올해는 카드 성향이 ‘유지’ 쪽에 강하게 기울어 있어(유지 66.7%) 무리한 확장보다 기존 기반을 다지는 전략이 유리합니다. 아르카나·수트와 역위 반영이 보여주는 통제력(30.8)과 성찰(20)이 높아, 세부 계획을 치밀하게 짜고 실행 속도를 조절하는 것이 핵심이 됩니다. 불과 물이 동일하게 33.3%로 나타나 열정과 유연함의 균형을 잡으며, 나무(25%)와 금(8.4%)의 지원을 받아 안정적인 성과를 쌓아갈 수 있습니다. | 확장보다 내실 다지기, 통제·성찰로 일의 흐름을 유지하라 | hold | work | tarot.traits.arcana_and_suit, tarot.elements.suit_to_classical_to_oheng, tarot.phase.card_character | 243 | 5183 | 0.002624 |
| NVIDIA | 2 | 아르카나·수트와 역위 반영으로 드러난 강한 통제력(30.8)과 깊은 성찰(20)이 주도하며, 수트→사원소→오행 해석에서 불(33.3)과 물(33.3)이 균형을 이루고 나무(25)가 받쳐줍니다. 카드 성향상 유지 단계(66.7)가 우세해 새로운 확장보다 기존 기반을 다지는 것이 유리합니다. 따라서 올해는 무리한 추진보다 현재 프로젝트의 완성도와 내실 강화에 집중하세요. | 현 흐름을 유지하며 내실을 다져라 | hold | work | tarot.traits.arcana_and_suit, tarot.elements.suit_to_classical_to_oheng, tarot.phase.card_character | 240 | 6212 | 0.002080 |
| Anthropic | 1 | 통제 성향이 30.8로 두드러지고 성찰 지수도 20으로 뒷받침되어, 올해는 새로운 판을 벌이기보다 지금의 구조를 다지는 시기입니다. 흐름 지표에서 유지가 66.7로 전진 33.3을 크게 앞서니, 속도를 늦추고 내실을 점검하는 편이 유리합니다. 불과 물의 기운이 각각 33.3으로 팽팽히 맞서는 것도 조급한 변화보다 균형 잡힌 관리가 필요함을 보여줍니다. 일의 방향은 확장보다 다짐, 즉 이미 쥔 것을 단단히 굳히는 쪽으로 잡으시길 권합니다. | 통제력과 유지 흐름이 강하니 확장보다 내실 다지기가 답입니다. | hold | work | control, phase.hold, fire, water, reflection | 514 | 7588 | 0.007568 |
| Anthropic | 2 | 올해 흐름은 멈춤과 관망이 뚜렷합니다. 통제 성향이 두드러지게 강하게 작용하는 가운데, 불과 물의 기운이 팽팽히 맞서 있어 급하게 밀어붙이기보다 안정적인 관리와 점검이 우선입니다. 전진의 기운도 존재하지만 절반에 그쳐, 지금은 새로운 도전보다 기존의 것을 다지고 통제력을 발휘해 내실을 채우는 시기로 삼는 것이 적절합니다. | 통제력을 다지며 멈춤을 유지할 때, 무리한 전진보다 내실이 우선입니다. | hold | work | phase.hold, traits.control, elements.fire, elements.water | 607 | 7782 | 0.008498 |

## Mechanical scores (per brand)

### Moonshot AI

- **Payload grounding:** 16 — 0, 20, 30.8, 33, 33.3, 6.7, 66.7, 7, 8, 관계, 내면, 성찰, 추진, 추진력, 카드 성향, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 40%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 300/287 chars (target 300–500)
- **Cost (2 runs):** $0.010805

### DeepSeek

- **Payload grounding:** 5 — 내면, 성찰, 수, 카드 성향, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 38%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 165/167 chars (target 300–500)
- **Cost (2 runs):** $0.002366

### Z.ai

- **Payload grounding:** 15 — 0, 15, 20, 30.8, 33, 33.3, 6.7, 66.7, 7, 8, 관계, 수, 토, 통제, 화
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 10%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 267/326 chars (target 300–500)
- **Cost (2 runs):** $0.001455

### Meta

- **Payload grounding:** 8 — 성찰, 수, 안정, 안정성, 추진, 추진력, 탐색, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 33%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 140/124 chars (target 300–500)
- **Cost (2 runs):** $0.000558

### MiniMax

- **Payload grounding:** 17 — 0, 14, 14.2, 30.8, 33, 33.3, 6.7, 66.7, 7, 8, 수, 안정, 안정성, 추진, 추진력, 카드 성향, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 30%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 336/319 chars (target 300–500)
- **Cost (2 runs):** $0.004574

### OpenAI

- **Payload grounding:** 16 — 20, 30.8, 33, 33.3, 6.7, 66.7, 7, 8, 성찰, 아르카나·수트, 역위 반영, 추진, 추진력, 카드 성향, 토, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 38%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 209/239 chars (target 300–500)
- **Cost (2 runs):** $0.008416

### Google

- **Payload grounding:** 0 — (none)
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 100%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=differ; focus=differ
- **Length:** 0/0 chars (target 300–500)
- **Cost (2 runs):** $0.003210

### xAI

- **Payload grounding:** 13 — 20, 30.8, 33, 33.3, 6.7, 66.7, 성찰, 아르카나·수트, 안정, 역위 반영, 추진, 카드 성향, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 0%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 176/135 chars (target 300–500)
- **Cost (2 runs):** $0.003305

### Mistral

- **Payload grounding:** 3 — 성찰, 안정, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 0%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 57/51 chars (target 300–500)
- **Cost (2 runs):** $0.004301

### NAVER

- **Payload grounding:** 5 — 수, 안정, 안정성, 추진, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 0%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 154/154 chars (target 300–500)
- **Cost (2 runs):** $0.000000

### NVIDIA

- **Payload grounding:** 20 — 20, 25, 30.8, 33, 33.3, 6.7, 66.7, 7, 8, 8.4, 금, 성찰, 수, 수트→사원소→오행, 아르카나·수트, 안정, 역위 반영, 추진, 카드 성향, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 0%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 239/206 chars (target 300–500)
- **Cost (2 runs):** $0.004705

### Anthropic

- **Payload grounding:** 9 — 20, 30.8, 33, 33.3, 6.7, 66.7, 성찰, 안정, 통제
- **Fabrication:** (none)
- **Machine-code leakage:** (none)
- **Genericness:** 29%
- **Tie handling:** n/a
- **Locale:** Korean=yes; one_line ≤80=yes
- **Run consistency:** direction=match; focus=match
- **Length:** 246/180 chars (target 300–500)
- **Cost (2 runs):** $0.016066

## Ranking (eligible first; fabrication ↑, grounding ↓)

| rank | brand | fab | code leak | grounding | generic % | tie | length | dir/focus | cost_usd | seat |
| ---: | --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: | --- |
| 1 | NVIDIA | 0 | 0 | 20 | 0 | n/a | 239/206 | yes/yes | 0.004705 | ok |
| 2 | MiniMax | 0 | 0 | 17 | 30 | n/a | 336/319 | yes/yes | 0.004574 | ok |
| 3 | Moonshot AI | 0 | 0 | 16 | 40 | n/a | 300/287 | yes/yes | 0.010805 | ok |
| 4 | OpenAI | 0 | 0 | 16 | 38 | n/a | 209/239 | yes/yes | 0.008416 | ok |
| 5 | Z.ai | 0 | 0 | 15 | 10 | n/a | 267/326 | yes/yes | 0.001455 | ok |
| 6 | xAI | 0 | 0 | 13 | 0 | n/a | 176/135 | yes/yes | 0.003305 | ok |
| 7 | Anthropic | 0 | 0 | 9 | 29 | n/a | 246/180 | yes/yes | 0.016066 | ok |
| 8 | Meta | 0 | 0 | 8 | 33 | n/a | 140/124 | yes/yes | 0.000558 | ok |
| 9 | DeepSeek | 0 | 0 | 5 | 38 | n/a | 165/167 | yes/yes | 0.002366 | ok |
| 10 | NAVER | 0 | 0 | 5 | 0 | n/a | 154/154 | yes/yes | 0.000000 | ok |
| 11 | Mistral | 0 | 0 | 3 | 0 | n/a | 57/51 | yes/yes | 0.004301 | ok |
| 12 | Google | 0 | 0 | 0 | 100 | n/a | 0/0 | no/no | 0.003210 | ok |

## Frozen ai_payload

```json
{
  "runnerVersion": "1.0.0",
  "axesLayerVersion": "1.0.0",
  "kind": "personal",
  "locale": "ko",
  "readingScope": "question",
  "system": "tarot",
  "engineVersion": "1.0.0",
  "traits": {
    "drive": 13.3,
    "stability": 14.2,
    "relation": 6.7,
    "control": 30.8,
    "exploration": 15,
    "reflection": 20
  },
  "elements": {
    "wood": 25,
    "fire": 33.3,
    "earth": 0,
    "metal": 8.4,
    "water": 33.3
  },
  "phase": {
    "advance": 33.3,
    "hold": 66.7,
    "release": 0
  },
  "confidence": {
    "traits": {
      "weight": 0.5,
      "basis": "derived"
    },
    "elements": {
      "weight": 0.5,
      "basis": "derived"
    },
    "phase": {
      "weight": 1,
      "basis": "direct",
      "timescale": "draw"
    }
  },
  "reasons": {
    "traits": [
      {
        "code": "tarot.traits.arcana_and_suit",
        "label": "아르카나·수트"
      },
      {
        "code": "tarot.traits.reversals_reflected",
        "label": "역위 반영"
      }
    ],
    "elements": [
      {
        "code": "tarot.elements.suit_to_classical_to_oheng",
        "label": "수트→사원소→오행"
      }
    ],
    "phase": [
      {
        "code": "tarot.phase.card_character",
        "label": "카드 성향"
      }
    ]
  },
  "unreadable": [],
  "context": {
    "asOfDate": "2026-08-23",
    "question": "올해 일의 방향을 어떻게 잡아야 하는가?"
  }
}
```

---

# Google tie-rule re-test (saju)

Payload phase tie: yes (advance=hold leading).
Google directions: (unparsed both runs — incomplete JSON).
Google tie handling (mechanical): missed — neither run produced parseable JSON.

Evidence from truncated raw output:
- Run 1 cut mid-narrative after mentioning 비견 / 제어력 / 수 50%.
- Run 2 cut mid-narrative after: "나아감과 지킴의 기울기가 50대 50으로 팽팽하게 동률을 이루…"

Verdict: the tie **prompt** appears to steer Google toward tie language (run 2 fragment), but the re-test **did not succeed** as a product outcome — both Google saju runs (and both tarot runs) truncated before valid JSON, so direction/tie cannot be scored. Truncation/reliability is now the Google blocker, not unilateral advance-picking.
