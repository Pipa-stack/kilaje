# Gimnasio — gym-excel-app

Convierte una plantilla Excel de entrenamiento en una app web simple, mobile-first y
usable **durante** el entrenamiento, con los datos guardados en PostgreSQL.

```
Excel → parser (servidor) → modelo normalizado → PostgreSQL → API → app
```

No copia la hoja de cálculo: la reemplaza por tarjetas de ejercicio con inputs grandes
para peso, reps y RIR, y calcula volumen, 1RM y progresión con las mismas fórmulas que
el Excel original.

**En producción:** <https://gym-excel-app-production.up.railway.app>

Al abrir la app aparece el programa ya almacenado. No hace falta subir el Excel cada vez.

## La app

Cuatro secciones, con navegación inferior al alcance del pulgar:

| Sección | Qué hay |
|---|---|
| **Inicio** | Resumen de la semana (volumen, sesiones, ejercicios, mejor 1RM), botón grande de *continuar/empezar* con la sesión que toca, y la lista de sesiones con su estado |
| **Entrenar** | Temporizador de descanso, resumen del día y las tarjetas de ejercicio con inputs grandes de peso/reps/RIR, vídeo, protocolo, notas y completar sesión |
| **Progreso** | Volumen por sesión, comparación con la semana anterior y tabla de ejercicios entrenados con su volumen, tope y 1RM |
| **Ajustes** | Importar otro Excel, cambiar entre programas guardados, borrarlos y ver qué hace la app con tus datos |

El estado de cada sesión (pendiente / en curso / completada) nunca se indica solo con
color: la palabra lo dice.

### Cálculo de discos

Escribes 82.5 kg y debajo del campo aparece **qué poner en cada lado de la barra**:
`25 + 5 + 1.25`, con los discos dibujados en los colores de competición IPF (25 rojo,
20 azul, 15 amarillo, 10 verde, 5 blanco, 2.5 rojo, 1.25 cromado). Es la cuenta que todo
levantador hace entre series y falla cuando está cansado; la app ya sabe el peso, así que
la hace ella.

No aparece cuando el peso está por debajo de la barra: una polea o una mancuerna registran
un peso que no tiene discos, y adivinar sería peor que callarse. Si algo no cuadra con los
discos disponibles lo dice (`+0.5 sin cuadrar`) en vez de redondearlo a escondidas.

### Sistema visual

- **Color:** hierro fundido pintado, con un matiz verde-gris en cada paso, para que las
  superficies se lean como material y no como ausencia de luz. Un solo acento: **amarillo
  de competición**, el más legible con mala luz de gimnasio. El rojo queda reservado para
  esfuerzo y fallo, nunca para decorar.
- **Tipografía:** **Barlow Condensed** para cifras y titulares, **Barlow** para texto.
  Contraste por anchura, no por familia. Autoalojadas en `public/fonts/` (subconjunto
  latino, ~110 kB): la CSP es `default-src 'self'` y bloquearía un CDN, que además filtraría
  la IP de quien usa la app y retrasaría el primer pintado.
- **Iconos:** SVG propios sobre rejilla de 24 px, un solo grosor de trazo, heredan el color
  del texto. Cero emoji: se dibujan distinto en cada sistema y no heredan color ni peso.

---

## Arquitectura

```
Navegador (React + TypeScript)
      │  fetch /api/...
      ▼
Express (mismo servicio, mismo origen)
      │  SQL parametrizado (pg)
      ▼
PostgreSQL (Railway)
```

Un solo servicio sirve la API y el build del frontend: un origen, sin CORS, sin proxy y
sin más piezas de las necesarias. No hay Redis, ni colas, ni autenticación.

