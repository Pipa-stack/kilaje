-- 003_profile_and_reset: who you are, and getting back in.

-- ------------------------------------------------------------ PROFILE

ALTER TABLE users
  -- What to call you. Null until you fill it in; the email is the fallback.
  ADD COLUMN display_name TEXT,
  ADD COLUMN gym          TEXT,
  -- Applies to body weight only. Training weights come from a spreadsheet
  -- written in kilos and stay in kilos, so converting them would misreport
  -- what the sheet says.
  ADD COLUMN weight_unit  TEXT NOT NULL DEFAULT 'kg'
    CHECK (weight_unit IN ('kg', 'lb'));

-- Body weight over time. Always stored in kilos; the unit above is display.
CREATE TABLE body_weights (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weight_kg   NUMERIC(6, 2) NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 500),
  -- One reading per day: weighing yourself twice replaces the entry rather
  -- than producing a sawtooth chart.
  measured_on DATE        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, measured_on)
);

CREATE INDEX idx_body_weights_user ON body_weights (user_id, measured_on DESC);

-- ------------------------------------------------------- PASSWORD RESET

-- Same shape as `sessions`: only the hash of the token is stored, so a dump
-- of this table cannot be used to take over an account.
CREATE TABLE password_resets (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  -- Stamped on use. A reset link works exactly once, so finding it later in
  -- an inbox or a proxy log is worthless.
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_resets_user ON password_resets (user_id);
CREATE INDEX idx_password_resets_expiry ON password_resets (expires_at);
