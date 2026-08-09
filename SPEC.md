# Spec: Barra — Entrenador web desde Excel

> **Revisión 2 — persistencia en PostgreSQL.** La versión 1 guardaba todo en
> `localStorage` y parseaba el Excel en el navegador. Ahora la fuente de verdad es
> PostgreSQL detrás de una API propia, el parser se ejecuta en el servidor y
> `localStorage` queda como caché offline. Lo que **no** ha cambiado: el modelo
> normalizado, los cálculos, el parser en sí y la interfaz. Los apartados de abajo
> siguen siendo válidos salvo donde esta nota diga lo contrario; el detalle de la
> arquitectura nueva, el esquema y la API está en el [`README`](README.md).
>
> Cambios concretos frente a la v1:
>
> - **Arquitectura:** `Frontend → Express → PostgreSQL`, un solo servicio en Railway.
> - **§5 Estructura:** el parser pasa de `src/parser/` a `server/parser/`; los límites de
>   subida compartidos van a `src/domain/upload.ts`; se añaden `server/` y `src/api/`.
> - **§8 Tests:** 205 en total. Los de servidor usan PGlite (PostgreSQL real en WASM) y
>   CI los repite contra un PostgreSQL 16 auténtico.
> - **§10 Seguridad:** se suma validación de cuerpos con zod, comprobación de que el
>   ejercicio pertenece al día, saneado del nombre de fichero y cabeceras de seguridad.
> - **§11 Criterio 7:** recargar conserva los datos porque vienen de PostgreSQL, no de
>   `localStorage`.
> - **Nuevo:** varios programas coexisten con versionado por `source_hash`, y reimportar
>   nunca destruye el historial.

## 1. Objetivo

Convertir automáticamente una plantilla Excel de entrenamiento (la que está en
`Ejemplo/ejemplo.xlsx`) en una aplicación web simple, mobile-first, usable **durante**
el entrenamiento.

Flujo: `Excel → parser → modelo normalizado → app`.

**Usuario:** una persona que entrena y hoy rellena el Excel a mano en el móvil (mala UX).
**Éxito:** puede importar su Excel, navegar semana → día → ejercicio, meter peso/reps/RIR
con inputs grandes, ver 1RM/volumen/progresión calculados igual que el Excel, escribir
notas, marcar la sesión completada, cerrar el navegador y encontrarlo todo al volver.

**No objetivos:** no se replica visualmente la hoja de cálculo; no hay backend, base de
datos ni autenticación; no se exporta de vuelta a Excel (v1).

### Supuestos asumidos (decididos tras inspeccionar el Excel real)

1. El fichero de referencia está en `Ejemplo/ejemplo.xlsx` (el prompt decía `input/`; no
   existe esa carpeta). Se usa `Ejemplo/ejemplo.xlsx` como fixture real.
2. La plantilla es siempre la misma: no se construye un parser universal, pero el parser
   se ancla a **etiquetas de texto** (`DÍA n`, `VOLUMEN TOTAL`, `Notas de sesión`,
   `Sesión completada`, cabeceras `S1 Peso`…), nunca a coordenadas fijas, para tolerar
   filas/columnas desplazadas.
3. No se hardcodea ningún nombre de ejercicio ni de día.
4. Se parsean **todas** las hojas cuyo nombre encaje con `Semana <n>` (el ejemplo sólo
   trae `Semana 1`, pero las instrucciones del Excel indican duplicar la hoja para
   `Semana 2`, `Semana 3`…).
5. Todo es local: `localStorage`. Sin red, sin telemetría.
6. Unidades: kg. RIR entero ≥ 0.

## 2. La plantilla real (análisis de `Ejemplo/ejemplo.xlsx`)

### Hojas

| Hoja | Contenido | Uso en la app |
|---|---|---|
| `📋 Instrucciones` | Cómo usar la plantilla | Ignorada |
| `🔥 Calentamiento` | Guía de movilidad/activación/aproximaciones | Ignorada en v1 |
| `Semana 1` | **Los datos de entrenamiento** | Parseada |
| `Hoja 1`…`Hoja 13` | Vacías | Ignoradas |

