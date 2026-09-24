-- 009_horario_inicial: el horario con el que abre el gimnasio.
--
-- Lunes a viernes, turnos de 1 h 30 con 7 plazas: mañana de 6:30 a 12:30 y
-- tarde de 15:00 a 21:00. Va en una migración porque la base de producción no
-- se alcanza desde fuera; a partir de aquí se cambia desde «Editar horario».
--
-- No duplica: si ya hay una clase ese día a esa hora, esa franja se salta.

INSERT INTO gym_classes (name, coach, weekday, starts_at, duration_minutes, capacity)
SELECT 'Turno', NULL, d.weekday, t.starts_at, 90, 7
  FROM generate_series(1, 5) AS d(weekday)
 CROSS JOIN (VALUES
   (TIME '06:30'), (TIME '08:00'), (TIME '09:30'), (TIME '11:00'),
   (TIME '15:00'), (TIME '16:30'), (TIME '18:00'), (TIME '19:30')
 ) AS t(starts_at)
 WHERE NOT EXISTS (
   SELECT 1 FROM gym_classes g
    WHERE g.weekday = d.weekday AND g.starts_at = t.starts_at
 )
 ORDER BY d.weekday, t.starts_at;
