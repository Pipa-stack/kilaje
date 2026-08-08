# Gimnasio

Convierte una plantilla Excel de entrenamiento en una app web simple, mobile-first y
usable **durante** el entrenamiento.

```
Excel  →  parser  →  modelo normalizado  →  app
```

No copia la hoja de cálculo: la reemplaza por tarjetas de ejercicio con inputs grandes
para peso, reps y RIR, y calcula volumen, 1RM y progresión con las mismas fórmulas que
el Excel original.

Todo ocurre en el navegador. **El fichero no se sube a ningún servidor**, no hay backend,
ni base de datos, ni cuentas de usuario.

---

## Empezar

```bash
npm install
npm run dev          # http://localhost:5173
```

Arrastra tu `.xlsx` sobre la pantalla inicial. Para probar sin plantilla propia, usa la
de referencia: `Ejemplo/ejemplo.xlsx`.

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Suite completa (Vitest) |
| `npm run test:watch` | Tests en watch |
| `npm run test:coverage` | Cobertura de `domain/`, `parser/` y `storage/` |
| `npm run build` | Build de producción en `dist/` |
| `npm run preview` | Sirve el build localmente |
| `npm start` | Sirve el build en `$PORT` (usado por Railway) |

---

## Qué hace la app

- **Importar**: arrastra o selecciona el `.xlsx`. La plantilla se detecta sola.
- **Navegar**: semana → día → ejercicios, con chips de día y botones anterior/siguiente.
- **Entrenar**: inputs grandes de peso / reps / RIR, con teclado numérico en móvil.
- **Series**: las 4 de la plantilla, más las que añadas (hasta 12). La serie nueva hereda
  el peso de la anterior.
- **Contexto del ejercicio**: protocolo, comentarios, enlace al vídeo y los datos de la
  semana anterior como referencia bajo cada input.
- **Cálculos en vivo**: volumen del ejercicio, 1RM estimado, progresión sugerida, volumen
  del día y comparación porcentual con la semana anterior.
- **Sesión**: notas y marcar la sesión como completada.
- **Persistencia**: `localStorage`. Recargar no pierde nada.
- **Reimportar**: subir otro Excel de la misma plantilla regenera el entrenamiento y
  conserva lo que ya habías anotado.

---

## La plantilla

El parser se ancla a **etiquetas de texto**, nunca a coordenadas fijas, así que una copia
con una fila o columna insertada sigue funcionando. No hay ni un solo nombre de ejercicio
codificado en el código (hay un test que lo comprueba).

Lee de cada hoja `Semana N`:

| Del Excel | En la app |
|---|---|
| `DÍA n` + tipo (`PUSH`, `PULL`, …) | Cabecera del día |
| Nº y nombre del ejercicio | Título de la tarjeta |
| `📹 Vídeo` | Botón ▶ (sólo enlaces `http(s)`) |
| `Protocolo` | Subtítulo de la tarjeta |
| `Comentarios` | Nota del ejercicio |
| `← Semana anterior` (S1–S4: peso/reps/RIR) | Referencia gris bajo cada input + panel desplegable |
| `Semana actual` (S1–S4: peso/reps/RIR) | Inputs editables |
| `1RM est.`, `Volumen día`, `📈 Progresión` | Recalculados en vivo |
| `📝 Notas de sesión` | Campo de notas |
| `✅ Sesión completada` | Botón de completar |

Si el libro tiene varias hojas `Semana N`, se importan todas y la semana anterior de cada
una se deriva de la anterior cuando esas columnas están vacías.

### Las fórmulas

Reproducidas tal cual del Excel, como funciones puras en `src/domain/calculations.ts`:

| Cálculo | Fórmula |
|---|---|
| **1RM estimado** (Epley, serie 1) | `ROUND(peso × (1 + reps / 30), 1)` |
| **Volumen del ejercicio** | `Σ peso × reps` sobre las series (vacío = 0) |
| **Volumen del día** | suma de los volúmenes de sus ejercicios |
| **Progresión** | sin peso previo → `—`; RIR previo 0 → igual; 1 → +2.5 kg; ≥2 o vacío → +5 kg. Redondeado al múltiplo de 2.5 kg |

Dos detalles que importan:

- **`ROUND` de Excel redondea *half away from zero*** y `Math.round` de JS no
  (`Math.round(-2.5) === -2` frente a `ROUND(-2.5,0) === -3`). Por eso existe
  `excelRound`, con tests de casos límite.
