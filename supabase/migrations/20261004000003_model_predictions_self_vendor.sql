-- Analysis-only self-vendor flags for AIRANK. These used to be appended to
-- reasoning_text as a [self_vendor ...] marker; they now live in columns so
-- display copy never has to scrub them out of model prose.
alter table public.model_predictions
  add column if not exists self_vendor_subject boolean,
  add column if not exists self_vendor_param boolean;

comment on column public.model_predictions.self_vendor_subject is
  'AIRANK analysis flag: seat vendor brand matches the queried subject (or camp). Null for non-ai_models rows.';
comment on column public.model_predictions.self_vendor_param is
  'AIRANK analysis flag: seat vendor brand matches the brand_above param. Null for non-ai_models rows.';
