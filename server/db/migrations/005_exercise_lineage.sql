-- 005_exercise_lineage: follow the same movement across weeks.
--
-- The progress view tracks an exercise from week to week so you can see the
-- load climbing. It matched by NAME, because every week holds its own copy of
-- the plan and therefore its own row and its own id.
--
-- That was fine while the plan was read-only. Now that an exercise can be
-- renamed from the app, matching by name breaks the moment somebody tidies
-- "PRESS MILITAR CON MANCUERNAS" into "PRESS MILITAR": one line becomes two,
-- and the progression it took eight weeks to build disappears from the chart.
--
-- `lineage` is the answer: assigned once, inherited by every clone, and never
-- touched by a rename. Two rows share a lineage when they are the same
-- movement in different weeks.

ALTER TABLE exercises ADD COLUMN lineage TEXT;

-- Backfill: position within the day is exactly how the parser already pairs an
-- exercise with its previous week (see `derivePreviousWeeks`), so using it here
-- keeps the history that exists consistent with how it was being read.
UPDATE exercises e
   SET lineage = 'd' || d.number || ':e' || e.position
  FROM workout_days d
 WHERE d.id = e.day_id
   AND e.lineage IS NULL;

ALTER TABLE exercises ALTER COLUMN lineage SET NOT NULL;

-- Read path: every trend query groups by this within one program.
CREATE INDEX idx_exercises_lineage ON exercises (lineage);
