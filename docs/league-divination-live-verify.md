# League divination live verify

- Run: 2026-09-19T09-29-02-463Z
- Reader: Qwen / Qwen3.5 Flash (`openrouter:qwen3.5-flash`)
- Timeout: 12000ms, max tokens: 500
- Gate payload: compact chart pack, user 1357 chars (not a short prompt). codeVerdict=down

## 1. Sequential 20× gate

| parsed | pass (≥19/20) | mean latency | empty-200 trials | timeout trials |
| ---: | --- | ---: | ---: | ---: |
| 0/20 | NO | 7289ms | 0/20 | 0/20 |

Qwen 3.5 Flash failed **0/20**. No empty-200, no timeout. Every trial returned HTTP 200 with `finish=length` in ~7.3s (~$0.00036 / two attempts). Parse miss: `line_count`.

Failure mode (one raw dump after the gate): Flash wrote an English `Thinking Process:` block into `message.content` (0 hidden reasoning tokens, 500/500 visible). 19 lines, truncated mid-plan, and the ban-list recitation included `시세`. The 4–5 line lock never fired. Different from the August layer-1 total failures (240s/0 tokens, then 158s/0 tokens) — this sibling answers, but not in the seat format.

Replacement: **NAVER HyperCLOVA X HCX-007** (`clova:hcx-007`). Brand already gated 20/20 on oracle reading. One live probe on this same compact pack: 3.7s, 4 Korean lines, no market ban, no CoT dump. MiniMax M3 is gated and under the $0.002 cap but empty-200’d on the same probe (the failure that retired Qwen from layer-1). Cohere Command A is the iching Qwen successor; it overshoots ~$0.009 and collapsed to one paragraph here. **Not swapped this pass.**

## 2. Twelve category rounds

| category | verdict | pick | conf | latency | cost | source | fallback | leak |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| sports | down | B | 1.000 | 7049ms | $0.000360 | fallback | yes | - |
| crypto | up | - | 1.000 | 8046ms | $0.000358 | fallback | yes | - |
| stocks | down | - | 0.556 | 7424ms | $0.000358 | fallback | yes | - |
| fx | up | - | 1.000 | 8858ms | $0.000359 | fallback | yes | - |
| gold_metals | down | - | 0.556 | 8058ms | $0.000359 | fallback | yes | - |
| index_etf | up | - | 0.556 | 8351ms | $0.000358 | fallback | yes | - |
| commodities_energy | down | - | 1.000 | 7374ms | $0.000358 | fallback | yes | - |
| politics_election | up | A | 0.556 | 6830ms | $0.000357 | fallback | yes | - |
| entertainment | down | B | 0.111 | 7020ms | $0.000360 | fallback | yes | - |
| memecoin | up | - | 0.556 | 7835ms | $0.000358 | fallback | yes | - |
| real_estate | up | - | 1.000 | 7526ms | $0.000359 | fallback | yes | - |
| macro_econ | up | - | 1.000 | 7001ms | $0.000358 | fallback | yes | - |

Verdict distribution: **7 up / 5 down**. Not a 12-up or 12-down sweep.

Fallback sentence fired: **12/12**. Market-language leak past parser (ban list or extra eye words): **0/12**.

Eye check: every stored rationale is the five-line code fallback (육효 본괘 / 타로 결과 / 룬 미래 / 택일 일진 / 코드가 합한 방향). Qwen never cleared the parser, so nothing it wrote (including the `시세` in its CoT dump) reached the stored row.

### Rationales

#### sports

```
육효 본괘 遯·용신 官鬼는 월령 死이다.
타로 결과 패는 King of Swords 역방향이다.
룬 미래는 Gebo 정방향이다.
택일 일진 丙申를 용신 甲(wood)에 읽는다.
코드가 합한 방향은 응효(B)이다.
```

#### crypto

```
육효 본괘 睽·용신 妻财는 월령 旺이다.
타로 결과 패는 Ten of Cups 역방향이다.
룬 미래는 Othala 역방향이다.
택일 일진 丙申를 용신 壬(water)에 읽는다.
코드가 합한 방향은 강·길 쪽이다.
```

#### stocks

```
육효 본괘 坎·용신 妻财는 월령 死이다.
타로 결과 패는 King of Wands 역방향이다.
룬 미래는 Ehwaz 역방향이다.
택일 일진 丙申를 용신 庚(metal)에 읽는다.
코드가 합한 방향은 약·흉 쪽이다.
```

#### fx

```
육효 본괘 無妄·용신 妻财는 월령 休이다.
타로 결과 패는 Five of Cups 정방향이다.
룬 미래는 Jera 정방향이다.
택일 일진 丙申를 용신 辛(metal)에 읽는다.
코드가 합한 방향은 강·길 쪽이다.
```

#### gold_metals

```
육효 본괘 坎·용신 妻财는 월령 死이다.
타로 결과 패는 Five of Swords 정방향이다.
룬 미래는 Ingwaz 정방향이다.
택일 일진 丙申를 용신 庚(metal)에 읽는다.
코드가 합한 방향은 약·흉 쪽이다.
```

#### index_etf

```
육효 본괘 大壯·용신 妻财는 월령 相이다.
타로 결과 패는 Queen of Wands 정방향이다.
룬 미래는 Ansuz 역방향이다.
택일 일진 丙申를 용신 戊(earth)에 읽는다.
코드가 합한 방향은 강·길 쪽이다.
```

#### commodities_energy

```
육효 본괘 坎·용신 妻财는 월령 死이다.
타로 결과 패는 Nine of Swords 정방향이다.
룬 미래는 Ingwaz 정방향이다.
택일 일진 丙申를 용신 丙(fire)에 읽는다.
코드가 합한 방향은 약·흉 쪽이다.
```

#### politics_election

```
육효 본괘 坎·용신 官鬼는 월령 休이다.
타로 결과 패는 Ace of Swords 정방향이다.
룬 미래는 Tiwaz 정방향이다.
택일 일진 丙申를 용신 丁(fire)에 읽는다.
코드가 합한 방향은 세효(A)이다.
```

#### entertainment

```
육효 본괘 井·용신 子孙는 월령 休이다.
타로 결과 패는 Queen of Swords 역방향이다.
룬 미래는 Nauthiz 정방향이다.
택일 일진 丙申를 용신 乙(wood)에 읽는다.
코드가 합한 방향은 응효(B)이다.
```

#### memecoin

```
육효 본괘 既濟·용신 妻财는 월령 相이다.
타로 결과 패는 Six of Swords 역방향이다.
룬 미래는 Fehu 역방향이다.
택일 일진 丙申를 용신 癸(water)에 읽는다.
코드가 합한 방향은 강·길 쪽이다.
```

#### real_estate

```
육효 본괘 歸妹·용신 父母는 월령 休이다.
타로 결과 패는 The Hierophant 역방향이다.
룬 미래는 Algiz 정방향이다.
택일 일진 丙申를 용신 己(earth)에 읽는다.
코드가 합한 방향은 강·길 쪽이다.
```

#### macro_econ

```
육효 본괘 咸·용신 父母는 월령 休이다.
타로 결과 패는 The High Priestess 역방향이다.
룬 미래는 Sowilo 정방향이다.
택일 일진 丙申를 용신 戊(earth)에 읽는다.
코드가 합한 방향은 강·길 쪽이다.
```

## 3. Cache E2E

- Table: reachable (table reachable)
- Second call site: `readLeagueDivinationLive` vs first `readLeagueDivination` + raw row
- Result: **identical stored row** — sameRationale=true sameDraw=true sameVerdict=true stored=true