### Estructura de un día dentro de `Semana N`

Cada día ocupa un bloque de 17 filas. Con la fila de cabecera del día en `d`:

| Fila | Contenido |
|---|---|
| `d` | `B` = `DÍA 1`, `C` = tipo (`PUSH`, `PULL`, `LEG (CADENA ANTERIOR)`, `UPPER`, …). El tipo puede estar vacío (Días 6 y 7). |
| `d+1` | Cabeceras: `Nº`, `Ejercicio`, `📹 Vídeo`, `Protocolo`, `Comentarios`, `← Semana anterior`, `Semana actual`, `1RM est.`, `Volumen día`, `📈 Progresión` |
| `d+2` | Sub-cabeceras de series: `S1 Peso`/`S1 Reps`/`RIR` … ×4, para semana anterior y actual |
| `d+3` … `d+12` | 10 filas de ejercicio (pueden estar vacías: el nº existe pero no el nombre) |
| `d+13` | `B` = `VOLUMEN TOTAL DÍA n`, valor en `AM` |
| `d+14` | `B` = `📝 Notas de sesión:`, valor en `H` (celda combinada `H:AM`) |
| `d+15` | `B` = `✅ Sesión completada:`, valor en `H`, pista en `I` |
| `d+16` | Vacía |

En el ejemplo: Día 1 → fila 2, Día 2 → 19, Día 3 → 36, Día 4 → 53, Día 5 → 70,
Día 6 → 87, Día 7 → 104. **El parser localiza las filas, no las asume.**

### Columnas de una fila de ejercicio

| Col | Campo |
|---|---|
| `B` | Nº de ejercicio (1..10) |
| `C` | Nombre del ejercicio |
| `F` | Vídeo (hipervínculo, fórmula `HYPERLINK()` o texto/URL plano) |
| `H` | Protocolo (ej. `3 SETS X 4-6 / 6-8 / 8-10 REPS (RIR 0)`) |
| `I` | Comentarios |
| `K,L,M` / `N,O,P` / `Q,R,S` / `T,U,V` | **Semana anterior**: S1..S4 → Peso, Reps, RIR |
| `X,Y,Z` / `AA,AB,AC` / `AD,AE,AF` / `AG,AH,AI` | **Semana actual**: S1..S4 → Peso, Reps, RIR |
| `AK` | 1RM estimado (fórmula) |
| `AL` | Volumen del ejercicio (fórmula) |
| `AM` | Progresión sugerida (fórmula) |

### Fórmulas del Excel (a reproducir exactamente)

**1RM estimado — Epley sobre la Serie 1 de la semana actual** (`AK`):
```excel
=IF(AND(X5<>"",Y5<>""), ROUND(X5*(1+Y5/30),1), "")
```
→ `round1(peso_S1 × (1 + reps_S1 / 30))`, sólo si peso y reps de S1 existen.

**Volumen del ejercicio** (`AL`):
```excel
=IFERROR( IF(X5<>"",X5,0)*IF(Y5<>"",Y5,0) + IF(AA5<>"",AA5,0)*IF(AB5<>"",AB5,0)
        + IF(AD5<>"",AD5,0)*IF(AE5<>"",AE5,0) + IF(AG5<>"",AG5,0)*IF(AH5<>"",AH5,0), "")
```
→ `Σ peso × reps` sobre las 4 series de la semana actual, tratando vacío como 0.
El RIR **no** entra en el volumen.

**Volumen total del día** (`AM` de la fila `VOLUMEN TOTAL`):
```excel
=IFERROR(IF(AL5<>"",AL5,0)+...+IF(AL14<>"",AL14,0), 0)
```
→ suma de los volúmenes de los 10 ejercicios.

**Progresión sugerida** (`AM`) — se basa en la **semana anterior** (peso S1 `K` y RIR S1 `M`):
```excel
=IFERROR(IF(K5="","—",
   IF(M5=0, ROUND(K5/2.5,0)*2.5      & " kg (=)",
   IF(M5=1, ROUND((K5+2.5)/2.5,0)*2.5 & " kg (+2.5)",
            ROUND((K5+5)/2.5,0)*2.5   & " kg (+5)"))),"—")
```
→ sin peso previo: `—`. RIR previo 0: mismo peso. RIR 1: +2.5 kg. RIR ≥ 2 (o vacío,
porque `""=0` es falso y `""=1` es falso en Excel → cae en la rama else): +5 kg.
Todo redondeado al múltiplo de 2.5 kg más cercano y formateado `"<n> kg (<delta>)"`.

