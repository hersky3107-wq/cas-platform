# Oracle Module Audit

Fact-finding only. Generated from repo inspection. Paths are relative to repo root unless noted.

---

## A. Inventory

### A1. Files by category

**Page / UI**
- `app/modes/oracle/page.tsx` — lobby (Fate / Astro / Tarot / Daily links)
- `app/modes/oracle/profile/page.tsx` — birth sketch form + 15-question survey
- `app/modes/oracle/fate/page.tsx` — Fate wrapper
- `app/modes/oracle/astro/page.tsx` — Astro wrapper
- `app/modes/oracle/tarot/page.tsx` — Tarot spread UI + card pick + NDJSON consumer
- `app/modes/oracle/daily/page.tsx` — Daily fortune UI + NDJSON consumer
- `app/modes/oracle/OracleReadingClient.tsx` — shared Fate/Astro reading UI + NDJSON consumer
- `app/modes/oracle/OracleSessionEndFlow.tsx` — vote + share + save to `oracle_sessions`
- `app/share/[share_id]/page.tsx` — loads shared `oracle_sessions` (oracle-adjacent)
- `components/HelpModal.tsx` — shared help modal (used on all oracle pages)
- `public/icons/oracle.png` — lobby icon
- `public/tarot/deck.json` + `public/tarot/*.jpg` — 78-card deck assets

**Help / i18n content (not runtime prompts)**
- `lib/help-modal/oracle-content.ts`
- `lib/help-modal/oracle-fate-content.ts`
- `lib/help-modal/oracle-astro-content.ts`
- `lib/help-modal/oracle-tarot-content.ts`
- `lib/help-modal/oracle-daily-content.ts`

**API routes**
- `app/api/oracle/fate/route.ts`
- `app/api/oracle/astro/route.ts`
- `app/api/oracle/tarot/route.ts`
- `app/api/oracle/daily/route.ts`
- `app/api/oracle/profile/route.ts`
- `app/api/oracle/infer-time/route.ts`
- `app/api/oracle/save-session/route.ts`

**Engine / lib**
- `lib/oracle/types.ts`
- `lib/oracle/session-types.ts`
- `lib/oracle/oracle-constants.ts`
- `lib/oracle/oracle-prompts.ts`
- `lib/oracle/exec-readings.ts` — multi-AI reader + synth orchestration
- `lib/oracle/oracle-route-handler.ts` — **NOT wired to any route (dead)**
- `lib/oracle/profile-resolver.ts` — birth → time + sijin + `fateBirthLine()`
- `lib/oracle/profile-guard.ts`
- `lib/oracle/sijin.ts` — 時辰 band mapping only
- `lib/oracle/western-chart.ts` — Sun/Moon/Asc via `astronomy-engine`
- `lib/oracle/geocode.ts` — Open-Meteo geocoding
- `lib/oracle/survey-data.ts` — 15-question survey spec
- `lib/oracle/oracle-language.ts` — CJK language override on system prompts
- `lib/oracle/openai-gpt.ts` — GPT synthesis helper
- `lib/oracle/oracle-db.ts` — inserts to `ai_responses` / `model_cost_logs`
- `lib/oracle/users-oracle-storage.ts` — read/write `users.oracle_birth_profile`
- `lib/credits.ts` — oracle credit costs (oracle-adjacent)
- `lib/modules/visibility.ts` — hides oracle for `ar` locale (oracle-adjacent)

**Prompt templates**
- `lib/oracle/oracle-prompts.ts` — `fateReaderSystemPrompt`, `westernReaderSystemPrompt`, `oracleSynthesisSystemPrompt`, user prompts
- `app/api/oracle/fate/route.ts` — inline `fateSynthesisSystemPromptExact` (lines 26–73)
- `app/api/oracle/astro/route.ts` — inline `astroSynthesisSystemPromptExact` (lines 24–69), per-provider role lines (168–173)
- `app/api/oracle/tarot/route.ts` — inline `tarotReaderSystemPrompt`, `tarotSynthesisSystemPrompt`, `honestReadingBlock` (lines 96–322)
- `app/api/oracle/daily/route.ts` — inline DeepSeek/Gemini/Claude system prompts + synth prompt (lines 181–289)
- `app/api/oracle/infer-time/route.ts` — Anthropic infer prompt (lines 100–105, 130)

