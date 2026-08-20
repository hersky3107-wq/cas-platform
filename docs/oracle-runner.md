# ORACLE job runner

Code: `lib/oracle/runner/`. Tables: `supabase/migrations/20260815000001_oracle_rebuild.sql`
(see `docs/oracle-schema.md`). Layer 1 (the twelve per-system readings) can run live via `ORACLE_AI_MODE=live`.
Layer 2 (readers / verdicts) is still stubbed. The default is `stub` so tests and
local dev never spend tokens. Both adapters implement `OracleAiAdapter`; the
routes construct them through `createOracleAiAdapter()`.

## Why it is shaped this way

The full 12-system calculation benchmarks at ~8ms per subject, so it is **not** chunked: every
engine, the axis projection, and `computeConsensus` all run synchronously inside the create
request. Only AI calls are chunked, because those are the ones that stall for tens of seconds.

An advance call must never hold the HTTP connection while AI calls run — that is exactly what
breaks when a phone locks its screen mid-reading. So advance claims a lease, returns
immediately, and does the work in Next's `after()`.

## Routes

| Route | Method | Purpose |
|---|---|---|
| `/api/oracle/session` | POST | Create: charge once, compute everything, return a pollable session |
| `/api/oracle/session/[id]` | GET | Poll: read-only, zero credits, safe every 2s |
| `/api/oracle/session/[id]/advance` | POST | Run ONE chunk in the background, return the current status |
| `/api/cron/oracle-sweep` | GET | Every minute: pick up sessions whose worker died |

All four use `supabaseAdmin` and scope every query to the caller's `user_id`. A session owned by
someone else is reported as 404, not 403.

### Per-session PRISM input

Create accepts optional `sessionInputs.prism`:

```json
{
  "impulse": "ColorId",
  "need": "ColorId",
  "identity": "ColorId",
  "microCheck": [1, 2, 3, 4]
}
```

The three colors must be valid and distinct. `microCheck`, when present, is
exactly four integers from 1 to 5. Validation runs before any credit charge.
The normalized bag is stored on `oracle_job_sessions.session_inputs`, so each
reading retains its own PRISM state for later re-test delta comparisons.
MBTI remains on the profile because it is CORE.

If PRISM input is absent, PRISM is a 결번; colors are never fabricated from
the seed. `session_inputs` is a generic bag so future systems can add their
own top-level input without another migration.

## State machine

`next_action` is constrained by the migration to `compute | layer1 | layer2 | consensus`, which
predates this runner. **`consensus` is the finalize step** — where the spec says "finalize", the
column says `consensus`.

| status | next_action | who moves it | to |
|---|---|---|---|
| `computing` | `compute` | create (inline) | `layer1` / `layer1`, or `failed` / null |
| `layer1` | `layer1` | advance, 4 systems per chunk | `layer1` / `layer1` while systems remain, else `layer2` / `layer2` |
| `layer2` | `layer2` | advance, all N readers in one chunk | `layer2` / `consensus` |
| `layer2` | `consensus` | advance, finalize | `done` / null |
| `layer1`/`layer2` | any | advance, attempts exhausted | `partial` or `failed` / null |
| `done` / `partial` / `failed` | null | — | terminal; advance and sweep refuse to claim |

`computing` + `compute` is only observable if the create request died between inserting the row
and finishing the calculation. Compute is not resumable without the request context, so an
advance on that state closes the session out as `failed` and refunds.

12 systems at 4 per chunk plus one layer-2 chunk plus finalize is **5 advance calls** for a
healthy session.

## Lease and heartbeat contract

- **Claim.** A single conditional `UPDATE ... WHERE id = $1 AND (lease_until IS NULL OR
  lease_until < now) AND attempt_count = $read` sets `lease_until = now + 150s`, stamps
  `last_heartbeat_at`, and increments `attempt_count`. Zero rows updated means another worker
  holds it: the caller reports the current status and does no work.
- **In-flight renewal.** While parallel layer-1 units run, the runner refreshes
  `last_heartbeat_at` and extends `lease_until` every 20s so a slow chunk is not
  mistaken for dead before the sequential inserts finish.
- **Heartbeat.** Every completed unit stamps `last_heartbeat_at`, so the sweeper can tell a slow
  session from a dead one.
- **Release.** Every exit path from a chunk sets `lease_until = null`, including the
  unexpected-throw path (which deliberately does *not* refresh the heartbeat, so the sweeper
  retries on its next pass instead of a minute later).
- **Steal.** The sweeper looks for non-terminal sessions with `last_heartbeat_at` older than
  60s and a lease that is null or expired, then advances up to 20 per run.
- **Clock.** Lease and heartbeat timestamps are computed in the app process, not by SQL `now()`,
  because supabase-js cannot put an expression in an UPDATE. Meaningful app/DB clock skew would
  loosen the lease; the 150s window is wide enough to absorb ordinary drift.

`attempt_count` counts *consecutive fruitless* claims: any chunk that completes at least one
unit resets it to 0. Above `ORACLE_MAX_ATTEMPTS` (4) the session is closed out.

## Timeouts and 결번

Each stubbed AI unit gets 25s (`ORACLE_AI_UNIT_TIMEOUT_MS`). Live layer-1 units get
80s (`ORACLE_LAYER1_LIVE_TIMEOUT_MS`) so a reasoner can finish without outliving
the 150s lease (renewed every 20s while units are in flight). The runner races the
adapter either way; on expiry the row is written with `status='timeout'` and the
run **continues**.

A missing system is a 결번, not a failure. Three things produce one, and all three land in
`progress.failed`:

1. the computation produced no vote (no name on the profile, no per-session PRISM colours, an engine threw)
2. the AI unit timed out
3. the AI unit returned an error

