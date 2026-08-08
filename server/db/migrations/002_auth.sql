-- 002_auth: user accounts and per-user ownership of programs.
--
-- Sessions live in the database rather than in a signed cookie so that
-- logging out, or revoking a stolen session, actually takes effect: a
-- self-contained token stays valid until it expires no matter what the
-- server wants.

CREATE TABLE users (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Stored lower-cased so "Ana@x.com" and "ana@x.com" cannot both register.
  email         TEXT        NOT NULL UNIQUE,
  -- scrypt: salt, parameters and derived key, all in one string.
  password_hash TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Only the SHA-256 of the token is kept. A dump of this table therefore
  -- does not hand anybody a working session.
  token_hash TEXT        NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expiry ON sessions (expires_at);

-- Ownership. Nullable on purpose: rows that already existed (and anything
-- created by the seed) have no owner yet, and are invisible to every query
-- until the first account claims them. See `claimOrphanPrograms`.
ALTER TABLE programs
  ADD COLUMN user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX idx_programs_user ON programs (user_id);

-- The same file may now legitimately be imported by two different people,
-- so the hash is unique per owner rather than globally.
ALTER TABLE programs DROP CONSTRAINT programs_source_hash_key;
CREATE UNIQUE INDEX idx_programs_owner_hash ON programs (user_id, source_hash);
