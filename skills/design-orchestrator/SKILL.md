---
name: design-orchestrator
description: Diseño UI/UX, wireframes, layouts, design system, propuesta de interfaz, crítica de diseño, audit visual, iteración de diseño, brief de diseño, rediseño de pantallas
---

# design-orchestrator — Mixture of Experts Harness

You are the conductor of a fail-proof pipeline. You do **not** do the expert
work yourself — you delegate to the expert subagents via the Task tool,
validate their outputs, and synthesize the final plan.

## Scope & artifact layout

The target **scope** (`<scope>`, e.g. `settings-page`) is given in the user
request or the command argument. All artifacts live under **`docs/design/<scope>`** —
one subfolder per scope. Shared-kernel artifacts go under `docs/design/shared`.

Every Task delegation MUST pass the full artifact paths and the `<scope>` name.

## Roles

| Subagent | Skills it loads | Deliverable |
|---|---|---|
| expert-research | ui-ux-pro-max | docs/design/<scope>/research.md |
| expert-design-system | ui-ux-pro-max | docs/design/<scope>/design-system.md |
| expert-wireframe | ui-ux-pro-max, vercel-react-best-practices | docs/design/<scope>/wireframes.md |
| expert-critique | impeccable | docs/design/<scope>/critique.md |
| executor | — | aplica los slices aprobados dentro de los writePaths del proyecto |

## The Pipeline (strictly sequential — no parallel phases)

### Phase 0 · Resume check (reanudación tras cortes)
If `docs/design/<scope>/RUN-STATE.json` exists, read it and **resume from the
pending phase** instead of starting over: verify each recorded artifact is on
disk (non-trivial size), re-run only the missing/partial phases, and continue
from the last completed one. This avoids re-auditing a partially-written tree
by hand after network/provider cuts (lección de las corridas ota-section).

### Phase 0 · Baseline (HARD GATE)
Before anything else, run and record:
1. `git status` — must be clean (or explicitly acknowledged dirty).
2-5. Run the baseline gates declared in the harness manifest (typical: `pnpm typecheck`, `pnpm lint`). **Run gates with `--force`/`--no-cache` when available** — turbo caches results and can report false greens.
6. Record the baseline commit SHA.

**If any check fails, STOP and report.** Never start on a red baseline. If a
check needs a service (DB, broker) to run, note it and get the user to start it
or confirm the baseline is acceptable.

### Phase 0.5 · Create the artifacts directory
`mkdir -p docs/design/<scope>` (or `docs/design/shared` for shared-kernel work) before delegating.

### Phase 0.6 · Checkpoint (after EVERY phase)
Write/update `docs/design/<scope>/RUN-STATE.json` after every completed phase:
current phase, baseline SHA, artifacts written (path + size), subagents
completed, critique threshold, retries. This is the resume source for Phase 0.

### Phases 1-N · Delegation (READ-ONLY analysis)

1. **expert-research** — (brief, audiencia, contexto visual del proyecto, mapa de pantallas). Handoff: pasa el scope y la ruta `docs/design/<scope>/research.md`.
   - **Verificación empírica obligatoria**: todo supuesto y todo gap cerrado como "no-gap" DEBE citar evidencia (archivo:línea o comando ejecutado). Lo no verificable se marca "abierto/requiere verificación". Si existe una fuente funcional (otro proyecto, CLI propio, backend desplegado), verifica contra ella — un gap mal cerrado en research cuesta un fix post-freeze (caso real: formato `.tar.gz` vs `.zip` del CLI propio).
   - **Alternativas de diseño**: las opciones exploradas se documentan en research.md bajo "Exploración / alternativas descartadas" (con justificación). NUNCA se trasladan al wireframe.
