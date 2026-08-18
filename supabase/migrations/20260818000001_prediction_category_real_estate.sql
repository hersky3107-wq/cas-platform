-- Public catalog is 12 categories. The ledger CHECK had 14 values; this adds
-- `real_estate` (the one new product category). Existing values are KEPT so
-- historical rows stay valid:
--   bond_rate          → folded into public `macro_econ` (no chip)
--   crypto_perps       → lives under public `crypto` (not a top-level chip)
--   futures_derivatives → schema-only (not a public chip)
--   entertainment_awards → ledger key for public `entertainment`
--   esports never existed as a column; sports absorbs it.
-- Mapping lives in lib/league/catalog.ts.

alter table public.prediction_rounds
  drop constraint if exists prediction_rounds_category_chk;

alter table public.prediction_rounds
  add constraint prediction_rounds_category_chk check (category in (
    'stock','etf_index','bond_rate','gold_metal','macro_econ',
    'commodity_energy','crypto_spot','fx','futures_derivatives',
    'politics_election','sports','entertainment_awards','memecoin',
    'crypto_perps','real_estate'
  ));
