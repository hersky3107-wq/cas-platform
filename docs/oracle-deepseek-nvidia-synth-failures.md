# DeepSeek / NVIDIA synthesis 20× failure telemetry (pre-fix)

Source: `docs/oracle-onboarding-20x.json` (sequential synthesis workload).
Neither script stored the provider's full `usage` blob; the authoritative
fields we do have are `finish_reason`, `reasoning_tokens` / `content_tokens`
from the OpenRouter adapter error string and token split.

## DeepSeek (draw_based synthesizer) — 12/20

Failure mode: **truncation by hidden thinking**. `reasoning:null` on the
oracle entry stripped catalog `effort:minimal`, so the model spent the
entire 3000-token budget on thinking. Visible content was empty or a
truncated JSON fragment.

### Failed run 1
- finish_reason: `length`
- usage split: reasoning_tokens=**3000**/3000, content=empty (`textChars=0`)
- error: `HTTP 200 but message.content was empty (finish_reason=length, reasoning_tokens=3000/3000)`

### Failed run 2
- finish_reason: `length`
- usage split: reasoning_tokens=**3000**/3000, content=empty

### Failed run 4 (partial content, still fail)
- finish_reason: `length`
- usage split: reasoning=**2690**, content=**310** (JSON did not close)

### Successful run 5
- finish_reason: `stop`
- usage split: reasoning=**1321**, content=**393**

Fix applied: `reasoning: { effort: 'minimal' }` + ceiling **8000**.
Re-run: **20/20**.

## NVIDIA (east_asian synthesizer) — 15/20

Failure mode: **truncation**. Catalog already sent `effort:minimal`, but
synthesis still spent ~1700–1855 thinking tokens into a 2000 ceiling.

### Failed run 1
- finish_reason: `length`
- usage split: reasoning=**1743**, content=**257**

### Failed run 5 (from live log)
- finish_reason: `length`
- usage split: reasoning=**1629**, content=**371**

### Failed run 10
- finish_reason: `length`
- usage split: reasoning=**1855**, content=**145**

### Successful run 2
- finish_reason: `stop`
- usage split: reasoning=**1010**, content=**438**

Fix applied: keep `effort:minimal` + ceiling **4000** + the live adapter's one strict retry.
Re-run: **20/20**.