> Nota: `ROUND` de Excel redondea *half away from zero*, mientras que `Math.round` de
> JS redondea *half up* (`-2.5 → -2`). Se implementa un helper `excelRound`.

> Nota: las filas 78–82 del ejemplo tienen fórmulas de volumen ligeramente corruptas
> (`#REF!` y referencias desplazadas, p. ej. `AD78` dentro de la fila 79). El parser
> **ignora las fórmulas** del Excel y recalcula todo desde los valores; esto corrige el
> bug de la plantilla en vez de propagarlo.

### Semana anterior

En `Semana 1` está vacía (no hay semana previa). Al importar varias hojas `Semana N`,
la app **también** deriva la semana anterior desde la hoja `N-1` si la columna está
vacía, replicando lo que el usuario haría a mano según las instrucciones del Excel.

## 3. Stack

- React 19 + TypeScript 5 (strict) + Vite 7
- Tailwind CSS 4 (`@tailwindcss/vite`)
- SheetJS `xlsx` (lectura del `.xlsx` en el navegador)
- `localStorage` para persistencia
- Vitest + Testing Library para tests
- Sin backend, sin BD, sin auth

## 4. Comandos

```
Instalar:   npm install
Dev:        npm run dev
Typecheck:  npm run typecheck        # tsc --noEmit
Test:       npm test                 # vitest run
Test watch: npm run test:watch
Build:      npm run build
Preview:    npm run preview
Start prod: npm start                # vite preview --host 0.0.0.0 --port $PORT (Railway)
Lint:       npm run lint             # eslint
```

## 5. Estructura del proyecto

```
SPEC.md
tasks/plan.md               → plan técnico
tasks/todo.md               → lista de tareas
Ejemplo/ejemplo.xlsx        → plantilla real de referencia (fixture de tests)
src/
  domain/
    types.ts                → modelo normalizado (Program, Week, Day, Exercise, SetEntry)
    calculations.ts         → epley1RM, exerciseVolume, dayVolume, suggestProgression…
  parser/
    excelParser.ts          → xlsx → Program (única capa que conoce celdas)
    cells.ts               → helpers de celdas/columnas
  storage/
    storage.ts              → load/save/clear + migración de versión + merge de import
  ui/
    App.tsx
    components/*.tsx        → ImportScreen, WeekNav, DayView, ExerciseCard, SetRow…
    hooks/useProgram.ts     → estado + persistencia
  main.tsx, index.css
tests/
  calculations.test.ts
  excelParser.test.ts       → contra Ejemplo/ejemplo.xlsx real
  storage.test.ts
  integration.test.tsx      → import → editar → guardar → recargar → reimportar
.github/workflows/ci.yml    → install → typecheck → test → build
railway.json, nixpacks.toml → despliegue
```

**Regla de arquitectura dura:** sólo `src/parser/**` puede mencionar letras de columna o
números de fila. `domain`, `storage` y `ui` operan exclusivamente sobre el modelo
normalizado. Se verifica con un test que hace grep del código fuente.

## 6. Modelo normalizado

```ts
type SetEntry = { weight: number | null; reps: number | null; rir: number | null };

type Exercise = {
  id: string;            // estable: `${weekNumber}:${dayNumber}:${number}`
  number: number;        // 1..10
  name: string;
  video: string | null;  // URL
  protocol: string | null;
  comments: string | null;
  previousWeek: SetEntry[];  // longitud 4
  currentWeek: SetEntry[];   // longitud ≥ 4 (el usuario puede añadir series)
};

type Day = {
  id: string; number: number; type: string | null;
  exercises: Exercise[]; notes: string; completed: boolean;
};

type Week = { number: number; sheetName: string; days: Day[] };

type Program = {
  schemaVersion: number; sourceFileName: string; importedAt: string; weeks: Week[];
};
```

