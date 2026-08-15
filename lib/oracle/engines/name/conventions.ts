/**
 * 성명판단 (name divination) conventions.
 *
 * Pure functions only. No network at runtime — all stroke tables are
 * bundled TS data (see tables.ts).
 *
 * ── Language branching (fixed) ──────────────────────────────────────────
 * locale 'ko'          → 한글 획수 (훈민정음 원획법)
 * locale 'ja' | 'zh-*' → 한자 획수 (`kangxi` default or `modern`)
 * everything else      → { supported: false, limitations: ['use_numerology_instead'] }
 * We do NOT invent a Latin-alphabet stroke system; Latin names are the
 * numerology engine's job.
 *
 * ── Korean stroke method: 원획법 vs 필획법 vs 곡획법 ────────────────────
 * 원획법(原劃法): counts each 자모 by a fixed table tied to the Hunminjeongeum
 *   design principles (원획법 is what ~99% of Korean 성명학 practice uses).
 * 필획법(筆劃法): counts strokes as actually drawn (pen-stroke count).
 * 곡획법(曲劃法): counts one stroke per direction change (used for 88괘상론,
 *   not for the 81수리 theory this engine implements).
 * We implement 원획법 only, per spec. Source for the 자모 stroke table:
 * https://www.parkhongsam.com/53 (자음/모음 획수표), cross-checked against
 * https://chaso.tistory.com/39. See tables.ts for the full table and the
 * additive derivation used for complex vowels/받침 not listed explicitly
 * by that source (예: ㅑ, compound 받침 such as ㄳ/ㄺ/ㅄ).
 *
 * ── Hanja stroke convention ────────────────────────────────────────────
 * Japanese 姓名判断 has two established schools: traditional 熊崎式 and
 * related schools use 舊字體/康熙 (radical-restored) counts, while many
 * contemporary free calculators use 新字體/modern written-stroke counts.
 * `strokeConvention` exposes both; it defaults to `kangxi` for backward
 * compatibility and the result always includes the other reading.
 *
 * Digital "total strokes" fields (what most IME/Unicode tools show, and
 * what Unihan-derived npm packages like `cjk-unihan` typically expose) use
 * 필획법: an abbreviated radical is counted by its drawn strokes, e.g.
 * 洙 = 氵(3) + 朱(6) = 9. The Kangxi Dictionary's OWN classification instead
 * always uses each radical's full, original ideograph strokes — 氵's
 * original form is 水 (4 strokes) — so 洙 = 水(4) + 朱(6) = 10 there. This
 * "원획법" correction is what Korean/Japanese name-fortune tables use, and
 * it is what the Kangxi Dictionary itself reports as a character's total
 * stroke count (verified for 郎: Kangxi lists 部首=邑(7 strokes, the
 * restored/original form, not 阝's drawn 3) + 部外筆畫=7 (良) = 14 total).
 *
 * ★ Radical restoration table (abbreviated → original, drawn → restored):
 *   氵→水(4)   忄→心(4)   艹→艸(6)   扌→手(4)   月(肉)→肉(6)  犭→犬(4)
 *   衤→衣(6)   礻→示(5)   阝(left)→阜(8)   阝(right)→邑(7)  王→玉(5)  辶→辵(7)
 * See tables.ts `RADICAL_RESTORATION` for the abbreviated/original stroke
 * pairs and `RADICAL_TEST_CASES` for twelve worked examples (one per
 * radical) cross-checked against public references; full write-up with
 * 15+ verified characters is in docs/name-verification.md.
 *
 * We deliberately restrict the bundled hanja table to a curated set of
 * name-usable characters (common Korean surnames incl. 2-character 남궁/
 * 선우/諸葛-type surnames, common given-name hanja, and a handful of common
 * Japanese surname/given-name kanji) rather than the full ~9,000-character
 * Korean 인명용 한자 registry, to keep the bundle small — exactly as
 * instructed. Unknown characters raise `NameInputError('unknown_hanja')`
 * rather than silently guessing.
 *
 * Japanese hanja input is expected in traditional/旧字体 form (as spoken of
 * by 熊崎式 姓名判断 practice: "画数確定: 旧字体で各字の画数を確定"). This
 * engine does not perform shinjitai → kyuujitai normalization (e.g. 辺→邊);
 * pass the traditional glyph if precision matters.
 *
 * ── 오격 (five gyeok) ────────────────────────────────────────────────────
 * 天格 = sum(surname strokes), +1 (가성수/영수) only when the surname is a
 *   single character. A two-character surname (남궁, 선우, 諸葛) already
 *   has two elements to sum, so no padding is added.
 * 人格 = last surname character + first given-name character. Always,
 *   regardless of how many characters either side has.
 * 地格 = sum(given-name strokes). No padding is added even for a
 *   single-character given name — unlike 天格, a lone given-name character
 *   can already stand as its own 격 (this mirrors common practice, e.g.
 *   the worked example in the verification doc: 哲(10) alone → 地格 10,
 *   no +1).
 * 外格 = 總格 − 人格. Some schools add a further +1 here (a second 가성수)
 *   when either side is a single character; this engine does not, per the
 *   task's literal formula. See docs/name-verification.md for the exact
 *   divergence, checked against a real calculator's output.
 * 總格 = sum(every character's strokes). Never padded.
 * These generalize to 3-character given names automatically: 地格 sums
 * all three, and 外格 = 總格 − 人格 correctly leaves out only the first
 * given-name character (already counted in 人格) and the last surname
 * character (already counted in 人格).
 *
 * ── 수리 길흉 (1–81) ─────────────────────────────────────────────────────
 * Standard 熊崎式(구마자키 겐오, 1929) 81-number system, the de facto basis
 * for the overwhelming majority of Korean and Japanese 성명학/姓名判断
 * sites today. 5-level label (대길/길/평/흉/대흉) and short keyword per
 * number are stored in tables.ts, sourced from a comprehensive public
 * summary of the 熊崎式 table (see docs/name-verification.md for the URL
 * and the exact 대흉 count cross-check: 34/44/54/64 only).
 *
 * ── 음양 배열 ────────────────────────────────────────────────────────────
 * Odd stroke count = 양(yang), even = 음(yin), evaluated per character
 * across the whole name (surname + given name). All-same-parity is judged
 * "unbalanced" (치우침); any mix is "balanced".
 *
 * ── 오행 배열 (삼재 배치) ────────────────────────────────────────────────
 * 天格/人格/地格 are each reduced to a last digit, then mapped to an
 * element by the standard numeric-오행 convention: 1·2→木, 3·4→火, 5·6→土,
 * 7·8→金, 9·0→水. The 天-人 and 人-地 pairs are each judged 상생
 * (either element generates the other), 상극 (either overcomes the other),
 * or 비화 (same element) — a direction-agnostic simplification noted here
 * because more detailed schools do distinguish the generating direction.
 *
 * `axes: null` is intentional — axis projection is a separate content
 * layer, not computed here.
 */
export const NAME_ENGINE_VERSION = '1.1.0'