```
src/                        FRONTEND + dominio compartido
  domain/
    types.ts                Modelo normalizado (Program, Week, Day, Exercise, SetEntry)
    calculations.ts         1RM, volumen, progresión, formato — funciones puras
    mutations.ts            Actualizaciones inmutables del programa
    upload.ts               Límites de subida compartidos con el servidor
  api/client.ts             Cliente tipado de la API
  storage/storage.ts        Caché offline en localStorage
  ui/
    App.tsx                 Composición y pestañas
    hooks/useProgram.ts     Estado + API + caché offline
    components/             HomeScreen, DayView, ProgressScreen, SettingsScreen,
                            BottomNav, RestTimer, ExerciseCard, NumberField…

server/                     BACKEND
  index.ts                  Arranque: migra, siembra (opcional) y sirve
  app.ts                    Express: cabeceras, API y estáticos
  api/
    router.ts               Endpoints
    schemas.ts              Validación de entrada (zod)
  db/
    database.ts             Adaptador PostgreSQL (pg) / PGlite
    migrate.ts              Ejecutor de migraciones
    migrations/001_init.sql Esquema
    seed.ts                 Importación del libro de referencia
  parser/                   xlsx → modelo normalizado (solo servidor)
  scripts/                  CLIs de migración y seed

tests/                      205 tests
```

**Reglas de arquitectura, comprobadas por `tests/architecture.test.ts`:** solo
`server/parser/**` conoce filas y columnas o importa `xlsx`; solo `server/db/**` y
`server/repositories/**` contienen SQL; solo `src/storage/**` toca `localStorage`;
`domain/` no importa React; nada usa `eval`; no hay credenciales literales en el código;
no hay ningún nombre de ejercicio codificado.

### Por qué el parser está en el servidor

Antes se ejecutaba en el navegador. Se movió al servidor por dos motivos concretos:

1. **La base de datos nunca recibe un modelo construido por el cliente.** El navegador
   sube los bytes; el servidor los interpreta. No hay que confiar en un `Program` que
   podría venir manipulado.
2. **SheetJS (~370 kB) desaparece del bundle.** El cliente pasó de 593 kB a 221 kB
   (69 kB gzip).

---

## Modelo de datos

Las dos mitades están separadas y **no se mezclan**. Una importación nunca escribe en la
ejecución, y entrenar nunca reescribe la plantilla. Eso es lo que permite reimportar un
plan sin destruir el historial.

### Plantilla — lo que viene del Excel

| Tabla | Contenido |
|---|---|
| `programs` | Programa importado: nombre, fichero de origen, `source_hash`, versión, fecha |
| `weeks` | Semanas del programa (hoja `Semana N`) |
| `workout_days` | Días y su tipo (`PUSH`, `LEG (CADENA ANTERIOR)`…) |
| `exercises` | Nº, nombre, vídeo, protocolo, comentarios, nº de sets previstos |
| `reference_sets` | Datos históricos importados de las columnas «Semana anterior» |

### Ejecución — lo que introduce el usuario

| Tabla | Contenido |
|---|---|
| `workout_sessions` | Una por día: notas, completada, `completed_at`, `started_at`, `updated_at` |
| `session_sets` | Peso, reps, RIR por serie, con `performed_at` y `updated_at` |

Más `schema_migrations`, que registra las migraciones aplicadas.

**Un detalle que decide el diseño:** los valores de la columna «Semana actual» que ya
venían escritos en el Excel son *trabajo realizado*, no plan. Al importar se siembran en
`session_sets`, no en la plantilla.

`session_sets` guarda solo las series con datos: las cuatro ranuras vacías de la
plantilla no ocupan filas, y los índices ≥ 4 son series que el usuario añadió durante el
entrenamiento.

### Versionado e identificación

- Cada importación **inserta un programa nuevo**; ninguno existente se modifica. Los
  programas anteriores y todas sus sesiones quedan intactos.
- `source_hash` es el SHA-256 del fichero, con índice único. Subir dos veces el mismo
  archivo devuelve el programa que ya existe (HTTP 200 en vez de 201) en lugar de
  duplicarlo — eso cubre el doble clic y el reintento de una petición.
- `version` se incrementa por `source_file_name`, así que el segundo `ejemplo.xlsx` se
  llama `ejemplo (v2)`.
- La app tiene un selector para moverse entre programas guardados.

---

## API