**Types**
- `lib/oracle/types.ts` — `OracleBirthProfileV1`, `Gender`, `ApproxBirthBand`
- `lib/oracle/session-types.ts` — `OracleSessionResponse`
- `lib/oracle/users-oracle-storage.ts` — `UsersOracleBirthProfileJson`
- `lib/credits.ts` — `OracleTarotSpreadKey`

**Schema / migrations**
- `supabase/migrations/20260215000001_oracle_birth_profile.sql` — `profiles.oracle_birth_profile`
- `supabase/migrations/20260216000002_users_oracle_birth_profile.sql` — `users.oracle_birth_profile`
- `supabase/migrations/20260530000001_oracle_sessions.sql` — `oracle_sessions`

**Build / asset scripts (not runtime)**
- `scripts/generate-tarot-deck-json.js`
- `scripts/copy-tarot-images.js`

**NOT FOUND under `components/`:** oracle-specific components (only shared `HelpModal`).

---

### A2. API routes

| Route | Method | Request body | Response | Streaming |
|-------|--------|--------------|----------|-----------|
| `/api/oracle/profile` | GET | (auth via session / optional body token) | `{ profile, complete }` | No — once |
| `/api/oracle/profile` | POST | `{ dob, birth_city, gender, birth_time_known, birth_time_24h?, time_approx_band?, time_from_survey?, resolved_sijin_kr?, survey_selections? }` | `{ ok, profile, complete }` | No |
| `/api/oracle/infer-time` | POST | `{ answers: { q1..q15: number }, supabaseAccessToken? }` | `{ ok, sijin_kr, midpoint_24h, fallback? }` | No |
| `/api/oracle/fate` | POST | `{ question?, oracle_birth_profile?, supabaseAccessToken? }` | NDJSON stream | **Yes — NDJSON** (`application/x-ndjson`) |
| `/api/oracle/astro` | POST | same as fate | NDJSON stream | **Yes — NDJSON** |
| `/api/oracle/tarot` | POST `stage:"start"` | `{ spread: one\|three\|five\|celtic }` | `{ ok, sessionId, cost, creditsRemaining, spread, count, label }` | No |
| `/api/oracle/tarot` | POST `stage:"read"` (default) | `{ spread, sessionId, cardIds: number[], question? }` | NDJSON stream | **Yes — NDJSON** |
| `/api/oracle/daily` | POST | (auth only) | NDJSON stream | **Yes — NDJSON** |
| `/api/oracle/save-session` | POST | `{ oracle_type, question, responses[] }` | `{ id, share_id }` | No |
| `/api/oracle/save-session` | PATCH | `{ session_id, voted_ai }` | `{ ok }` | No |

**NDJSON event types (fate / astro / tarot read / daily):**
- `meta`, `reader_result`, `reader_batch_done` (fate/astro only), `synthesis`, `done`, `error`

**Oracle-adjacent routes elsewhere:** NOT FOUND (no other `/api/**/oracle*` routes).

---

### A3. Sub-modes shipping today

| Mode | Route + page | Status in repo |
|------|----------------|----------------|
| **FATE (Saju)** | `/modes/oracle/fate` → `POST /api/oracle/fate` | **Live code** — linked from lobby (`app/modes/oracle/page.tsx` L83–102) and homepage (`app/page.tsx` L493–498) |
| **ASTRO** | `/modes/oracle/astro` → `POST /api/oracle/astro` | **Live code** |
| **TAROT** | `/modes/oracle/tarot` → `POST /api/oracle/tarot` | **Live code** |
| **Daily Fortune** | `/modes/oracle/daily` → `POST /api/oracle/daily` | **Live code** |
| **Birth profile** | `/modes/oracle/profile` → `/api/oracle/profile` | **Live code** (gate for all modes) |

**Dead / unwired:**
- `lib/oracle/oracle-route-handler.ts` — `handleOracleNdjson()` exported but **NOT FOUND** imported by any route (superseded by `fate/route.ts` + `astro/route.ts`).
- `lib/modules/config.ts` L103–108 lists oracle as `status: 'coming-soon'` in `betaModules` — contradicts live `/modes/oracle` pages (config stale).

**Production deploy state:** NOT FOUND in repo (cannot confirm prod vs staging).

---

## B. Input & birth data

### B1. Lobby form component + state type