A session with 결번 still reaches `done`. Only the attempt-exhaustion path can end in `partial`
or `failed`.

`progress` unit keys are prefixed so one object spans both layers: `reading:saju`,
`verdict:archivist`.

## Failure and refund policy

| Situation | Outcome |
|---|---|
| Insufficient credits | 402, no session row, nothing charged |
| Unknown / foreign profile | 404, nothing charged |
| Calculation produces no readable system | session `failed`, **full refund** |
| Session row insert fails | no session, **full refund** |
| Some systems 결번 | session `done`, **no refund** — the reading was delivered |
| Attempts exhausted, ≥ half the readable systems produced a reading | `partial`, **no refund** |
| Attempts exhausted, fewer than half | `failed`, **full refund** |
| Create called while a session is active | existing `sessionId` returned, **nothing charged** |

Refunds derive their amount from `credits_charged`, and they only run on the transition into a
terminal status while the lease is held, so they cannot run twice. An admin charge is *skipped*
rather than taken by `deductCreditsBalance`, so the runner records `credits_charged = 0` and
every refund path correctly does nothing.

Pricing (`creditsForOracleSession`) is **provisional** and needs an owner decision, like the
pinned `LEAGUE_*` prices in `lib/credits.ts`.

## The ai_payload privacy rule

`ai_payload` carries computed values only: the AxisVote's trait/element/phase vectors, the
confidence flags, and machine reason codes. No birth date, birth time, birth place, name,
coordinate, or timezone — ever. `result` keeps the full engine output, but it is server-side
only and is never sent to a provider.

Raw `session_inputs` is also excluded. It is not PII, but providers need the
computed PRISM vectors, not the user's color picks or micro-check answers.

The payload builders work from an allowlist, and `assertNoPersonalData` is the gate that proves
it: it fails **closed**, so a contributor who adds a field carrying raw profile data gets a
failed session rather than a leak. Two deliberate carve-outs, both closed and documented:

- **`context`** — exactly two fields. `asOfDate` (today's date, public, and legitimately equal
  to the birth date on a birthday) and `question` (the user's own words, deliberately
  submitted). Nothing else may be added.
- **`reasons` / `unreadable`** — romanized-name needles are skipped inside these fields only,
  because the projectors' code vocabulary romanizes CJK terms and collides: the Maya nawal
  `Kʼimʼ` reduces to `maya.nawal.kim`, which is also one of the most common Korean surnames.
  Keys, coordinates, dates, times, timezones, and CJK names are still checked there.

## Client polling loop

```
POST /api/oracle/session                 → { sessionId, status, progress, computations }
                                           (the chart is already complete here)
loop:
  POST /api/oracle/session/:id/advance   → kicks one chunk, returns immediately
  GET  /api/oracle/session/:id           → poll every 2s
until status ∈ { done, partial, failed }
```

- Call `advance` again whenever a poll shows a non-terminal status and `working === false`.
  Calling it while a chunk is running is harmless — the lease makes it a no-op.
- Never block the UI on `advance`; it returns before the work finishes.
- If the app is backgrounded or killed, do nothing special. The cron sweeper finishes the
  session, and the next poll picks it up wherever it got to.
- Poll responses never include the `model` column (server-only), nor `result` / `ai_payload`.

## Concurrency guards

- **One active session per user.** A create while one is in `queued | computing | layer1 |
  layer2` returns the existing `sessionId` instead of charging again.
- **AI-unit cap.** `ORACLE_MAX_CONCURRENT_AI_UNITS` (50), all-or-nothing per chunk. Over the
  cap the chunk does no work, leaves `next_action` untouched, drops the lease, and the sweeper
  retries. The gauge is **process-local**: on a multi-instance deploy the effective limit is
  (instances × 50). A truly global cap needs a counter table and a round trip per unit, which is
  not worth paying for while the provider is stubbed.

## AI mode

```
ORACLE_AI_MODE   stub | live    default stub
```

`stub` (default) uses `createStubAiAdapter` for both layers — no provider client
is constructed. `live` runs layer-1 readings through the Challenger registry in
`lib/oracle/ai/registry.ts` and keeps layer 2 on the stub. Model strings stay
server-side; the poll view exposes brand only.

A one-session live smoke (do not run from tests):

```
npx tsx --env-file=.env.local --import ./scripts/stubs/register-server-only.mjs scripts/oracle-smoke.ts
```

## Stub configuration

Defaults produce a 2–15s delay and always succeed. To exercise the 결번 path:

```
ORACLE_STUB_MIN_DELAY_MS   default 2000
ORACLE_STUB_MAX_DELAY_MS   default 15000
ORACLE_STUB_FAILURE_RATE   default 0    (0–1, provider error)
ORACLE_STUB_TIMEOUT_RATE   default 0    (0–1, hangs past the deadline)
```

Rolls are seeded per `(session seed, kind, unit)`, so a re-run is reproducible.

## Known gaps

- **Older sessions have no PRISM state.** Sessions created before
  `session_inputs` was added remain a PRISM 결번; this is intentional because
  reconstructing colors would fabricate user input.
- **Estimated birth times report at full weight.** The axis layer has no `estimated` confidence
  basis, so a survey-band time is used as if it were a clock. Tracked in
  `ComputeAssumptions.birthTimeEstimated`; the honest fix is a third basis in the axis layer.
- **Two-syllable Korean surnames** (남궁, 황보 …) split wrong: the runner takes the first
  syllable as the surname.
- **Tarot positions and rune counts are derived from the seed**, not drawn by the user, until the
  UI exists.
- **`sex` defaults to male** for 대운 / 大限 direction when the profile has none. Recorded in
  `ComputeAssumptions.sexDefaulted`.
- **No UI is wired.** Deliberate, per the task.