Todos los endpoints validan su entrada con zod y devuelven `{ error }` en caso de fallo.
Las restricciones `CHECK` de la base de datos son la segunda barrera, no la primera.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/health` | Comprueba que la base de datos responde |
| `GET` | `/api/programs` | Lista los programas, el más reciente primero |
| `GET` | `/api/programs/latest` | El último importado (lo que abre la app) |
| `GET` | `/api/programs/:id` | Un programa completo: semanas, días, ejercicios y series |
| `POST` | `/api/programs` | Importa un `.xlsx` (bytes en crudo, `?filename=`) |
| `DELETE` | `/api/programs/:id` | Borra un programa y todo lo entrenado en él |
| `PUT` | `/api/days/:dayId/sets` | Guarda una serie (`exerciseId`, `setIndex`, peso, reps, RIR) |
| `DELETE` | `/api/days/:dayId/sets` | Elimina una serie |
| `PATCH` | `/api/days/:dayId/session` | Notas y/o sesión completada |
| `DELETE` | `/api/days/:dayId/session` | Vacía lo entrenado ese día, sin tocar la plantilla |

Códigos: `400` entrada inválida, `404` no existe o no corresponde, `413` fichero
demasiado grande, `422` el `.xlsx` no es la plantilla, `500` error interno (sin detalles).

---

## Instalación y desarrollo local

Necesitas Node 20+ y un PostgreSQL accesible.

```bash
git clone https://github.com/Pipa-stack/gym-excel-app.git
cd gym-excel-app
npm install
cp .env.example .env          # y edita DATABASE_URL
npm run db:migrate            # crea el esquema
npm run db:seed               # opcional: importa Ejemplo/ejemplo.xlsx
```

Dos procesos en desarrollo:

```bash
npm run dev:server            # API en :8080, con recarga
npm run dev                   # UI en :5173, con proxy de /api a :8080
```

O un solo proceso, como en producción:

```bash
npm run build && npm start    # sirve API + dist en $PORT (8080 por defecto)
```

### Variables de entorno

| Variable | Obligatoria | Para qué |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión a PostgreSQL |
| `PORT` | No | Puerto del servidor (Railway lo inyecta; 8080 por defecto) |
| `SEED_REFERENCE_PROGRAM` | No | `true` importa el libro de referencia al arrancar si no hay programas |
| `SEED_WORKBOOK` | No | Ruta alternativa del libro para `npm run db:seed` |
| `API_PROXY_TARGET` | No | A dónde manda `/api` el servidor de desarrollo |
| `TEST_DATABASE_URL` | No | Ejecuta los tests contra un PostgreSQL real en lugar de PGlite |

Ninguna credencial vive en el repositorio. Ver [`.env.example`](.env.example).

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo del frontend |
| `npm run dev:server` | API con recarga automática |
| `npm run build` | Build de producción en `dist/` |
| `npm start` | Migra y sirve API + frontend en `$PORT` |
| `npm run db:migrate` | Aplica las migraciones pendientes |
| `npm run db:seed` | Importa el libro de referencia (`--force` para repetir) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Los 205 tests |
| `npm run test:coverage` | Cobertura de `domain/`, `parser/` y `storage/` |

---

## Base de datos y migraciones

Las migraciones son `.sql` en `server/db/migrations/`, aplicadas en orden alfabético y
registradas en `schema_migrations`. Cada una corre en su propia transacción, así que un
fallo a mitad no deja nada a medias.

- **El esquema se puede recrear desde cero** con `npm run db:migrate` sobre una base de
  datos vacía. Hay un test que lo comprueba.
- El servidor **migra al arrancar**, así que un despliegue nunca requiere un paso manual.
- Nada se modifica a mano desde el panel de Railway.

Para añadir un cambio: crea `server/db/migrations/002_lo_que_sea.sql`. No edites una
migración ya aplicada.

---

## Importación del Excel

1. Arrastras el `.xlsx` (o lo eliges) en la app.
2. Se suben los bytes a `POST /api/programs`.
3. El servidor lo parsea, lo normaliza y lo guarda en PostgreSQL.
4. La app muestra el programa.

El parser se ancla a **etiquetas de texto**, nunca a coordenadas fijas, así que una copia
con una fila o columna insertada sigue funcionando. No hay ni un nombre de ejercicio
codificado (hay un test que lo verifica).

Qué se lee de cada hoja `Semana N`:

| Del Excel | En la app |
|---|---|
| `DÍA n` + tipo (`PUSH`, `PULL`…) | Cabecera del día |
| Nº y nombre del ejercicio | Título de la tarjeta |
| `📹 Vídeo` | Botón ▶ (solo enlaces `http(s)`) |
| `Protocolo` | Subtítulo de la tarjeta |
| `Comentarios` | Nota del ejercicio |
| `← Semana anterior` (S1–S4: peso/reps/RIR) | Referencia bajo cada input + panel desplegable |
| `Semana actual` (S1–S4: peso/reps/RIR) | Inputs editables (se siembran como trabajo hecho) |
| `1RM est.`, `Volumen día`, `📈 Progresión` | Recalculados en vivo |
| `📝 Notas de sesión` | Campo de notas |
| `✅ Sesión completada` | Botón de completar |

Si el libro trae varias hojas `Semana N` se importan todas, y la semana anterior de cada
una se deriva de la previa cuando esas columnas están vacías.

### Las fórmulas

Reproducidas del Excel como funciones puras en `src/domain/calculations.ts`:

| Cálculo | Fórmula |
|---|---|
| **1RM estimado** (Epley, serie 1) | `ROUND(peso × (1 + reps / 30), 1)` |
| **Volumen del ejercicio** | `Σ peso × reps` sobre las series (vacío = 0) |
| **Volumen del día** | Suma de los volúmenes de sus ejercicios |
| **Progresión** | Sin peso previo → `—`; RIR previo 0 → igual; 1 → +2.5 kg; ≥2 o vacío → +5 kg. Redondeado al múltiplo de 2.5 kg |

Dos detalles que importan:

- **`ROUND` de Excel redondea *half away from zero*** y `Math.round` de JS no
  (`Math.round(-2.5) === -2` frente a `ROUND(-2.5,0) === -3`). De ahí `excelRound`, con
  tests de casos límite.
- **El libro de referencia tiene fórmulas rotas** (filas 78–82: `#REF!` y referencias
  desplazadas). El parser **ignora las fórmulas** y recalcula desde los valores, así que
  la app corrige el fallo de la plantilla en lugar de heredarlo.

