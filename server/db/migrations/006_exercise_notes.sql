-- 006_exercise_notes: dos notas por ejercicio, de naturalezas distintas.
--
-- Hasta ahora solo se podía escribir al final de la sesión, en un único campo
-- para todo el día. Pero lo que uno quiere apuntar es casi siempre sobre un
-- ejercicio concreto, y hay dos cosas que apuntar:
--
--   EL AJUSTE FIJO   "banco pin 4, agarre ancho". No cambia de una semana a
--                    otra: describe cómo se monta el movimiento.
--   LA NOTA DE HOY   "el hombro derecho tocado". Pertenece a la sesión que la
--                    vio y no debe seguirte a la semana siguiente.
--
-- Por eso son dos tablas y caen a cada lado de la línea que dibuja 001_init:
-- el ajuste es plantilla, la nota es ejecución. Ninguna reescribe a la otra.
--
-- `exercises.comments` no se toca: esa es la nota del entrenador, viene del
-- Excel y no es del usuario.

-- ---------------------------------------------------------------- PLANTILLA

-- La clave lleva el programa además del linaje. `lineage` identifica un
-- movimiento dentro de un programa, pero vale 'd1:e1' y se repite en cada
-- importación: sin el program_id, el ajuste de la sentadilla de un plan
-- aparecería en el primer ejercicio del primer día de todos los demás.
--
-- Atarlo al linaje y no a la fila del ejercicio es lo que hace que "fijo"
-- signifique fijo: al clonar una semana el linaje se hereda (ver
-- `appendWeek`), así que la nota viaja sola a la semana nueva y corregirla en
-- la semana 5 la corrige también en la 1.
CREATE TABLE exercise_setups (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id  BIGINT      NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  lineage     TEXT        NOT NULL,
  note        TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (program_id, lineage),
  CONSTRAINT exercise_setups_note_length CHECK (char_length(note) <= 1000)
);

-- ---------------------------------------------------------------- EJECUCIÓN

CREATE TABLE session_exercise_notes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  BIGINT      NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id BIGINT      NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  note        TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, exercise_id),
  CONSTRAINT session_exercise_notes_length CHECK (char_length(note) <= 1000)
);

CREATE INDEX idx_exercise_setups_program ON exercise_setups (program_id);
CREATE INDEX idx_session_exercise_notes_session ON session_exercise_notes (session_id);
