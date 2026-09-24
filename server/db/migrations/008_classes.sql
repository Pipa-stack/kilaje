-- 008_classes: el horario de clases del gimnasio y quién se apunta.
--
-- Tres tablas y ningún estado guardado de más.
--
-- `gym_classes` es el horario semanal: "los jueves a las 18:00, Crossfit, 12
-- plazas". Una clase concreta (la del jueves 25) no tiene fila propia: es la
-- pareja (clase, fecha). Guardar cada ocurrencia obligaría a generarlas por
-- adelantado y a mantenerlas cuando el horario cambia.
--
-- `class_bookings` no guarda si una reserva tiene plaza o está en espera. Se
-- deduce del orden de llegada: las `capacity` primeras tienen plaza y el resto
-- espera. Así la lista de espera avanza sola cuando alguien anula — no hay un
-- paso de "promocionar" que pueda fallar a medias — y dos personas pulsando a
-- la vez la última plaza no pueden quedarse las dos con ella: la que llegó
-- después es la primera en espera.
--
-- `class_cancellations` marca una fecha concreta como anulada (un festivo)
-- sin tocar el horario ni borrar las reservas, por si se recupera.

CREATE TABLE gym_classes (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name             TEXT     NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  coach            TEXT     CHECK (coach IS NULL OR length(coach) BETWEEN 1 AND 60),
  -- ISO: 1 = lunes … 7 = domingo, que es lo que devuelve EXTRACT(ISODOW …).
  weekday          SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  -- Hora de pared en el gimnasio, no un instante: una clase a las 18:00 sigue
  -- a las 18:00 cuando cambia la hora en octubre.
  starts_at        TIME     NOT NULL,
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes BETWEEN 10 AND 240),
  capacity         SMALLINT NOT NULL CHECK (capacity BETWEEN 1 AND 200),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gym_classes_weekday ON gym_classes (weekday, starts_at);

CREATE TABLE class_bookings (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id   BIGINT NOT NULL REFERENCES gym_classes(id) ON DELETE CASCADE,
  class_date DATE   NOT NULL,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (class_id, class_date, user_id)
);

-- El orden de llegada es el id: lo asigna una secuencia, así que no empata
-- nunca, cosa que dos `now()` en la misma transacción sí pueden hacer.
CREATE INDEX idx_class_bookings_occurrence ON class_bookings (class_id, class_date, id);
CREATE INDEX idx_class_bookings_date ON class_bookings (class_date);
CREATE INDEX idx_class_bookings_user ON class_bookings (user_id);

CREATE TABLE class_cancellations (
  class_id   BIGINT NOT NULL REFERENCES gym_classes(id) ON DELETE CASCADE,
  class_date DATE   NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, class_date)
);
