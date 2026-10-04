-- brand_table rankings need more than 80 chars (five brand names).
alter table public.model_predictions
  drop constraint if exists model_predictions_qualifier_text_len_chk;

alter table public.model_predictions
  add constraint model_predictions_qualifier_text_len_chk
  check (
    predicted_qualifier_text is null
    or char_length(predicted_qualifier_text) <= 400
  );
