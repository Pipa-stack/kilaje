# Mejoras de entrenamiento: mejor serie, notas, cronómetro y ranking

Fecha: 2026-09-08
Estado: aprobado, pendiente de plan de implementación

## 1. Por qué

Cuatro peticiones de uso real, más dos extras que salen casi gratis una vez
hecho lo anterior:

1. Poder anotar en **cada ejercicio**, no solo al final de la sesión.
2. Un **cronómetro** de sesión que se pulsa y dice cuánto has tardado.
3. Un **ranking** de ejercicios con tus mejores pesos.
4. **No estimar el RM**: enseñar el mejor peso que has movido de verdad.

La cuarta es la que manda sobre el diseño. Hoy la app calcula un 1RM por
Epley (`epley1RM` en `src/domain/calculations.ts`) y lo enseña en seis sitios.
Un número estimado ocupa el lugar del número real, y el ranking y el aviso de
récord dependen de cuál de los dos sea la verdad. Por eso el 1RM se retira
primero y todo lo demás se construye encima.

## 2. Decisiones

| Tema | Decisión |
|---|---|
| Mejor peso | **Mejor serie real**, mostrada `100 kg × 5`. Gana el peso; las reps desempatan. |
| 1RM estimado | **Se elimina de la aplicación entera**, cliente y servidor. |
| Cronómetro | Empezar / Pausar en la cabecera del día, medido con reloj de pared, **persistido**. |
| Ranking | Pantalla *Mis pesos*: todos los ejercicios, orden por **Peso**, **Progreso** o **Parados**, con buscador. |
| Notas | Dos campos por ejercicio: **ajuste fijo** (por linaje, sigue al movimiento) y **nota de la sesión** (por sesión). |
| Extras | Aviso de récord al anotarlo · Pantalla encendida mientras se entrena. |

### Fuera de alcance (decidido explícitamente)

- **Descanso automático** al anotar las reps. `RestTimer` se queda como está.
- **Notas y duración en el Excel exportado.** Consecuencia asumida: a partir de
  aquí el export de `server/parser/excelExporter.ts` deja de contener todo lo
  que la app sabe. Como el export es el respaldo del proyecto, queda escrito
  aquí para que nadie lo descubra el día que lo necesite.

## 3. El modelo: dos identidades distintas, a propósito

Hay dos formas de decir "el mismo ejercicio" y la spec usa las dos:

- **`lineage`** identifica un movimiento **dentro de un programa**. Es lo que
  hereda cada semana clonada (`server/repositories/weeks.ts:213`) y lo que
  sobrevive a un renombrado.
- **El nombre** es lo único que identifica un movimiento **entre programas
  distintos**, porque `lineage` vale `d1:e1` y se repite en cada importación.
  `loadHistory` ya agrupa por nombre por esta razón.

De ahí que el **ajuste fijo** se guarde por `(program_id, lineage)` — es una
nota sobre cómo montas la máquina en *este* plan — mientras que **Mis pesos**
agrupe por nombre, porque su pregunta abarca todos tus programas.

Que `lineage` sea único solo dentro de un programa es la razón de que la clave
lleve `program_id`: sin él, la nota de sentadilla de un plan aparecería en el
primer ejercicio del primer día de todos los demás.

## 4. Capa 1 — Mejor serie, y fuera Epley

Sin cambios de esquema. Al terminar esta capa la app no estima nada.

### 4.1 Dominio

En `src/domain/calculations.ts`:

```ts
export interface BestSet {
  weight: number;
  /** Puede faltar: una serie con RIR y sin reps sigue siendo trabajo. */
  reps: number | null;
  setIndex: number;
}

/** La mejor serie de las que se hayan trabajado, o null. */
export function bestSet(sets: readonly SetEntry[]): BestSet | null;

/** "100 kg × 5", o "100 kg" cuando no hay reps. */
export function formatBestSet(best: BestSet | null): string;
```

Reglas de `bestSet`, que son la definición de "mejor" para toda la app:

- Solo entran series con `isSetWorked(set)` **y** `weight !== null`. Un peso
  sin reps ni RIR es un plan, no un levantamiento — la distinción ya existe en
  `isSetWorked` y aquí se respeta.
- Gana el peso mayor. Empate: más reps. Empate: la serie más temprana.
- `reps: null` cuenta como 0 reps solo para desempatar; se muestra omitido.

