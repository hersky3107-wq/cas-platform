-- ============================================================================
-- AI Prediction League — CLOSED-BOOK PACKET AUDIT TRAIL (ADDITIVE).
--
-- WHY: grading already persists every OUTPUT (direction, rationale, the
-- resolution close). The INPUT the closed-book models actually saw was only
-- in a 6-hour research cache bucket — round fffc1716's Aug-18 packet is
-- unrecoverable. A grading system with an audit trail on the output and none
-- on the input is incomplete.
--
-- Two nullable columns on prediction_rounds (NOT a child table):
--   closed_book_packet_cache_key — the research cache key used for this run
--   closed_book_packet_text      — the exact assembled injection (numeric
--                                  block + consensus + optional crypto +
--                                  demoted prose) that premier/challenger/
--                                  world received.
--
-- WHY THE ROUND ROW, NOT A CHILD TABLE: the snapshot is 1:1 with the round
-- the same way `anchor_price` is — the frozen input that produced THIS
-- round's graded rows. A child table would imply versioned re-generations;
-- we write ONCE (null-guard, same as the anchor) so a later packet rebuild
-- cannot erase what the original models saw.
--
-- Written at generation time, AFTER assemble and BEFORE the first model
-- call (see persistClosedBookPacket in lib/league/orchestrator.ts).
-- ============================================================================

alter table public.prediction_rounds
  add column if not exists closed_book_packet_cache_key text,
  add column if not exists closed_book_packet_text text;

comment on column public.prediction_rounds.closed_book_packet_cache_key is
  'Research-cache key (rp_v1|instrument|horizon|bucket) of the packet assembled for this round''s closed-book models. Null for rounds generated before this column existed.';

comment on column public.prediction_rounds.closed_book_packet_text is
  'Exact assembled text injected into premier/challenger/world for this round (numeric market block + consensus + optional crypto + demoted prose). Written once at first generation, never overwritten. The reproduce test reads this back and compares it to assembleClosedBookInjection.';