2. **expert-design-system** — (estilo, paleta, tipografía, tokens, anti-patrones — input: research). Handoff: pasa `research.md` como input, ruta de salida `docs/design/<scope>/design-system.md`.
3. **expert-wireframe** — (wireframes por pantalla, layouts.md, wireframe.html lo-fi — inputs: research + design-system). Handoff: pasa ambos artifacts como inputs, rutas de salida bajo `docs/design/<scope>/`.
   - **WIREFRAME CANÓNICO**: una variante por pantalla/estado/flujo. Sin subvariantes acumuladas (WF-5c/5d, v2a/v2b, "opción A/B") — el usuario aprueba UNA versión y la UI final debe ser fiel a esa.
   - **Tokens del proyecto**: el wireframe.html usa los CSS custom props/tokens reales de DESIGN.md; los tokens nuevos se marcan "propuesta de token" (los valida el critique).
   - **Cobertura de estados**: cubre SIEMPRE loading, empty, error y los estados interactivos (lectura/edición/guardando) de cada pantalla, con presupuestos de interacción.
   - **SCOPE FIDELITY**: el wireframe representa SOLO lo que el scope introduce o modifica. Las secciones/pantallas existentes que el scope NO toca se muestran como placeholder mínimo declarado ("contexto — sin cambios": label + estado), NUNCA reproduciendo su contenido interno (canales, tablas, badges, historial, controles). Aunque conozcas cómo se ven, no las dibujes (caso real: panel Distribución reproducido íntegro cuando el scope era solo Code signing).
   - **FIDELIDAD DE DATOS**: todo control/estado del wireframe deriva de un dato real verificado (DTO, API, research con cita archivo:línea). Si el dato no existe en el modelo real (p.ej. certs por channel cuando el cert es único por app), NO se dibuja el control — se documenta "no aplica" y se consulta al orquestador. Un select/combobox/toggle inventado rompe la fidelidad de lo que se aprueba (caso real: select "prod/preview" de variante de cert inexistente).
4. **expert-critique** — (ronda 1 — score por heurísticas sobre wireframes + layouts. ANTES de delegar, el orquestador renderiza wireframe.html en chrome-devtools y prepara **siempre** evidencia ligera: screenshots en **JPEG ≤ 250 KB**, snapshot de accesibilidad (a11y) y JSON de `render-audit.js`, todos en `docs/design/<scope>/screenshots/`. **Prohíbe al critique leer PNG/archivos > 500 KB** — bloquea a subagentes sin visión. El critique inyecta `scripts/render-audit.js` vía evaluate para las métricas medidas: contraste WCAG real, ritmo, targets, overflow, focus — sección 'Métricas medidas' en critique.md; si falla, degrada a snapshot de accesibilidad + DOM). Handoff: pasa wireframes + layouts + screenshots como inputs, ruta de salida `docs/design/<scope>/critique.md`.
   - **SCOPE FIDELITY (heurística)**: penaliza wireframes que reproduzcan secciones/pantallas existentes que el scope NO toca (contexto fuera de alcance = placeholder declarado, nunca contenido interno duplicado). Un wireframe que duplique contenido fuera de alcance NO es APROBADO aunque el resto puntúe alto (caso real ota-signing-keys: se validó como ✅ el panel Distribución reproducido íntegro).
   - **FIDELIDAD DE DATOS (heurística)**: verifica que todo control/estado del wireframe tenga anclaje en data real (cita archivo:línea, DTO, API, research). Un control inventado sin base en el modelo real (p.ej. select de "variante del certificado" cuando el cert es único por app) es fail de fidelidad y NO es APROBADO. Reporta cada control sin anclaje con la cita faltante.
   - El veredicto final APROBADO exige fidelidad de alcance Y fidelidad de datos, además del umbral de score.
5. **expert-wireframe** — (ronda 2 — SOLO si el score de critique < umbral: refina wireframes con critique.md como input; si el score es aceptable, se omite). Handoff: pasa `critique.md` como input.
6. **expert-critique** — (ronda 2 — re-evaluación final si hubo ronda 2; se omite si no hubo). Handoff: re-audita los wireframes refinados.

**Escala de score unificada**: el critique escribe su veredicto final SIEMPRE en
formato `Score: X/10` (una sola línea, al final), para que `run-metrics.mjs` y
los humanos lo lean sin ambigüedad. (Las corridas históricas usaron /5, /40 y
/10 — quedan como registro, pero las nuevas usan /10.)

Validation gate between phases: after each expert returns, confirm the artifact
was actually written to disk and is non-trivial. If an expert fails or returns
nothing useful, STOP and report instead of proceeding.

### Artifact integrity (escritura robusta)
La tool Write de opencode NO trunca por un límite del server (medido: writes OK
de 33-46 KB en corridas reales); el límite real es la serialización del tool
call en el output del modelo. Por eso: un artefacto estimado <= 28 KB se
escribe con UNA sola Write directa — sin `.tmp/` ni ensamblaje sin necesidad.
Solo si estimas > 28 KB (o el write directo falla) usa secciones en `.tmp/` y
ensambla con `write-md.mjs --sources`. Valida cada artefacto tras la delegación
con:
`node .opencode/skills/design-orchestrator/scripts/write-md.mjs --file <artefacto> --check --budget <bytes>`
Confirmar que existe, termina completo y no tiene marcadores sin resolver.
Budgets por artefacto (bytes, calibrados al límite empírico): research 32768 ·
design-system 32768 · wireframes 49152 · layouts 20480 · critique 32768 ·
design-proposal 32768.

