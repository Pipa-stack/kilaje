-- 012_tareas_automaticas: lo que el servidor hace solo, sin que nadie pulse nada.

-- Cuándo se hizo por última vez cada tarea. En la base y no en memoria: un
-- despliegue reinicia el proceso, y sin esto cada reinicio mandaría otra copia
-- de seguridad y otra tanda de avisos.
CREATE TABLE job_runs (
  name     TEXT PRIMARY KEY,
  last_run TIMESTAMPTZ NOT NULL
);

-- A qué fecha de cuota corresponde el último aviso de vencimiento que se le
-- mandó. Así se avisa una vez por cada renovación, aunque el servidor esté
-- caído justo el día que tocaba o la tarea se ejecute dos veces.
ALTER TABLE users
  ADD COLUMN fee_reminded_for DATE;
