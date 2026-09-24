-- 011_asistencia_cuotas_avisos: lo que le faltaba al día a día del gimnasio.
--
-- Tres cosas pequeñas, como las traen GYM-One o wger en su forma más simple:

-- Asistencia. Nulo mientras nadie lo ha marcado: "sin marcar" no es "faltó",
-- y contarlo como falta llenaría de ausencias a quien no pasa lista.
ALTER TABLE class_bookings
  ADD COLUMN attended BOOLEAN;

-- Cuota: hasta qué día tiene pagado. Nulo es "no se lleva control", no
-- "vencida": empezar a usar las cuotas no puede dejar sin reservar a todos
-- los socios a los que aún no se les ha puesto fecha. Sin cobros: el dinero
-- se sigue cobrando en recepción, aquí solo se apunta.
ALTER TABLE users
  ADD COLUMN paid_until DATE;

-- Avisos para todos los socios: un cierre, un cambio de horario.
CREATE TABLE announcements (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message    TEXT   NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