- **Component:** `app/modes/oracle/profile/page.tsx` (title “Birth sketch”, not the lobby itself; lobby redirects here if profile incomplete — `app/modes/oracle/page.tsx` L29–31).
- **State produced:** React local state → POST body → persisted as `OracleBirthProfileV1` (`lib/oracle/types.ts` L11–28).
- **Fields collected:**
  - DOB: month/day/year selects → ISO `YYYY-MM-DD` (`profile/page.tsx` L107–110, L264–267)
  - `birth_city` text (`L113, L422–428`)
  - `gender`: `'male' | 'female' | 'prefer_not_to_say'` (`L113, L437–447`)
  - Time: exact `birth_time_24h` OR unknown → 15-question survey OR legacy `time_approx_band` (`L115–118, L450–576`)

### B2. City resolution

- **Geocoding:** `lib/oracle/geocode.ts` — remote `GET https://geocoding-api.open-meteo.com/v1/search` (no API key). Returns `{ latitude, longitude, timezone, label }` (L2–7, L23–40).
- **Used by:** `app/api/oracle/astro/route.ts` L108–115; `app/api/oracle/daily/route.ts` L113–125; also `lib/oracle/oracle-route-handler.ts` L88–96 (dead path).
- **Timezone lookup:** IANA string from Open-Meteo `results[0].timezone` (`geocode.ts` L35).
- **Local → UTC:** `lib/oracle/western-chart.ts` `localBirthInstantUtc()` uses `date-fns-tz` `fromZonedTime(ref, ianaTz)` (L59–63).
- **Historical timezone / DST:** NOT FOUND — no dedicated historical-TZ library or manual offset tables; relies on `date-fns-tz` + modern IANA zone from geocoder.
- **City DB in repo:** NOT FOUND — remote geocoding only.

### B3. Birth-time estimation questionnaire

- **Spec file:** `lib/oracle/survey-data.ts`
- **Question count:** **15** (`SURVEY_QUESTIONS`, L29–165; ids `q1`–`q15`)
- **Questions:** full English text in `SURVEY_QUESTIONS[].text` and choices in `.choices` (L29–165). Q1 anchors time-of-day energy; Q2–Q15 cover communication, emotions, decisions, conflict, energy, money, stress, social, fear, face shape, eyes, body, skin, hands.
- **Algorithm:**
  1. Client auto-POSTs all 15 answers to `/api/oracle/infer-time` when complete (`profile/page.tsx` L146–198).
  2. Server builds prompt listing each Q + selected choice (`infer-time/route.ts` L100–105).
  3. **Primary:** Anthropic `claude-sonnet-4-6` returns JSON `{ sijin_kr, midpoint_24h }` (L105, L127–131).
  4. **Fallback if no API key or bad JSON:** Q1 choice mapped via `SURVEY_SIJIN_ANCHORS` (`survey-data.ts` L167–177) → single sijin + midpoint HH:mm (`infer-time/route.ts` L91–98, L151–158).
  5. **Fallback if AI returns sijin but invalid time:** map sijin → midpoint via `DEFAULT_SIJIN` (`infer-time/route.ts` L36–48, L146–148).
- **Output format:** **Single time** (`midpoint_24h` e.g. `"12:00"`) + **single sijin label** (`sijin_kr` e.g. `"午時"`). **NOT FOUND:** time range, confidence score.
- **Stored:** Yes — on profile save: `time_from_survey: true`, `birth_time_24h`, `resolved_sijin_kr`, `survey_selections` (`profile/page.tsx` L291–296; `profile/route.ts` L94–105).

### B4. Birth data persistence

- **Table:** `public.users` column `oracle_birth_profile` JSONB (`supabase/migrations/20260216000002_users_oracle_birth_profile.sql`; read/write `users-oracle-storage.ts` L145–157, `profile/route.ts` L108–113).
- **Legacy column:** `profiles.oracle_birth_profile` migration exists (`20260215000001_oracle_birth_profile.sql`) but runtime code reads/writes **`users` only**.
- **Per-user / per-session:** **Per-user only** (one profile row per auth user). **NOT FOUND:** multiple birth profiles per user.
- **Stored JSON shape (flattened on write):** `UsersOracleBirthProfileJson` (`users-oracle-storage.ts` L6–15):

