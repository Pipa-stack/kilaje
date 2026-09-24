-- 010_roles: socios y administradores.
--
-- Dos roles, como la mayoría de apps de gimnasio en su forma más simple
-- (Trainerize, Virtuagym): quien entrena y quien lleva el gimnasio. Un
-- administrador ve a todos los socios, les sube el planning con la misma
-- plantilla de Excel, sigue su progreso y gestiona las clases.
--
-- Los correos de `ADMIN_EMAILS` son además *propietarios*: administradores
-- siempre, sin fila que los diga y sin forma de degradarlos desde la app.
-- Así nadie puede dejar el gimnasio sin nadie al mando por un toque mal dado.

ALTER TABLE users
  ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin'));

-- Quién subió el programa cuando no fue su dueño: "te lo ha puesto tu
-- entrenador". Nulo en los que cada uno importa o crea para sí.
ALTER TABLE programs
  ADD COLUMN assigned_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
