# Plan técnico — Barra

Fuente de verdad: [`SPEC.md`](../SPEC.md).

## Grafo de dependencias

```
T1 scaffold
 └─> T2 domain/types + domain/calculations  ──┐
 └─> T3 parser (cells + excelParser) ─────────┤
 └─> T4 storage ──────────────────────────────┤
                                              ▼
                                      T5 hook useProgram
                                              │
                                              ▼
                                      T6 UI import
                                              ▼
                                      T7 UI entrenamiento
                                              ▼
                     T8 tests integración → T9 browser QA → T10 review
                                              ▼
                              T11 docs/CI/deploy/git
```

T2, T3 y T4 son independientes entre sí una vez existe T1 y pueden escribirse seguidos
sin bloqueo. T3 depende de los tipos de T2 (sólo tipos, no lógica).

## Orden de implementación y por qué

1. **Cálculos primero.** Son el núcleo de valor y el punto donde es más fácil
   equivocarse (redondeo de Excel). Se escriben con TDD contra las fórmulas
   transcritas en `SPEC.md` §2.
2. **Parser después**, contra el fichero real. Si el parser fuese primero no habría
   modelo destino estable.
3. **Storage** aislado, sin conocer React.
4. **UI al final**, componiendo capas ya probadas. Cada slice de UI es vertical y
   verificable: importar → ver → editar → persistir.

## Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| `ROUND` de Excel ≠ `Math.round` de JS en `.5` y negativos | helper `excelRound` con tests de casos límite |
| Fórmulas corruptas en el Excel real (filas 78–82, `#REF!`) | el parser ignora fórmulas y recalcula desde valores |
| Filas/columnas desplazadas en futuras copias de la plantilla | detección por etiquetas de texto, nunca por índice fijo |
| Vídeo como hipervínculo vs `HYPERLINK()` vs texto plano | extractor que cubre los tres, con validación de esquema |
| `localStorage` lleno o no disponible (Safari privado) | `try/catch` + estado en memoria + aviso en UI |
| Reimportar borraría lo entrenado | merge por `exercise.id`; se conserva lo introducido salvo que el usuario pida reemplazo limpio |
| UI acoplada a celdas | test de arquitectura que hace grep de patrones de celda fuera de `src/parser` |

## Checkpoints de verificación

- Tras T2: `npm test -- calculations` verde.
- Tras T3: `npm test -- excelParser` verde contra `Ejemplo/ejemplo.xlsx`.
- Tras T4: `npm test -- storage` verde.
- Tras T7: `npm run dev` + QA manual en navegador.
- Tras T11: `npm run typecheck && npm test && npm run build` verde.