```json
{
  "date_of_birth": "1990-05-15",
  "birth_time": "14:30",
  "birth_city": "Seoul, South Korea",
  "gender": "female",
  "time_method": "exact",
  "survey_selections": { "q1": 2, "q2": 0 },
  "resolved_sijin_kr": "未時",
  "time_approx_band": "AFTERNOON"
}
```

(`time_method`: `"exact" | "survey" | "band"` — L11, L29–35)

- **Seed/fixture in repo:** NOT FOUND.
- **Internal V1 shape** (also accepted on read if `version: 1`): `OracleBirthProfileV1` in `lib/oracle/types.ts` L11–28.

---

## C. Engines

### C1. SAJU (사주)

- **Real 만세력 implementation:** **NOT FOUND**
- **File with any saju logic:** `lib/oracle/profile-resolver.ts` (`fateBirthLine`, sijin from wall clock); `lib/oracle/sijin.ts` (時辰 bands only).
- **Lunar ↔ solar conversion:** **NOT FOUND** in oracle module. (`lunar-javascript` in `package.json` L25 but **NOT FOUND** imported under `lib/oracle/` or oracle routes.)
- **24 solar terms (절기):** **NOT FOUND**
- **4 pillars (年月日時) with 천간/지지:** **NOT FOUND** — only hour **band label** (時辰 kr name) passed to LLM via `fateBirthLine()` (`profile-resolver.ts` L59–62).
- **십신 / 대운 / 오행 강약:** **NOT FOUND**
- **What Fate actually sends to LLM:** string like `date 1990-05-15; local time approx. 14:30; hour pillar 未時 (13:00–15:00); city Seoul; gender Female` (`profile-resolver.ts` L59–62).
- **Valid birth years (UI):** 1920 → current year (`profile/page.tsx` L100–104). No server-side max/min beyond `YYYY-MM-DD` regex (`profile/route.ts` L67–68).

### C2. ASTRO — precise answers

**Ephemeris vs sun-sign-only:**
- Uses **`astronomy-engine`** npm package (`lib/oracle/western-chart.ts` L1, L88–89) for **Sun** and **Moon** ecliptic longitudes at birth instant.
- **Ascendant** computed locally via GMST + lat/lon formula (`western-chart.ts` L32–56, L91) — not Swiss Ephemeris.
- **NOT FOUND:** Swiss Ephemeris, VSOP87 full set, external astrology API.

**Computed vs NOT FOUND:**

| Item | Status | Evidence |
|------|--------|----------|
| Sun position (degrees) | **Yes** | `sunLongitudeDeg` (`western-chart.ts` L88, L97) |
| Moon position (degrees) | **Yes** | `moonLongitudeDeg` (L89, L98) |
| Mercury/Venus/Mars/Jupiter/Saturn/Uranus/Neptune/Pluto | **NOT FOUND** | — |
| Ascendant (degrees + sign) | **Yes** | `ascLongitudeDeg`, `risingSign` (L91–92, L96) |
| Midheaven | **NOT FOUND** | — |
| 12 houses / house system | **NOT FOUND** | — |
| Aspects / orbs | **NOT FOUND** | — |
| Retrograde flags | **NOT FOUND** | — |
| Lunar nodes | **NOT FOUND** | — |

**Literal payload handed to LLM (ASTRO reader system prompt block)** — from `app/api/oracle/astro/route.ts` L132–139 (same structure in `oracle-route-handler.ts` L117–124):

```
Birth location (resolved): Seoul, Seoul, South Korea
Local birth datetime: 1990-05-15 14:30
Instant in UTC terms: 1990-05-15T05:30:00.000Z
Sun (54.32° ecliptic): Taurus
Moon (123.45° ecliptic): Leo
Ascendant / rising (201.10° ecliptic): Libra
```

(Wrapped inside `westernReaderSystemPrompt(chartBlock, questionLine)` — `oracle-prompts.ts` L26–44.)

**NDJSON `meta` also includes:** `western_chart: { sunSign, moonSign, risingSign }` only (sign names, no degrees) — `astro/route.ts` L196.

### C3. TAROT