Se **borran**: `epley1RM`, `exercise1RM`, `bestEstimated1RM`, la interfaz
`TopLift`, y los campos `oneRepMax` de `ExerciseProgressRow` y `TrendPoint`.
En su lugar, esas dos estructuras llevan `best: BestSet | null`.

`suggestProgression` **no se toca**: se apoya en el RIR de la semana anterior,
no en el 1RM.

### 4.2 Servidor

- `server/repositories/history.ts`: `HistoryEntry.oneRepMax` →
  `HistoryEntry.best: BestSet | null`; `ExerciseHistory.bestOneRepMax` →
  `bestSet: BestSet | null` (la mejor de todas sus sesiones). El fichero deja
  de importar `epley1RM`.
- `server/repositories/profile.ts`: `PersonalRecord.oneRepMax` → `best`, y el
  `.sort()` de récords pasa a ordenar por `best.weight`.

### 4.3 Interfaz

| Fichero | Cambio |
|---|---|
| `ExerciseCard.tsx:165` | La estadística "1RM est." pasa a **"Mejor serie"**, con la mejor del linaje en todo el programa, **incluida la semana en curso**. |
| `HomeScreen.tsx:98` | "Mejor 1RM" → "Mejor serie" de la semana. |
| `ProgressScreen.tsx:106,167` | Igual, en la cabecera y en cada fila de la tabla. |
| `HistoryScreen.tsx:125,160-194` | Las barras pasan a medir peso de la mejor serie; el % de mejora se calcula sobre ese peso. |
| `ProfileScreen.tsx:150,182` | El texto deja de decir "1RM estimado"; el número es la mejor serie. |
| `SettingsScreen.tsx:188` | Se reescribe la explicación de las fórmulas: fuera Epley. |

### 4.4 Aviso de récord

`ExerciseCard` recibe una prop nueva `personalBest: BestSet | null`: la mejor
serie de ese linaje **excluyendo la semana en curso**. Cuando una serie escrita
hoy la supera, la fila la marca con una estrella y el texto `Récord — antes
100 × 5`.

Se calcula una sola vez por programa, no por pulsación: un `useMemo` en el
dueño del estado produce un `Map<lineage, BestSet>` y cada tarjeta lee el suyo.

Son dos números con dos preguntas distintas, y por eso se calculan distinto:
la estadística del pie de la tarjeta responde *"¿cuánto es lo más que he
movido aquí?"* e incluye lo de hoy; `personalBest` responde *"¿lo de hoy es
mejor que todo lo anterior?"* y por fuerza excluye hoy. Sin esa exclusión, la
primera serie del día se declararía récord de sí misma en cuanto la teclearas.

## 5. Capa 2 — Notas por ejercicio

### 5.1 Migración `006_exercise_notes.sql`

```sql
-- El ajuste fijo: cómo montas ese movimiento en este plan.
CREATE TABLE exercise_setups (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  program_id  BIGINT      NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  lineage     TEXT        NOT NULL,
  note        TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (program_id, lineage),
  CONSTRAINT exercise_setups_note_length CHECK (length(note) <= 1000)
);

-- La nota de hoy: lado de ejecución, muere con la sesión que la vio.
CREATE TABLE session_exercise_notes (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id  BIGINT      NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id BIGINT      NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  note        TEXT        NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, exercise_id),
  CONSTRAINT session_exercise_notes_length CHECK (length(note) <= 1000)
);

CREATE INDEX idx_exercise_setups_program ON exercise_setups (program_id);
CREATE INDEX idx_session_exercise_notes_session ON session_exercise_notes (session_id);
```

Las dos tablas caen a cada lado de la línea que `001_init.sql` dibuja:
`exercise_setups` es plantilla, `session_exercise_notes` es ejecución. Ninguna
reescribe a la otra, igual que el resto del esquema.

Una fila vacía no se guarda: borrar el texto borra la fila.

### 5.2 Modelo y API

`src/domain/types.ts`, en `Exercise`:

```ts
  /** Del Excel del entrenador. Ya existía; no se toca. */
  comments: string | null;
  /** Ajuste fijo escrito por el usuario. Sigue al linaje. */
  setup: string | null;
  /** Nota de esta semana. "" cuando no hay ninguna. */
  notes: string;
```

Mutaciones nuevas en `src/domain/mutations.ts`, del mismo corte inmutable que
las que ya hay: `setExerciseSetup` y `setExerciseNotes`.