---

## Persistencia y modo offline

PostgreSQL es la fuente de verdad. `localStorage` se mantiene como **caché offline**:

- Cada edición se aplica al estado local al instante y se envía a la API justo después,
  así que la interfaz nunca va por detrás del dedo entre series.
- Si el servidor no responde, la app avisa y muestra el último entrenamiento conocido en
  lugar de una pantalla vacía.
- Una caché escrita por la versión anterior (solo localStorage) se descarta: no puede
  reconciliarse con la API y mostrarla como si pudiera sería mentir.

---

## Tests

```bash
npm test                      # 205 tests, contra PGlite
TEST_DATABASE_URL=... npm test # los mismos, contra un PostgreSQL real
```

| Fichero | Cubre |
|---|---|
| `calculations.test.ts` | Todas las fórmulas, con los casos límite del Excel |
| `excelParser.test.ts` | **El fichero real**: días, ejercicios, protocolos, el dato sembrado (82.5 kg × 4), multi-semana, columnas desplazadas, entradas inválidas |
| `api.test.ts` | Migraciones, importación, versionado, anti-duplicados, guardar/leer/borrar series, sesiones, notas, aislamiento de datos, validación, cabeceras, seed |
| `storage.test.ts` | Caché offline, JSON corrupto, `localStorage` bloqueado, prototype pollution |
| `mutations.test.ts` | Edición de series, inmutabilidad, parseo de lo tecleado |
| `integration.test.tsx` | El flujo completo en React contra un servidor real por HTTP: importar → entrenar → guardar → recargar → reimportar → offline |
| `architecture.test.ts` | Los límites entre capas y las reglas de seguridad |

Los tests de servidor usan **PGlite** (PostgreSQL compilado a WASM): semántica real de
Postgres, con las migraciones de producción, sin servidor ni Docker. Los de integración
arrancan un Express real en `globalSetup.ts` y hablan con él por HTTP: no hay `fetch`
simulado.

Los tests del parser leen el Excel real, no un fixture sintético: el riesgo que importa
es que el fichero de verdad no coincida con nuestra lectura de él.

---

## Seguridad