- **Deck size:** **78** cards (`public/tarot/deck.json` — 78 `"id"` entries; validated server-side `deck.length !== 78` check in `daily/route.ts` L107).
- **Spread types:** `one` (1), `three` (3), `five` (5), `celtic` (10) — `app/api/oracle/tarot/route.ts` L17–56.
- **Draw mechanism:** **Client manual selection** — user toggles cards in UI (`tarot/page.tsx` L426–438 `togglePick`); **NOT FOUND** `Math.random` / `crypto` shuffle in oracle code.
- **Server accepts:** client-supplied `cardIds` array (`tarot/route.ts` L269–274).
- **Seeded / reproducible:** Draw is whatever user picked; stored in `sessions.prompt` as card names (`tarot/route.ts` L280–282). **NOT FOUND** server-side seed or draw replay table.
- **Reversals:** **NOT FOUND** (no reversed/upright flag in deck JSON, API, or prompts).

### C4. Shared calendar / astronomy utilities

- **Shared within oracle:** `lib/oracle/western-chart.ts` (used by astro + daily); `lib/oracle/geocode.ts` (astro + daily); `lib/oracle/profile-resolver.ts` + `sijin.ts` (fate + daily birth line); `lib/oracle/oracle-language.ts` (all modes).
- **Shared with non-oracle modules:** **NOT FOUND** — `lunar-javascript` used in `app/care/today/page.tsx` and Jeju pages, **not** wired to oracle.
- **Each engine self-contained?** Fate has no engine (LLM-only). Astro/daily share western-chart. Tarot is separate deck loader.

---

## D. LLM layer

### D1. Full prompt templates (verbatim)

#### Fate reader — `lib/oracle/oracle-prompts.ts` L1–24

**System (`fateReaderSystemPrompt`):**
```
You are a wise and warm fortune reader interpreting this person's 
Eastern birth chart (사주).

Birth info: ${birthLine}
User question (if any): ${questionLine}

CRITICAL RULES:
- Write like you are speaking directly and warmly to this person
- Use simple, everyday language. NO technical jargon. 
  NO complex terminology. If someone's grandmother couldn't 
  understand it, rewrite it.
- Be specific to this person — avoid generic statements 
  that could apply to anyone
- flowing prose only, no bullet points, no headers
- Maximum 600 tokens
- Complete your response fully. 
  If near the limit, write a closing sentence and stop cleanly.
- Never end mid-sentence
```

**User:** `Deliver your personalised reading now, following every style rule above.`

**Fate additions appended in route** (`fate/route.ts` L112–122, L154–169): today's date, current year, token budget, anthropic-specific closing instructions.

#### Fate synthesis — `app/api/oracle/fate/route.ts` L26–73 (`fateSynthesisSystemPromptExact`)

(Full text in file — uses **named AIs** Claude/Gemini/Grok/DeepSeek; differs from generic `oracleSynthesisSystemPrompt` in `oracle-prompts.ts` which says “another reader”.)

**Fate synthesis user payload** (`fate/route.ts` L225–228):
```
You have exactly ${N} labelled readings (${labels}).
${parts with –– Label –– headers}
```

#### Astro reader — `westernReaderSystemPrompt` (`oracle-prompts.ts` L26–48) + role prefix (`astro/route.ts` L175–180)

**Astro synthesis** — `astroSynthesisSystemPromptExact` (`astro/route.ts` L24–69) — same structure as fate synth but Claude/Gemini/Mistral/DeepSeek.

#### Tarot reader — `tarot/route.ts` L96–123 + prepended blocks L304–322 (`topPromptLine`, `honestReadingBlock`)

**Tarot synthesis** — `tarot/route.ts` L125–158

**Tarot synthesis user** — `tarot/route.ts` L384–390

#### Daily — three reader system prompts inline (`daily/route.ts` L181–238) + synth user prompt L266–289

**Infer-time** — `infer-time/route.ts` L105 user prompt; system L130

#### Dead path prompts — `lib/oracle/oracle-prompts.ts` `oracleSynthesisSystemPrompt` L50–97 (used only by dead `oracle-route-handler.ts` / `exec-readings.oracleRunSynth` if called from dead handler)

---

### D2. Approximate prompt token counts (prompt only, at runtime)

Estimates (~4 chars/token). **Flagged >2,000.**

