# Tareas — Barra

- [x] **T1 · Scaffold**
  - Acceptance: Vite + React + TS strict + Tailwind 4 + Vitest arrancan.
  - Verify: `npm run dev`, `npm run typecheck`, `npm test`.
  - Files: `package.json`, `vite.config.ts`, `tsconfig*.json`, `index.html`, `src/main.tsx`, `src/index.css`.

- [x] **T2 · Modelo y cálculos**
  - Acceptance: `epley1RM`, `exerciseVolume`, `dayVolume`, `weekVolume`, `suggestProgression`, `excelRound`, `parseProtocolSetCount` puras y tipadas.
  - Verify: `npm test -- calculations`.
  - Files: `src/domain/types.ts`, `src/domain/calculations.ts`, `tests/calculations.test.ts`.

- [x] **T3 · Parser de Excel**
  - Acceptance: `parseWorkbook(ArrayBuffer)` → `Program` desde el Excel real; 7 días; sin coordenadas fuera del parser.
  - Verify: `npm test -- excelParser`.
  - Files: `src/parser/cells.ts`, `src/parser/excelParser.ts`, `tests/excelParser.test.ts`.

- [x] **T4 · Storage**
  - Acceptance: `loadProgram`/`saveProgram`/`clearProgram`/`mergeProgram` con versión de esquema y tolerancia a datos corruptos.
  - Verify: `npm test -- storage`.
  - Files: `src/storage/storage.ts`, `tests/storage.test.ts`.

- [x] **T5 · Hook de estado**
  - Acceptance: `useProgram` expone programa, selección de semana/día y mutadores; persiste con debounce.
  - Verify: cubierto por el test de integración.
  - Files: `src/ui/hooks/useProgram.ts`.

- [x] **T6 · UI de importación**
  - Acceptance: drag & drop + selector de fichero, validación, errores legibles, pantalla vacía con instrucciones.
  - Verify: QA en navegador.
  - Files: `src/ui/components/ImportScreen.tsx`, `src/ui/components/Dropzone.tsx`.

- [x] **T7 · UI de entrenamiento**
  - Acceptance: nav semanas/días, tarjetas de ejercicio, inputs grandes peso/reps/RIR, añadir/quitar series, vídeo/protocolo/comentarios, 1RM/volumen/progresión en vivo, notas, completar sesión, anterior/siguiente, responsive.
  - Verify: QA en navegador a 375 px y escritorio.
  - Files: `src/ui/App.tsx`, `src/ui/components/*.tsx`.

- [x] **T8 · Tests de integración y arquitectura**
  - Acceptance: import → editar → persistir → rehidratar → reimportar, en test. Test de límites de arquitectura.
  - Verify: `npm test`.
  - Files: `tests/integration.test.tsx`, `tests/architecture.test.ts`.

- [x] **T9 · QA en navegador**
  - Acceptance: sin errores de consola; flujo completo con el Excel real.
  - Verify: dev server + navegación real.

- [x] **T10 · Review de código, seguridad y UX**
  - Acceptance: hallazgos corregidos o documentados.

- [x] **T11 · Docs, CI y despliegue**
  - Acceptance: `README.md`, `.gitignore`, `.github/workflows/ci.yml`, `railway.json`, `nixpacks.toml`, repo git local con commit.
  - Verify: `npm run typecheck && npm test && npm run build`.