Endpoints, siguiendo el patrón de los ya existentes en `server/api/router.ts`:

- `PUT /api/programs/:programId/exercises/:exerciseId/setup` — cuerpo
  `{ note: string }`, máx. 1000. Escribe por `(program_id, lineage)`, de modo
  que **afecta a todas las semanas del programa**, que es exactamente lo que
  "fijo" promete.
- `PUT /api/sessions/:sessionId/exercises/:exerciseId/note` — cuerpo
  `{ note: string }`, máx. 1000.

Ambos validan con Zod en `server/api/schemas.ts` (`.strict()`, como el resto) y
pasan por el outbox de `src/storage/outbox.ts` para funcionar sin cobertura.

### 5.3 Interfaz

En `ExerciseCard`, debajo de la cabecera y encima de las series, el ajuste fijo
(icono ⚙, una línea, se despliega al pulsar). Debajo de las series, la nota de
hoy (icono ✎). La nota del entrenador (`comments`) se queda donde está y con
su aspecto actual: es de otra persona y no debe confundirse con las tuyas.

"Ver semana anterior" pasa a mostrar también la nota de aquella semana, si la
hubo. Es donde de verdad sirve: al lado de los pesos que explica.

## 6. Capa 3 — Cronómetro de sesión y pantalla encendida

### 6.1 Migración `007_session_timer.sql`

```sql
ALTER TABLE workout_sessions
  ADD COLUMN elapsed_seconds  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN timer_started_at TIMESTAMPTZ;

ALTER TABLE workout_sessions
  ADD CONSTRAINT workout_sessions_elapsed_range
  CHECK (elapsed_seconds >= 0 AND elapsed_seconds <= 86400);
```

Dos campos, no uno: `elapsed_seconds` es el tiempo ya acumulado y
`timer_started_at` el instante del arranque actual. El cronómetro corre si y
solo si `timer_started_at IS NOT NULL`, y lo que se muestra es
`elapsed_seconds + (ahora − timer_started_at)`.

Se mide contra un instante y no contando intervalos por la misma razón que
`RestTimer` ya lo hace: un móvil que se duerme a mitad de la sesión vuelve con
el número correcto, y un contador de `setInterval` no.

**El acumulado lo calcula el cliente**, y el servidor lo valida contra el rango.
Sellarlo en el servidor rompería el modo sin conexión: una pausa reenviada
media hora tarde por el outbox se guardaría como media hora más de
entrenamiento. El usuario puede mentir sobre su propio cronómetro; no hay a
quién engañar.

### 6.2 API

`sessionPatchBody` en `server/api/schemas.ts` admite dos campos más:

```ts
  elapsedSeconds: z.number().int().min(0).max(86_400).optional(),
  timerRunning: z.boolean().optional(),
```

`timerRunning: true` escribe `timer_started_at = now()`; `false` lo pone a
`NULL`. El `.refine()` que exige al menos un campo se amplía a los nuevos.

### 6.3 Interfaz

- Componente `SessionTimer`, en la tarjeta de resumen del día
  (`DayView.tsx`), junto al volumen: tiempo grande, botón **Empezar** /
  **Pausar**. Formato `42:15`, y `1h 12min` cuando pasa de la hora.
- **Completar sesión** para el cronómetro si estaba en marcha.
- **Vaciar los datos del día** (`resetDay`) pone el acumulado a cero: es parte
  de lo anotado ese día.
- **Cronómetro olvidado**: si al abrir un día lleva corriendo más de 4 horas,
  no se suma en silencio. Se pausa y se avisa: *"El cronómetro llevaba
  corriendo desde ayer. ¿Lo guardo o lo descarto?"*. Es el fallo más probable
  de un botón que se pulsa con prisa, y sumarlo estropearía la media.
- **Duración media** entra en la sección "En total" de `ProfileScreen`,
  calculada solo sobre sesiones completadas con duración > 0.

### 6.4 Pantalla encendida

Hook `useWakeLock(active: boolean)` en `src/ui/hooks/`, activo mientras el
cronómetro corre. Usa `navigator.wakeLock.request('screen')`, lo suelta al
pausar o al desmontar, y lo vuelve a pedir en `visibilitychange` — el navegador
lo retira solo al pasar a segundo plano. Todo dentro de `try/catch`: donde no
exista la API, no pasa nada. Igual que `alertDone` en `RestTimer`, es un extra
que nunca puede tumbar la sesión.