| Mode | Prompt part | ~Tokens | >2000? |
|------|-------------|---------|--------|
| Fate reader system | base + birth line + date additions | 400–650 | No |
| Fate reader user | 1 line | ~15 | No |
| Fate synthesis system | `fateSynthesisSystemPromptExact` | ~450 | No |
| Fate synthesis user | 4 × reader texts (up to ~600 tok each) | **800–2500+** | **YES — often exceeds 2,000 when readers fill quota** |
| Astro reader system | chart block + rules + role line | 450–550 | No |
| Astro synthesis user | same pattern as fate | **800–2500+** | **YES** |
| Tarot reader system | cards + rules + honest block | 500–900 (celtic) | No |
| Tarot synthesis user | 3 reader texts | 600–2000+ | Borderline / **YES for large spreads** |
| Daily each reader | ~700 tok max instruction | ~350 each | No |
| Daily synth user | 3 readings + birth line | 600–1800 | Usually no |
| Infer-time | survey answers + system | 800–1200 | No |

---

### D3. AI providers / models

| Slot | Default model | Override in oracle routes | Source |
|------|---------------|---------------------------|--------|
| openai (readers) | `gpt-4o` | Fate/astro routes use 4 readers **without** openai reader | `MODEL_BY_PROVIDER` `lib/ai/router.ts` L95–101 |
| anthropic | `claude-sonnet-4-6` | Explicit `modelOverride: 'claude-sonnet-4-6'` | `fate/route.ts` L195; `astro/route.ts` L207; `tarot/route.ts` L286 |
| google | `gemini-3.5-flash` | Tarot/daily: `'gemini-3.5-flash'` | `tarot/route.ts` L287; `daily/route.ts` L245 |
| xai | `grok-3` | (fate only) | router default |
| deepseek | `deepseek-chat` | daily: explicit | `daily/route.ts` L244 |
| mistral | `mistral-large-latest` | tarot: explicit | `tarot/route.ts` L288 |
| **Synthesis** | **`gpt-4.1`** | `ORACLE_SYNTH_MODEL` | `lib/oracle/oracle-constants.ts` L21; all synth calls |

**Hardcoded strings:** yes — in route files and `oracle-constants.ts` (not only router defaults).

**Cross-check `router.ts`:** Oracle readers use `runSingleAiProvider` with `skipLanguageInjection: true` (`exec-readings.ts` L46); models from `MODEL_BY_PROVIDER` unless `modelOverrideByProvider` set.

---

### D4. Multi-AI synthesis

- **Yes** — all four modes run multiple AIs then a final OpenAI synthesis.
- **Orchestration files:**
  - `lib/oracle/exec-readings.ts` — `oracleRunFiveReaders` (parallel race completion, L74–108), `oracleRunSynth` (L111–205)
  - Per-mode routes duplicate/adapt this (fate/astro inline synth; tarot/daily inline)
- **Reader execution:** `Promise.race` loop over provider promises — **parallel**, completion order non-deterministic (`exec-readings.ts` L101–106). Tarot/daily use `Promise.all` (`tarot/route.ts` L370; `daily/route.ts` L260).
- **Synth input:** **Other AIs' text output only** (labels + prose). Fate/astro synth system prompt also includes **`birthDataLine` string** (`fate/route.ts` L33; `astro/route.ts` L31) — not raw ephemeris JSON. Astro **computed chart block** goes to **readers**, not directly to synth (synth gets text summaries + short birth line).

---

### D5. Determinism / caching / same-day same reading

| Mechanism | Present? | Evidence |
|-----------|----------|----------|
| Temperature fixed | **NOT FOUND** — oracle omits `temperature` in `runSingleAiProvider` calls → provider defaults (`exec-readings.ts` L39–48) |
| Deterministic seed (LLM) | **NOT FOUND** | |
| Daily tarot **card** pick | **Yes** | `hashCode(\`${dailySeed}${user.id}\`) % 78` (`daily/route.ts` L105–111) — same user + calendar day → same card |
| Daily **text** | **No** — fresh LLM call each POST | |
| Fate / Astro / Tarot text | **No** — fresh generation each run | |
| Response caching | **NOT FOUND** | |
| Re-view past reading without re-charge | **NOT FOUND** for generation; share URL reads saved `oracle_sessions` snapshot (no credit deduct on share view) |

---

## E. Delivery & resilience

### E1. Streaming mechanism

- **Oracle:** single long-lived HTTP response, **`application/x-ndjson`**, client `fetch` + `ReadableStream.getReader()` (`OracleReadingClient.tsx` L221–281; same pattern tarot/daily pages).
- **Arena:** also NDJSON over one stream (`app/modes/arena/page.tsx` L454–474; `app/api/ai-arena/route.ts` L767+).
- **DEEP (motie):** **NOT NDJSON** — staged **polling** via repeated POST with `stage` (`app/api/motie/deep/route.ts` L152+, stages `start|search|revise|debate|deliberate|done`). Client polls job state in DB.