- El `.xlsx` es entrada no confiable: se valida extensión y tamaño (máx. 10 MB) en cliente
  **y** servidor, y las fórmulas **nunca se evalúan**.
- Todos los cuerpos de petición se validan con zod en modo `strict`: un campo desconocido
  se rechaza, no se ignora. Los rangos coinciden con los `CHECK` de la base de datos.
- Antes de escribir una serie se comprueba que el ejercicio **pertenece a ese día**, así
  que un id manipulado no puede escribir en el programa de otro.
- SQL siempre parametrizado (`$1`, `$2`…). Un test prohíbe interpolar variables en
  consultas.
- El nombre del fichero subido se sanea antes de guardarlo o devolverlo: sin rutas, sin
  caracteres de control, sin nada que pueda leerse como marcado.
- Los enlaces de vídeo solo se renderizan con esquema `http:` o `https:`; se bloquean
  `javascript:` y `data:`. Se abren con `rel="noopener noreferrer"`.
- Nada de `dangerouslySetInnerHTML` ni `eval` (comprobado por test).
- CSP restrictiva más `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y
  `Permissions-Policy` en todas las respuestas. Sin `X-Powered-By`.
- Los errores internos se registran en el servidor pero nunca se devuelven: una traza o
  un mensaje del driver revelaría el esquema.
- Credenciales solo por variables de entorno. Un test prohíbe cadenas de conexión
  literales en el código.
- `npm audit`: 0 vulnerabilidades. SheetJS se instala desde el CDN oficial del proveedor
  (`cdn.sheetjs.com`), porque la última versión en npm (`0.18.5`) arrastra dos advisories
  sin parchear.

---

## GitHub y CI

Repositorio: <https://github.com/Pipa-stack/gym-excel-app> (rama `main`).

`.github/workflows/ci.yml` se ejecuta en cada push y PR con dos jobs:

1. **verify** — `install → typecheck → lint → test → build`, y sube `dist/` como
   artefacto. Los tests usan PGlite, así que no necesita ningún servicio.
2. **postgres** — la misma suite contra un **PostgreSQL 16 real** como service container.
   Es lo que detectaría cualquier diferencia entre el build WASM y el servidor sobre el
   que despliega Railway.

Las credenciales del contenedor de PostgreSQL en CI son valores desechables de un
contenedor efímero solo accesible desde ese job. No hay ningún secreto real en el repo.

---

## Railway

Dos servicios en el proyecto `gym-excel-app`:

| Servicio | Qué es |
|---|---|
| `gym-excel-app` | La aplicación (Express + build de React) |
| `Postgres` | PostgreSQL 18 con volumen persistente |

Configuración en [`railway.json`](railway.json) y [`nixpacks.toml`](nixpacks.toml). La app
recibe `DATABASE_URL` como variable de referencia (`${{Postgres.DATABASE_URL}}`), así que
la contraseña nunca se copia a ningún sitio. Las migraciones corren al arrancar.

```bash
railway link                  # al proyecto gym-excel-app
railway up                    # desplegar
railway logs                  # ver el arranque
```

Para sembrar el libro de referencia en una base de datos vacía basta con dejar
`SEED_REFERENCE_PROGRAM=true`; no sobrescribe programas existentes.

---

## Documentos

- [`SPEC.md`](SPEC.md) — especificación, análisis del Excel real y criterios de éxito
- [`tasks/plan.md`](tasks/plan.md) — plan técnico, riesgos y checkpoints
- [`tasks/todo.md`](tasks/todo.md) — desglose de tareas

## Límites conocidos

- Solo `.xlsx` / `.xlsm`. El `.xls` antiguo no está soportado.
- No exporta de vuelta a Excel.
- **Sin autenticación**: cualquiera con la URL ve y edita los datos. Es adecuado para uso
  personal; si se comparte, hace falta añadir login.
- Las ediciones hechas sin conexión se conservan en pantalla y en la caché, pero no se
  reenvían solas al recuperar la conexión: hay que volver a tocar el campo.
- Un día solo puede tener una sesión por programa. Repetir el mismo plan significa
  importarlo otra vez, lo que crea un programa nuevo con su propio historial.
- Las hojas `Instrucciones` y `Calentamiento` de la plantilla no se importan.
