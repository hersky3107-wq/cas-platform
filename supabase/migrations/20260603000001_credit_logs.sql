CREATE TABLE IF NOT EXISTS credit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id),
  module text NOT NULL,
  amount integer NOT NULL,
  balance_before integer,
  balance_after integer,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE credit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read all" ON credit_logs FOR SELECT USING (true);
