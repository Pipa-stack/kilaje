-- 001_init: training template and performed work.
--
-- The schema is split in two halves that never mix:
--
--   TEMPLATE  (imported from the Excel, read-only afterwards)
--     programs -> weeks -> workout_days -> exercises -> reference_sets
--
--   EXECUTION (produced by the user while training)
--     workout_sessions -> session_sets
--
-- An import never touches execution rows, and training never rewrites the
-- template. That is what makes re-importing a plan safe: a new program is
-- inserted alongside the old ones and every past session stays attached to
-- the program it was performed against.

-- ---------------------------------------------------------------- TEMPLATE

CREATE TABLE programs (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name              TEXT        NOT NULL,
  source_file_name  TEXT        NOT NULL,
  -- SHA-256 of the uploaded bytes. Unique, so uploading the very same file
  -- twice returns the existing program instead of duplicating it.
  source_hash       TEXT        NOT NULL UNIQUE,
  -- 1, 2, 3... per source_file_name, so the UI can show "v2" of a plan.
  version           INTEGER     NOT NULL DEFAULT 1,
  imported_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE weeks (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id  BIGINT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  sheet_name  TEXT    NOT NULL,
  UNIQUE (program_id, number)
);

CREATE TABLE workout_days (
  id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  week_id  BIGINT  NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  number   INTEGER NOT NULL,
  -- "PUSH", "LEG (CADENA ANTERIOR)"... absent in some template rows.
  type     TEXT,
  UNIQUE (week_id, number)
);

CREATE TABLE exercises (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day_id      BIGINT  NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
  -- Position as printed in the template (1..10).
  position    INTEGER NOT NULL,
  -- Parser-assigned stable key ("w1:d1:e1"), used to match sets across a
  -- re-import of the same plan.
  external_key TEXT   NOT NULL,
  name        TEXT    NOT NULL,
  video_url   TEXT,
  protocol    TEXT,
  comments    TEXT,
  -- How many sets the protocol text asks for, when it could be read.
  planned_set_count INTEGER,
  UNIQUE (day_id, external_key)
);

-- Historical data imported from the "Semana anterior" columns. Template side:
-- it is reference material, not something the user logged in this app.
CREATE TABLE reference_sets (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  exercise_id  BIGINT  NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  set_index    INTEGER NOT NULL,
  weight       NUMERIC(7, 2),
  reps         INTEGER,
  rir          INTEGER,
  UNIQUE (exercise_id, set_index)
);

-- --------------------------------------------------------------- EXECUTION

CREATE TABLE workout_sessions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day_id        BIGINT      NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
  notes         TEXT        NOT NULL DEFAULT '',
  completed     BOOLEAN     NOT NULL DEFAULT FALSE,
  completed_at  TIMESTAMPTZ,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One session per day of a program. Training the same plan again means
  -- importing it again, which creates a new program with its own sessions.
  UNIQUE (day_id)
);

CREATE TABLE session_sets (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  BIGINT  NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id BIGINT  NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  -- 0-based. Indexes at or beyond the template's four slots are sets the
  -- user added during the workout.
  set_index   INTEGER NOT NULL,
  weight      NUMERIC(7, 2),
  reps        INTEGER,
  rir         INTEGER,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, exercise_id, set_index)
);

-- Read paths: load a whole program, and load a day's logged work.
CREATE INDEX idx_weeks_program ON weeks (program_id);
CREATE INDEX idx_days_week ON workout_days (week_id);
CREATE INDEX idx_exercises_day ON exercises (day_id);
CREATE INDEX idx_reference_sets_exercise ON reference_sets (exercise_id);
CREATE INDEX idx_sessions_day ON workout_sessions (day_id);
CREATE INDEX idx_session_sets_session ON session_sets (session_id);
CREATE INDEX idx_session_sets_exercise ON session_sets (exercise_id);

-- Guard rails so a bad write cannot produce impossible training data.
ALTER TABLE session_sets
  ADD CONSTRAINT session_sets_weight_range CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100000)),
  ADD CONSTRAINT session_sets_reps_range   CHECK (reps   IS NULL OR (reps   >= 0 AND reps   <= 999)),
  ADD CONSTRAINT session_sets_rir_range    CHECK (rir    IS NULL OR (rir    >= 0 AND rir    <= 10)),
  ADD CONSTRAINT session_sets_index_range  CHECK (set_index >= 0 AND set_index < 50);

ALTER TABLE reference_sets
  ADD CONSTRAINT reference_sets_index_range CHECK (set_index >= 0 AND set_index < 50);
