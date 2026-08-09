-- 004_simplify_profile: quita del perfil lo que no se usaba.
--
-- El gimnasio y el peso corporal se añadieron en 003 y sobran: el perfil
-- existe para enseñar lo que has levantado, no para pedir datos que nadie
-- vuelve a mirar. La unidad kg/lb se va con ellos porque solo servía para
-- mostrar el peso corporal; los pesos de entrenamiento vienen del Excel en
-- kilos y siempre se quedaron en kilos.
--
-- Se borra en lugar de dejarlo muerto: una columna que nadie escribe es una
-- pregunta para quien lea esto dentro de seis meses.
--
-- 003 no se toca. Una migración aplicada no se edita nunca; se corrige con
-- otra.

DROP TABLE IF EXISTS body_weights;

ALTER TABLE users
  DROP COLUMN IF EXISTS gym,
  DROP COLUMN IF EXISTS weight_unit;