## 7. Estilo de código

```ts
/** Volumen de un ejercicio: Σ peso × reps sobre las series registradas. */
export function exerciseVolume(sets: readonly SetEntry[]): number {
  return sets.reduce((total, set) => total + (set.weight ?? 0) * (set.reps ?? 0), 0);
}
```

- Funciones puras y nombradas para todo cálculo; sin lógica de negocio en componentes.
- `export function`, no `export default` (salvo componentes de página).
- Nombres de dominio en inglés, textos de UI en español.
- `strict: true`, sin `any` no justificado, sin `!` non-null salvo tras guard.
- Componentes pequeños, props tipadas explícitamente.

## 8. Estrategia de test

- **Vitest**, entorno `jsdom`, tests en `tests/`.
- **Cálculos:** tests unitarios exhaustivos, incluidos casos límite copiados del Excel
  (vacíos, RIR 0/1/2, redondeo a 2.5, `excelRound` vs `Math.round`).
- **Parser:** tests contra el **Excel real** (`Ejemplo/ejemplo.xlsx`, leído con `fs`).
  Asertan 7 días, nombres/tipos reales, protocolos, el valor sembrado `82.5 kg × 4 reps`
  en Día 1 / ejercicio 1 / S1, y filas vacías descartadas.
- **Storage:** round-trip, versión de esquema, datos corruptos, `localStorage` no
  disponible, merge al reimportar.
- **Integración:** render de la app, importación programática, edición, verificación de
  persistencia y de rehidratación.
- Objetivo: 100 % de las funciones de `domain/` y `parser/` cubiertas por tests.

## 9. Límites

- **Siempre:** ejecutar `npm run typecheck && npm test && npm run build` antes de dar por
  terminado; parsear por etiquetas, no por coordenadas; validar todo dato leído del
  fichero y de `localStorage`.
- **Preguntar antes de:** añadir dependencias fuera del stack acordado; añadir backend.
- **Nunca:** hacer `git push` ni desplegar en Railway sin autorización explícita;
  hardcodear nombres de ejercicio; ejecutar contenido del Excel como código; enviar los
  datos del usuario a ningún servidor.

## 10. Seguridad

Superficie mínima (todo cliente, sin red), pero:

- El `.xlsx` es entrada **no confiable**: límite de tamaño (10 MB), extensión validada,
  parseo con `dense: true` y sin evaluar fórmulas.
- Nunca `dangerouslySetInnerHTML` con contenido del Excel.
- URLs de vídeo: sólo se enlazan si el esquema es `http:`/`https:` (bloquea
  `javascript:` y `data:`); `rel="noopener noreferrer"`.
- `localStorage` se valida con un guard de forma al leer; JSON corrupto → estado limpio,
  no excepción.
- Cabeceras CSP restrictivas servidas en producción.

## 11. Criterios de éxito

1. `npm install && npm run typecheck && npm test && npm run build` pasa en limpio.
2. Arrastrar `Ejemplo/ejemplo.xlsx` a la app detecta la plantilla y muestra los
   **5 días con contenido** (la plantilla prenumera 7 bloques; los días 6 y 7 están
   vacíos en este fichero y se omiten en vez de mostrarse en blanco), con sus
   ejercicios reales, protocolos y el dato sembrado (82.5 kg × 4 reps).
3. Navegación semana → día → ejercicios; botones anterior/siguiente.
4. Introducir peso/reps/RIR actualiza 1RM, volumen del ejercicio y volumen del día en
   vivo, con los mismos números que las fórmulas del Excel.
5. Se pueden añadir y quitar series por encima de las 4 de la plantilla.
6. Notas por sesión y marcar sesión completada.
7. Recargar la página conserva absolutamente todo.
8. Reimportar otro Excel de la misma plantilla regenera el entrenamiento.
9. Usable a 375 px de ancho; objetivos táctiles ≥ 44 px.

## 12. Preguntas abiertas

Ninguna bloqueante. Decisiones tomadas por inspección del fichero y anotadas arriba
(ver §1 Supuestos).