## 7. Capa 4 — Pantalla *Mis pesos*

### 7.1 Endpoint

`GET /api/profile/lifts`, construido sobre `loadHistory` (que ya agrupa por
nombre y ya está limitado a 20 000 filas):

```ts
interface Lift {
  exercise: string;
  best: { weight: number; reps: number | null; performedAt: string };
  /** Mejor serie de la última sesión menos la de la primera. */
  gainKg: number | null;
  sessions: number;
  lastTrainedAt: string;
  weeksSince: number;
}
```

`gainKg` compara **primera sesión contra última**, no contra el máximo
histórico: mide hacia dónde va el ejercicio, y por eso puede ser negativo. Es
`null` con una sola sesión, porque una sesión no es una tendencia — el mismo
criterio que ya sigue `exerciseTrends` con `weightGain`.

### 7.2 Interfaz

`LiftsScreen`, alcanzada desde la pestaña **Perfil**. La `BottomNav` no cambia:
cuatro pestañas siguen siendo las que caben bien bajo un pulgar.

- Buscador por nombre.
- Tres órdenes: **Peso** (`best.weight` desc), **Progreso** (`gainKg` desc,
  los `null` al final), **Parados** (`weeksSince` desc).
- Cada fila: nombre, mejor serie, ganancia con signo, y cuándo fue.
- Sin datos: el mismo mensaje que ya usa Récords personales.

En `ProfileScreen`, "Récords personales" se queda como resumen de los 5
primeros y gana un botón **Ver todos mis pesos** que abre esta pantalla.

## 8. Pruebas

TDD en las cuatro capas. `vitest`, y siempre con `--maxWorkers=2`: sin ese
límite la suite se queda sin memoria en esta máquina.

- **Dominio** (`bestSet`): peso máximo gana; reps desempatan; una serie con
  peso y sin reps ni RIR no cuenta; sin series trabajadas devuelve `null`; una
  serie con RIR y sin reps sí cuenta y se muestra sin el `× n`.
- **Récord**: la serie de hoy no es récord de sí misma; superar el máximo de
  semanas anteriores sí lo marca.
- **Migraciones**: aplicadas sobre PGlite, tabla vacía y una con datos.
- **Notas**: el ajuste fijo escrito en una semana se lee desde todas las del
  programa y **no** aparece en otro programa con el mismo linaje; la nota de
  sesión no cruza de semana; texto vacío borra la fila.
- **Cronómetro**: acumular sobre pausas sucesivas; `resetDay` lo pone a cero;
  completar la sesión lo detiene; `elapsedSeconds` fuera de rango se rechaza
  con 400; el caso de las 4 horas se pausa en vez de sumarse.
- **Endpoints**: los tres nuevos, con y sin sesión iniciada, y con cuerpos
  inválidos.

## 9. Riesgos

- **Cliente antiguo tras retirar `oneRepMax`.** La app abre sin conexión, así
  que un móvil con la versión anterior en caché puede recibir respuestas ya sin
  ese campo y pintar un hueco. No corrompe nada y se arregla al recargar. Se
  asume; se menciona porque es la única incompatibilidad del cambio.
- **El tope de 20 000 filas de `loadHistory`** lo hereda *Mis pesos*. Hoy sobra
  de largo, pero es el límite real de la pantalla y conviene saberlo.
- **Dos identidades conviviendo** (linaje dentro del programa, nombre entre
  programas). Está justificado en §3; el riesgo es que alguien "unifique" las
  dos más adelante sin leer por qué son distintas.
- **El Excel exportado se queda corto** respecto a lo que la app guarda, por
  decisión explícita. Ver §2.

## 10. Criterios de aceptación

1. Una búsqueda de `epley` o `1RM` en `src` y `server` no devuelve nada.
2. Cada ejercicio admite un ajuste fijo que se ve igual en todas las semanas
   del programa, y una nota que solo pertenece a esa semana.
3. El cronómetro sobrevive a cerrar la app y a recargarla, y la sesión
   completada guarda su duración.
4. *Mis pesos* lista todos los ejercicios entrenados, ordenables de tres formas
   y filtrables por nombre.
5. Anotar una serie que supera tu marca lo dice en el momento.
6. La pantalla no se apaga mientras el cronómetro corre.
7. `npm run typecheck`, `npm run lint` y `npm test -- --maxWorkers=2` en verde.