- **El fichero de referencia tiene fórmulas rotas** (filas 78–82: `#REF!` y referencias
  desplazadas). El parser **ignora las fórmulas** y recalcula desde los valores, así que
  la app corrige el bug de la plantilla en lugar de heredarlo.

---

## Arquitectura

```
src/
  domain/
    types.ts          Modelo normalizado (Program, Week, Day, Exercise, SetEntry)
    calculations.ts   1RM, volumen, progresión, formato — funciones puras
    mutations.ts      Actualizaciones inmutables del programa
  parser/
    cells.ts          Acceso a celdas y normalización de etiquetas
    excelParser.ts    xlsx → Program
    errors.ts         TemplateError y límites (sin dependencia de xlsx)
  storage/
    storage.ts        localStorage: validar, guardar, cargar, fusionar al reimportar
  ui/
    App.tsx           Composición y navegación
    hooks/            useProgram: estado + persistencia con debounce
    components/       Dropzone, ImportScreen, DayView, ExerciseCard, NumberField
```

**La regla dura:** sólo `src/parser/**` conoce filas, columnas o `xlsx`; sólo
`src/storage/**` toca `localStorage`; `domain/` no importa React. No es una convención
escrita: `tests/architecture.test.ts` lo comprueba en cada ejecución.

SheetJS pesa ~370 kB, así que se carga con `import()` dinámico sólo cuando se importa un
fichero. El bundle inicial son 220 kB (69 kB gzip).

---

## Tests

```bash
npm test
```

111 tests en 6 ficheros:

| Fichero | Cubre |
|---|---|
| `calculations.test.ts` | Todas las fórmulas, con los casos límite del Excel |
| `excelParser.test.ts` | **El fichero real** `Ejemplo/ejemplo.xlsx`: días, ejercicios, protocolos, el dato sembrado (82.5 kg × 4), multi-semana, columnas desplazadas, entradas inválidas |
| `storage.test.ts` | Round-trip, JSON corrupto, `localStorage` bloqueado, fusión al reimportar |
| `mutations.test.ts` | Edición de series, inmutabilidad, parseo de lo que se teclea |
| `integration.test.tsx` | El flujo completo en React: importar → entrenar → guardar → recargar → reimportar |
| `architecture.test.ts` | Los límites entre capas |

Los tests del parser leen el Excel real, no un fixture sintético: el riesgo que importa
es que el fichero de verdad no coincida con nuestra lectura de él.

---

## Seguridad y privacidad

- El `.xlsx` es entrada no confiable: se valida extensión y tamaño (máx. 10 MB) y las
  fórmulas **nunca se evalúan**.
- Los enlaces de vídeo sólo se renderizan si el esquema es `http:` o `https:`; se bloquean
  `javascript:` y `data:`. Se abren con `rel="noopener noreferrer"`.
- Nada de `dangerouslySetInnerHTML` (comprobado por test).
- Lo leído de `localStorage` se reconstruye campo a campo con validación de tipos; JSON
  corrupto da estado limpio, no una excepción, y no permite prototype pollution.
- CSP restrictiva en `index.html`; sin peticiones de red, sin telemetría, sin cookies.
- `npm audit`: 0 vulnerabilidades. SheetJS se instala desde el CDN oficial del proveedor
  (`cdn.sheetjs.com`), porque la última versión publicada en npm (`0.18.5`) arrastra dos
  advisories sin parchear.

---

## Despliegue

### CI

`.github/workflows/ci.yml` ejecuta en cada push y PR:
`install → typecheck → lint → test → build`, y sube `dist/` como artefacto.

### Railway

Configurado en `railway.json` y `nixpacks.toml`. Es una SPA estática servida con
`vite preview` sobre el `$PORT` que inyecta Railway. Sin variables de entorno, sin base
de datos, sin secretos.

```bash
railway login
railway init
railway up
```

> El despliegue no se ha ejecutado. Requiere tu autorización.

---

## Documentos

- [`SPEC.md`](SPEC.md) — especificación, análisis del Excel real y criterios de éxito
- [`tasks/plan.md`](tasks/plan.md) — plan técnico, riesgos y checkpoints
- [`tasks/todo.md`](tasks/todo.md) — desglose de tareas

## Límites conocidos

- Sólo `.xlsx` / `.xlsm`. El `.xls` antiguo no está soportado.
- No exporta de vuelta a Excel.
- Los datos viven en un solo navegador: no hay sincronización entre dispositivos.
- Las hojas `Instrucciones` y `Calentamiento` de la plantilla no se importan.
