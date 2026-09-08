-- 007_session_timer: cuánto dura la sesión.
--
-- Dos columnas y no una. `elapsed_seconds` es el tiempo ya acumulado y
-- `timer_started_at` el instante del arranque actual; el cronómetro corre si y
-- solo si `timer_started_at` no es nulo, y lo que se enseña es
-- `elapsed_seconds + (ahora - timer_started_at)`.
--
-- Se mide contra un instante en vez de contar intervalos por la misma razón
-- que el cronómetro de descanso ya lo hace: un móvil que se duerme entre serie
-- y serie vuelve con el número correcto, y un contador no.
--
-- El acumulado lo calcula el cliente y aquí solo se valida. Sellarlo en el
-- servidor rompería el modo sin conexión: una pausa reenviada media hora tarde
-- por la cola de escrituras se guardaría como media hora más de entrenamiento.

ALTER TABLE workout_sessions
  ADD COLUMN elapsed_seconds  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN timer_started_at TIMESTAMPTZ;

-- 24 h. Muy por encima de cualquier sesión y muy por debajo de lo que haría
-- falta para que un número absurdo pase por bueno.
ALTER TABLE workout_sessions
  ADD CONSTRAINT workout_sessions_elapsed_range
  CHECK (elapsed_seconds >= 0 AND elapsed_seconds <= 86400);