**Presupuesto por sección ANTES de escribir**: el experto reparte el budget
entre las secciones (suma <= 90% del budget) y estima el tamaño de cada una
mientras la redacta — nunca descubre el exceso recién en el check (caso real:
primer intento de research con +59% sobre budget → 8 regeneraciones en bucle).

**Si `--check` falla por budget**: recorte DIRIGIDO, nunca regenerar todo desde
cero. Usar el delta exacto que reporta el script y compactar por prioridad
(primero supuestos/alternativas y copy redundante, después contexto; nunca
borrar citas archivo:línea ni estados obligatorios). Para ver cuánto pesa cada
sección: `write-md.mjs --report --file <artefacto> --sources <secciones>`.
Máximo 2 ciclos de regeneración completa; si sigue fallando, STOP y reporta el
delta y el plan de recorte en vez de seguir iterando.

**Tope de edits correctivos (anti-edit-storm)**: el artefacto se escribe con
UNA escritura (write directo o `--sources`), nunca con edits incrementales.
Como máximo **5 edits correctivos** por artefacto (ajustar un token, corregir
una cita). Si el ajuste exige más de 5 edits, **REESCRIBE el archivo completo**
con el contenido ya compactado (write directo <= 28 KB o `--sources`) — nunca
edites sección por sección. Un edit = un round-trip que reenvía todo el
historial; 166 edits de design-system.md consumieron 367k tokens in / 26.5M de
cache y 81 min (caso real ota-signing-keys). `--check` falla también si detecta
secciones duplicadas (encabezado repetido).

**Releer antes de editar**: tras un ensamblaje con `write-md.mjs --sources`, el
archivo en disco cambió — relee SIEMPRE el archivo antes de cualquier edit
(edit contra un oldString desactualizado = tool error + duplicados, caso real:
7 edits fallidos tras re-ensamblaje de design-system.md).

### Retry policy (subagentes)
If a delegated subagent fails with a **transient** error (`Upstream request
failed`, `Endpoint is unavailable`, `network_error`, `invalid_request_error`,
`response was not valid JSON`), **retry up to 3 times with backoff**, resuming
the same `task_id` when possible. Only after 3 consecutive failures apply the
fail-safe rule (load the expert's skill yourself and inject its methodology).
Record every retry in RUN-STATE.json and in the final report. Most harness
retries observed in real runs were transient provider failures, not logic bugs.

**Validation failures are NOT provider retries**: si un experto devuelve un
artefacto que falla `--check` por budget, no reintentes la delegación completa.
Aplica el recorte dirigido de Artifact integrity (máx 2 ciclos) y, si el experto
no puede ajustar el tamaño, STOP y reporta el delta al usuario en vez de
regenerar en bucle (caso real: 9 ciclos de regeneración de research.md por un
check de budget que falló 8 veces).

### Sesión limpia (regla universal — prohibido reutilizar la sesión del experto)
TODA delegación nueva vía la tool Task — fase del pipeline, delta, iteración de
feedback pre-aprobación, ronda 2 de critique, re-auditoría de paridad — se delega
**sin `task_id`**: opencode crea una sesión nueva y limpia (`sessions.create`:
reusar un id reutiliza la sesión existente con todo su historial). **Nunca
reutilices la sesión del experto** para contenido nuevo: acumula todo el historial
(un delta de design-system.md sobre la sesión de la ronda 1 llegó a 840 parts /
367k tokens y reintrodujo una sección duplicada que el usuario ya había corregido;
en ota-signing-keys una sesión de design-system llegó a 1061 parts por iterar sobre
la misma sesión). `task_id` SOLO se reutiliza para retry transitorio del MISMO
intento (máx 3, ver Retry policy). Al delegar una iteración o delta, pasa en el
prompt el estado ACTUAL del artefacto (contenido ya corregido + path), nunca
asumas que el experto conoce el archivo.

### Synthesis (HARD GATE — approval required)
Consolidate all artifacts into `docs/design/<scope>/design-proposal.md`:
- un slice = una pantalla o componente del scope; sin cambiar contratos existentes; cada slice verificable con las gates del proyecto antes del commit.
- **Slice de integración OBLIGATORIO** cuando el scope es una pantalla/sección: un slice final que conecte los componentes en la página real (routing, data fetching, estados loading/empty/error). Los slices por componente sin integración dejan la UI vacía aunque las gates pasen verdes (caso real: 14 slices de OTA con la página vacía).
- **Pantallas canónicas**: lista las WF ids aprobadas (una variante por pantalla/estado); el IMPLEMENTATION-PROMPT referencia SOLO esas — las alternativas descartadas quedan en research, no se implementan.
- **Checklist de paridad**: mapa estado-del-wireframe → componente/hook, para la gate de paridad post-integración.
- Si `impeccable` está instalado, audita el `wireframe.html` aprobado con `detect.mjs` y cita los warnings como deuda a evitar en la implementación.
- Each slice must be independently verifiable: refactor → gates → commit.

Present the plan to the user and **STOP for approval** (explicit approval required). Do not execute any edit until the user approves.

### Execution (only after approval)
Delegate each slice to the executor subagent via the Task tool (blueprint =
`design-proposal.md` + the exact slice). **Never apply source edits yourself in
this phase** — you only validate the executor's return (files applied and
confirmed on disk, per-gate results with real numbers, commit hash, final git
status).
1. Confirm the slice is within the approved plan.
2. Delegate to the executor with the blueprint.
3. Validate the return; if a slice left the tree red, have it reverted immediately.
4. Never proceed to the next slice on a red tree.
5. After the integration slice: (a) verify the page actually renders (dev server
   + snapshot via chrome-devtools), and (b) run the **PARITY GATE** — delegate a
   final audit to `expert-critique` comparing the implemented UI against the
   canonical wireframe (states implemented vs wireframe states, copy, order,
   interaction budgets). Only close the scope when parity passes.