Oracle is **not** converted to per-AI sequential polling (unlike DEEP's stage model).

### E2. Mobile screen lock mid-reading

- **Client:** NDJSON read loop runs in browser; if connection suspended/killed, `reader.read()` stops — **no reconnect/resume** (`OracleReadingClient.tsx` L232–281 — no resume logic).
- **Server:** continues in-route async work until stream closes; per-reader results **persist to DB** as each finishes (`exec-readings.ts` L52–58) independent of client.
- **User sees after lock:** partial UI state only; **NOT FOUND** client recovery from `sessionId` + DB poll.
- **Evidence:** no polling endpoint for oracle session progress; no job table for in-flight oracle reads.

### E3. Partial result persistence

- **`ai_responses` + `model_cost_logs`:** inserted **per reader as each completes** (`exec-readings.ts` L52–68; tarot `runReader` L181–197).
- **`oracle_sessions`:** saved **once at end** from client via `/api/oracle/save-session` (`OracleSessionEndFlow.tsx` L202–217) — full reader text array, not incremental.
- **`sessions` table:** row created at start with prompt stub; updated on tarot read with card list (`tarot/route.ts` L246–247, L280–282).

### E4. Rate limiting / queue / concurrency

- **Oracle routes:** **NOT FOUND** rate limits, queues, concurrency caps, or explicit timeouts in `app/api/oracle/**`.
- **Router:** optional `timeoutMs` on `runSingleAiProvider` — **NOT FOUND** passed from oracle routes.
- **Fan-out risk:** Fate run = 4 parallel reader API calls + 1 synth per request; Astro same; Tarot 3 parallel + synth; Daily 3 parallel + synth. **N users × M models** unbounded at app layer.

### E5. Credit deduction

| Mode | Deduct location | `moduleName` | Amount | Unit |
|------|-----------------|--------------|--------|------|
| Fate | `fate/route.ts` L124 | `oracle_fate` | 4 | per reading session (before stream) |
| Astro | `astro/route.ts` L141 | `oracle_astro` | 4 | per reading session |
| Tarot | `tarot/route.ts` L230 | `oracle_tarot` | 2/3/4/6 by spread | per spread **start** (`stage:"start"`) |
| Daily | `daily/route.ts` L143 | `oracle_daily` | 3 | per daily run |

- **Function:** `deductCreditsBalance(supabaseAdmin, user.id, amount, moduleName)` (`lib/credits-server.ts` L216–251).
- **Constant:** `ORACLE_SESSION_COST = creditsForOracleAstrology()` → 4 (`oracle-constants.ts` L15–16; `credits.ts` L106–107).
- **Re-view past reading:** Share page load — **NOT FOUND** credit deduct. Re-running same mode — **new deduct** each POST.
- **Synth / per-AI:** **NOT FOUND** separate credit charges — one upfront deduct per session/spread/daily.

---

## F. Schema & i18n

### F1. DDL oracle touches

**`public.users.oracle_birth_profile`** (`20260216000002_users_oracle_birth_profile.sql`):
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS oracle_birth_profile JSONB;
```
- **RLS policies in repo:** NOT FOUND for this column/table alteration.

**`public.profiles.oracle_birth_profile`** (`20260215000001_oracle_birth_profile.sql`):
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS oracle_birth_profile JSONB DEFAULT NULL;
```
- **RLS:** NOT FOUND in migration.

**`public.oracle_sessions`** (`20260530000001_oracle_sessions.sql`):
```sql
create table if not exists public.oracle_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  oracle_type text not null,
  question text not null,
  responses jsonb not null,
  is_public boolean not null default false,
  share_id text not null unique,
  voted_ai text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists oracle_sessions_share_id_idx on public.oracle_sessions (share_id);
create index if not exists oracle_sessions_user_id_idx on public.oracle_sessions (user_id);
```
- **RLS:** NOT FOUND — migration does not `enable row level security` or create policies.

**`public.sessions`** — inserted by oracle routes (`fate/route.ts` L140–144). **DDL NOT FOUND** in `supabase/migrations/`.

**`public.ai_responses` / `public.model_cost_logs`** — written via `lib/oracle/oracle-db.ts`. **DDL NOT FOUND** in repo migrations searched.

---

### F2. Completed reading storage / history comparison

- **Table:** `oracle_sessions` stores `{ oracle_type, question, responses[], voted_ai, share_id, created_at }` (`save-session/route.ts` L57–67).
- **User history UI (“3 months ago vs now”):** **NOT FOUND**
- **Temporal comparison feature:** **NOT FOUND**
- **Share-only replay:** `app/share/[share_id]/page.tsx` loads by `share_id` (L247–259).

---

### F3. Languages

**UI strings:**
- Page chrome: predominantly **English** (`profile/page.tsx` `lang="en"` L333; tip text L349–351).
- Help modals: **EN, KO, JA, FR, ES, PT** (`lib/help-modal/oracle-content.ts` L3–78 and sibling files).

**LLM output language:**
- `applyOracleLanguageToSystemPrompt` prepends CJK override when detected from question, `Accept-Language`, or user metadata (`oracle-language.ts` L71–87).
- Tarot/daily also use birth-city-based instruction when no question (`tarot/route.ts` L88–94; `daily/route.ts` L47–48).
- **NOT FOUND** full prompt translation packs like SYNOD — relies on model + override prefix.

---

### F4. Compatibility / 궁합

- **NOT FOUND** — no two-person birth input, couple mode, or compatibility routes/pages in oracle module.

---

## G. Verdict

### G1. Top 10 break / rewrite triggers if adding 7 divination systems + common output contract

1. **No shared computed-output schema** — each mode hand-builds different string blocks for LLM (`fateBirthLine` vs `chartBlock` vs tarot `cardsLine`); no common JSON contract.
2. **Prompts duplicated inline per route** — fate/astro/tarot/daily each own synthesis templates; 7 more systems multiplies copy-paste (`fate/route.ts`, `astro/route.ts`, etc.).
3. **Mode-specific API routes** — one POST handler per mode; no generic `/api/oracle/read` with `system_id` parameter.
4. **Fate/Saju has no real engine** — adding eastern systems would expose that LLM-only “saju” is not extensible without a pillar engine.
5. **Reader sets hardcoded per mode** — different provider lists (fate 4, astro 4, tarot 3, daily 3); not data-driven (`fate/route.ts` L187; `astro/route.ts` L199; etc.).
6. **Credit model per mode/spread** — `creditsForOracleTarotSpread` etc. not unified (`credits.ts` L96–115).
7. **NDJSON event shapes differ slightly** — tarot meta includes `cards`; daily includes `tarot` card; no versioned stream protocol.
8. **Client UIs monolithic** — `OracleReadingClient` vs full custom tarot/daily pages; 7 systems would need new pages or heavy refactor.
9. **`oracle_sessions.responses` is display-name keyed** (`ai_name` string) — not stable slot/provider enum; bad for cross-system analytics (`session-types.ts` L1–4).
10. **Dead duplicate orchestrator** (`oracle-route-handler.ts`) vs live route copies — risk of drift when extending.

### G2. Already reusable as shared engine

1. **`lib/oracle/western-chart.ts`** — Sun/Moon/Asc from `astronomy-engine` + ascendant math; reused by astro + daily.
2. **`lib/oracle/geocode.ts`** — city → lat/lon/tz (Open-Meteo).
3. **`lib/oracle/profile-resolver.ts` + `types.ts` + `users-oracle-storage.ts` + `profile-guard.ts`** — birth profile CRUD and validation.
4. **`lib/oracle/sijin.ts`** — wall-clock → 時辰 band (limited but reusable for any time-based eastern UI).
5. **`lib/oracle/oracle-language.ts`** — CJK detection + system prompt prefix.
6. **`lib/oracle/exec-readings.ts`** — parallel multi-provider runner + DB logging pattern (if unified prompts fed in).
7. **`lib/oracle/openai-gpt.ts`** — synthesis LLM call wrapper.
8. **`lib/oracle/oracle-db.ts`** — ai_responses / cost log inserts.
9. **`OracleSessionEndFlow` + `/api/oracle/save-session`** — post-reading save/share/vote pipeline.
10. **Tarot deck asset pipeline** — `public/tarot/deck.json` (78 cards) + spread position maps (reusable for any tarot-like draw UI).

---

*End of audit.*