## Fail-Safe Rules

- No code edits before approval.
- Only the executor applies source changes in the execution phase; experts are read-only.
- One slice = one commit. Never skip a gate. Never parallelize phases.
- Read-only experts: if a subagent cannot load its skill, load it yourself and
  inject its methodology into the delegation prompt. First, though, exhaust the
  retry policy (3 attempts) — most "skill load failures" are transient provider errors.
- Gates with `--force`/`--no-cache` when available (falsos verdes por caché).
- Verify post-write: after each delegation, confirm the artifact is on disk and
  non-trivial; during execution, confirm each slice file exists after its commit.

## Artifacts

All artifacts live in `docs/design/<scope>/` (one subfolder per scope;
`docs/design/shared/` for cross-scope contracts):
- docs/design/<scope>/research.md — expert-research
- docs/design/<scope>/design-system.md — expert-design-system
- docs/design/<scope>/wireframes.md — expert-wireframe
- docs/design/<scope>/layouts.md — expert-wireframe (layout spec)
- docs/design/<scope>/wireframe.html — expert-wireframe (render lo-fi)
- docs/design/<scope>/screenshots/ — evidencia ligera del orquestador (JPEG ≤ 250KB + a11y snapshot + render-audit JSON; nunca PNG grandes)
- docs/design/<scope>/critique.md — expert-critique
- docs/design/<scope>/RUN-STATE.json — checkpoint del pipeline (fase, baseline SHA, artefactos, reintentos)
- docs/design/<scope>/design-proposal.md — síntesis (deliverable final)

Existing artifact sets are historical records of past pipelines and must NOT be
overwritten by a run targeting a different scope.

## Recursos del harness

- `scripts/render-audit.js` — auditoría medida del render (contraste WCAG, ritmo, escala tipográfica, target sizes, overflow, focus). El critique lo inyecta en el wireframe.html renderizado vía chrome-devtools `evaluate`; devuelve JSON con passes/fails numéricos. Complementa (no reemplaza) la metodología de impeccable.
- `scripts/write-md.mjs` — escritura robusta de artefactos (gap G1): ensambla un markdown desde secciones `.tmp/` (`--sources`), valida integridad (`--check`) y respeta budgets (`--budget`). Evita los truncamientos de la tool Write y los marcadores de continuación.
- `scripts/run-metrics.mjs` — reporte post-run de métricas (tokens, costo, delegaciones, contexto del orquestador, calidad, incidentes). Ver README del harness.