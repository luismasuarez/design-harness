# Mejoras del design-harness v1.1 — hallazgos y correcciones

Análisis empírico de las corridas reales del harness en `portal_cloud`
(scope `ota-section`, ago 2026) a partir de tres fuentes cruzadas:

1. Observaciones de Engram (sesiones del harness, decisiones, incidentes).
2. `opencode.db` — tool calls con error, mensajes del orquestador, subsesiones.
3. Código del harness y la instalación generada (`opencode.json`).

Cada hallazgo tiene su corrección aplicada en este repo (v1.1).

---

## P0 — Robustez del pipeline (evitar cortes)

### 0.1 Sin checkpoint → auditoría manual de árbol parcial
Tras dos cortes ("fallo por mi subscripcion", "Fallo de red del proveedor") el
orquestador tuvo que auditar a mano el árbol parcial: *"El árbol ya contiene
trabajo parcial de las corridas canceladas... audito qué se hizo para NO
repetir ni contaminar."*

**Fix**: RUN-STATE.json por scope (fase actual, baseline SHA, artefactos
escritos, reintentos) escrito tras cada fase; Fase 0 · Resume check en el
SKILL y en el prompt instalado del orquestador.

### 0.2 Fallos transitorios del proveedor → reintentos ad-hoc
En el log global: 31× "Endpoint is unavailable", 18× "response was not valid
JSON", 10× `invalid_request_error`. En las sesiones del harness: expert-wireframe
falló 2× (endpoint unavailable), critique ronda 1 se canceló 4×, executor T2' 1×
(`network_error`), F4-amend 1×. **El 90% de los reintentos fue por el proveedor,
no por lógica.** El orquestador reintentaba de forma ad-hoc y a veces aplicaba el
fail-safe de inyectar la skill manualmente sin agotar los reintentos.

**Fix**: política de reintento explícita en SKILL + prompt instalado: hasta 3
intentos con backoff reanudando la misma `task_id`; solo tras 3 fallos aplicar
el fail-safe de inyección de skill. Registro de reintentos en RUN-STATE.json y
en el reporte final.

---

## P1 — Permisos y gates (fricción y falsos verdes)

### 1.1 Perfil bash deny-by-default bloqueaba la inspección estándar
49 tool errors de bash eran `The user has specified a rule which prevents you
from using this specific tool call` en expertos y executor: `wc`, `grep`,
`sed`, `cp`, `mv`, `rm`, `node -e`, `python3`, `file`, `npx tsc`, `git show`,
y **todos los comandos con pipes** (el glob no matchea el comando con `|`).
El prompt del executor además decía *"if permission-denied, STOP and report"*,
lo que degradaba la autonomía.

**Fix**: `install.mjs` amplía el allow de expertos y executor (node/npx/python3/
wc/grep/sed/cp/mv/file/mkdir/git show-log-diff/head/tail) y cambia el default de
`deny` a `ask` (supervisado, no bloqueante). Se elimina el "STOP and report
denial" del prompt del executor.

### 1.2 Gate typecheck raíz no cubre el paquete de UI
`pnpm typecheck` (turbo, 15/15) NO type-checkea `@portal/console`: el package no
tiene script `typecheck` (solo `build: tsc -b && vite build`). Falsos verdes en
baseline y por-slice. El executor tuvo que descubrir `tsc -b --force` a mano.

**Fix**: el manifest declara el gate `{{console-typecheck}}` (baseline, per-slice
y executor); `install.mjs` lo resuelve a `pnpm --filter <package-filter> exec
tsc -b --force` cuando se pasa `--package-filter`. Se instruye `--force`/`--no-cache`
para evitar falsos verdes por caché de turbo.

### 1.3 Ejecución por componente dejó la página vacía
La implementación v1 ejecutó 14 slices (componentes sueltos) y la página OTA
quedó vacía: *"Terminaste y no veo nada en la seccion OTA, sale vacio"*. El
orquestador reescribió la página después. Las gates typecheck/lint no detectan
"UI sin integrar".

**Fix**: slice de integración OBLIGATORIO en la síntesis cuando el scope es una
pantalla/sección + verificación funcional post-integración (dev server +
snapshot) en la ejecución. Documentado en manifest.sliceRule y en el SKILL.

---

## P2 — Calidad de investigación

### 2.1 Supuestos cerrados sin evidencia
- research v1 marcó el formato de bundle como "no-gap" asumiendo `.tar.gz`;
  el CLI propio genera `.zip`/`.zip.br` → fix post-freeze (F4-amend).
- Wireframes v1 asumieron "rama auto-resuelta server-side" que no existe en la
  API de portal_cloud → modelo A+B post-hoc.

**Fix**: gate de verificación empírica en expert-research (todo supuesto y todo
"no-gap" cita `archivo:línea` o comando; lo no verificable se marca "abierto") +
regla de oro de fuente funcional (si existe otro proyecto/CLI funcional, verificar
contra él). Incluido en `renderExpertPrompt` y en el SKILL.

---

## P3 — Crítica y evidencia

### 3.1 Critique bloqueado al leer PNG (~1MB)
Expert-critique se bloqueó 3× leyendo screenshots PNG grandes; se mitigó a mano
con JPEG (245KB) + snapshot a11y + prohibir leer imágenes.

**Fix**: el orquestador prepara SIEMPRE evidencia ligera antes de delegar la
crítica (JPEG ≤ 250KB + a11y snapshot + render-audit JSON) y prohíbe al critique
leer archivos > 500KB. El modelo sin visión usa el modo métricas DOM sin fricción.

### 3.2 Escala de score inconsistente
Los critiques históricos usaron /5, /40 y /10 → `run-metrics.findScore` (que solo
leía `X.X / 5`) devolvía null.

**Fix**: el critique escribe el veredicto final siempre como `Score: X/10`;
`findScore` lo parsea con fallback a /5, /25 y /40.

---

## P4 — Telemetría y operación

### 4.1 run-metrics sin datos de incidentes y con estimación de contexto rota
`input - cache_read` da 0 en corridas largas (cache_read >> input), la estimación
era inútil. No había métricas de reintentos/denials/cancelaciones.

**Fix**: sección `incidents` (por categoría y por agente: `provider_transient`,
`permission_denial`, `task_cancelled`, `task_error`, `tool_error`) y
`contextPctSource` honesto ("no estimable; usa --observed-context-pct").

### 4.2 Verificación post-escritura y residuos
Incidente en T1': archivos recién escritos desaparecieron del disco sin causa
determinada (git status limpio). Y `apps/api/uploads-tmp/` quedó como residuo.

**Fix**: el executor verifica post-escritura (cada archivo NEW/MOD existe y
aparece en `git status`); se documenta el incidente en el USAGE (troubleshooting)
y se recomienda `.gitignore` para residuos del sistema.

---

## Cómo se aplican estas mejoras

1. `harness.manifest.json` — fuente de verdad (roster, pipeline, gates, sliceRule).
2. `install.mjs` — genera prompts/permisos/agents en el `opencode.json` destino.
3. `skills/design-orchestrator/SKILL.md` — protocolo del orquestador.
4. `skills/design-orchestrator/scripts/run-metrics.mjs` — telemetría post-run.

Reinstalación: `node install.mjs install --force --package-filter <pkg>` y
reiniciar opencode. La re-instalación no toca `docs/design/` (artefactos previos
se conservan).

## Verificación (pruebas de la v1.1)

- `node install.mjs --check` en el proyecto destino.
- `node test/install.test.mjs` en el repo.
- `run-metrics.mjs --scope <scope>` regenerado para validar `findScore` e
  `incidents`.

---

# Gaps v1.2 (G1–G5) — hallazgos de la segunda iteración

Análisis de las mismas corridas (ota-section + dev-profile) con foco en calidad
de artefactos, fidelidad wireframe→código y reutilización de las herramientas de
`impeccable`.

## G1 — La tool Write trunca payloads grandes → escritura fragmentada a mano

**Evidencia** (textos reales de los subagentes):
- *"El contenido se truncó en la serialización. Escribo el archivo en dos partes"*
- *"El payload es muy largo para una sola llamada. Lo divido en 4 partes: Write inicial + 3 Edits de append"*
- *"El contenido es muy largo para una sola escritura. Lo escribo en dos partes"* (research ota-section)

Tamaños reales: `research.md` 42KB, `design-system.md` 56KB, `wireframes.md` 64KB,
`critique.md` 66KB. Cada experto inventaba su workaround (fragmentar a mano,
marcas de continuación) → frágil y arriesga corrupción silenciosa; el orquestador
solo validaba existencia+tamaño.

**Fix**:
- `scripts/write-md.mjs` (nuevo): ensambla un artefacto desde secciones
  `docs/design/<scope>/.tmp/` (`--sources`), valida integridad (`--check`) y
  respeta budget (`--budget`); detecta marcadores de continuación sin resolver.
- `artifactBudget` por artefacto en el manifest (research 20KB · design-system
  25KB · wireframes 40KB · layouts 15KB · critique 25KB · design-proposal 20KB).
- El orquestador valida con `--check` tras cada delegación (ARTIFACT INTEGRITY).
- Los prompts de expertos prohíben escribir >15KB de un golpe y parten en
  secciones con `write-md.mjs`.

## G2 — Detector de impeccable como gate de calidad del executor

**Evidencia**: `detect.mjs` de impeccable funciona sobre el repo real — 52
findings en el wireframe OTA (`design-system-font-size`, `layout-transition`,
`design-system-color`), respeta `DESIGN.md`, los `advisory` no bloquean, y **0
findings en `ota-page.tsx`** (código limpio → sin falsos positivos). Es un
"lint de UX" objetivo post-slice.

**Fix**:
- Nueva gate del executor **detect** (expect `no-new-warnings`, baseline 0):
  `node .opencode/skills/impeccable/scripts/detect.mjs --json --no-advisory <files del slice>`.
  Las warnings nuevas se documentan como deuda, nunca se silencian.
- En la síntesis, el orquestador audita el `wireframe.html` aprobado con
  `detect.mjs` y cita los warnings en el design-proposal.
- La gate se activa automáticamente cuando la skill `impeccable` está instalada
  (proyecto o global) — `install.mjs` lo detecta.

## G3 — Wireframe canónico vs alternativas (redundancia en la aprobación)

**Evidencia**: el wireframe OTA acumuló subvariantes en un solo archivo:
`WF-2a/2b/2c`, `WF-3a/3b/3c`, `WF-4a/4b/4c`, `WF-5a/5b/5c/5d`, `v2a/v2b`,
"opción A". El usuario aprobó la WF-1 (vista default con datos) y las demás
propuestas no le parecieron atractivas. El wireframe se convirtió en un "museo
de iteraciones" en vez de un documento aprobable.

**Fix**:
- Regla **WIREFRAME CANÓNICO**: una variante por pantalla/estado/flujo; sin
  subvariantes acumuladas.
- Las alternativas exploradas se documentan en research.md ("Exploración /
  alternativas descartadas" con justificación), NUNCA en el wireframe.
- Los refinamientos de critique se aplican IN PLACE (replace), no como WF-5c/5d.
- La síntesis lista las pantallas canónicas (WF ids aprobados) y el
  IMPLEMENTATION-PROMPT referencia SOLO esas — la UI final debe ser fiel al
  wireframe aprobado.

## G4 — Fidelidad wireframe→código (paridad)

**Evidencia**: el critique de paridad que pidió el usuario dio 6.5/10: solo 9/13
estados plasmados, 1 variante muerta (`channel-without-release`), faltaron
paginación/filtros/snippet URL. Era un paso ad-hoc, no parte del pipeline.

**Fix**:
- **PARITY GATE obligatoria** tras el slice de integración: el orquestador
  delega una auditoría final a `expert-critique` comparando la UI implementada
  contra el wireframe canónico (estados, copy, orden, presupuestos de
  interacción). Solo se cierra el scope si la paridad pasa.
- El design-proposal incluye un **checklist de paridad** (estado del wireframe →
  componente/hook).

## G5 — Calidad del wireframe (combinar fortalezas)

**Evidencia** (comparativa de los wireframe.html reales):
- `dev-profile`: 6 estados cubiertos (loading/empty/error/lectura/edicion/
  guardando) pero con **21 custom props genéricos** (--surface, --muted,
  --radius-md) → diseño neutro.
- `ota-section`: extendió los **tokens reales del proyecto** (--card, --input-bd,
  --popover, --muted-fg, --hover-primary, --r-xl) → mejor diseño y estilo.

**Fix** (reglas para `expert-wireframe`):
- El `wireframe.html` usa los tokens/DESIGN.md del proyecto; solo los tokens
  inexistentes se proponen, marcados "propuesta de token".
- **COBERTURA DE ESTADOS** obligatoria (loading, empty, error, interactivos) +
  presupuestos de interacción — lo que dev-profile hizo bien, exigido por regla.

---

# Verificación de la v1.2

- `node test/install.test.mjs` → 11/11 (incluye tests de write-md/budget y de la
  gate detect condicional a la skill impeccable).
- Reinstalar en el proyecto con `--force` (los prompts/permisos se regeneran).
## G6 — Bucle de regeneración por budget (expert-research ota-signing-keys)

**Evidencia** (run `5bff0b48`, sesión `ses_fc9e7f2eff...`, portal_cloud, 2026-08-24):
- El subagente expert-research quedó 15.9 min en bucle: 9 ciclos de regeneración
  completa de `.tmp/research-1..4.md` + ensamblaje, con 8 checks de budget
  fallidos (32611 → 24668 → 24235 → 22844 → 21725 → 21530 → 21410 → 20639,
  todos > 20480) hasta acertar en el 9º (20446 OK). 69 pasos de loop, ~208k
  tokens (117,720 in / 90,792 out), 2 tool_errors de edit sobre `.tmp` con
  oldString desactualizado. Terminó "Task completed" y el pipeline continuó.
- **Medición del límite real de la tool Write (v1.18.22)**: el código fuente
  (repo sst/opencode, `tool/write.ts`) NO limita el tamaño del content
  (`Schema.String` sin validación; write directo con `fs.writeWithDirs`). El
  límite real es la serialización del tool call en el output del modelo. Writes
  completados OK en el historial real (mismo modelo deepseek-v4-flash): 33,445
  bytes (design-system.md, 24/08, un solo write) y 46,801 bytes (wireframe.html,
  22/08); máximo histórico 87,924 bytes. Los 41 writes con error del historial
  son permisos/schema/aborts — **cero por tamaño**.
- El primer intento del bucle (32,611 bytes) era escribible en un solo write; el
  budget de 20,480 forzó 8 recortes y ~12KB de contenido valioso descartado sin
  necesidad. En vivo, expert-design-system recortó design-system.md (33,445 →
  27,597) contra un budget de 25,600 que ya era válido.

**Fix (v1.3)**:
- **Budgets recalibrados al límite empírico**: research 20480→32768,
  design-system 25600→32768, wireframes 40960→49152, layouts 15360→20480,
  critique 25600→32768, design-proposal 20480→32768 (`harness.manifest.json`).
- **Write directo si ≤ 28 KB**: el experto estima el tamaño ANTES de escribir;
  `.tmp/`/`--sources` solo si > 28 KB o si el write directo falla (antes el
  umbral era ~15 KB y se asumía que la tool trunca — falso).
- **Presupuesto por sección al 90% antes de escribir**: repartir el budget entre
  secciones; nunca descubrir el exceso recién en el check.
- **Recorte dirigido con delta**: si `--check` falla, compactar por prioridad
  (supuestos/alternativas → contexto; nunca borrar citas archivo:línea) usando
  el delta exacto del script; **nunca regenerar todo desde cero**; máx 2 ciclos
  → STOP y reportar al orquestador (`SKILL.md` Artifact integrity + Retry policy
  + bloque ESCRITURA ROBUSTA de `install.mjs`).
- **`write-md.mjs --report`**: lista el tamaño por sección fuente y el recorte
  necesario en bytes (exit 2 si excede), para guiar el recorte dirigido.
- Tests: 21/21 (2 nuevos: estrategia G6 en prompts + `--report`).

**Impacto esperado**: un artefacto que antes costó 16 min / ~208k tokens (9
ciclos) se escribe en 1 intento conservando el contenido completo.

---

# Verificación de la v1.3

- `node --test` → 21/21 (incluye tests de la estrategia G6 y de `--report`).
- Reinstalar en los proyectos con `/design` (`node install.mjs install --force`)
  para que los prompts/budgets nuevos tomen efecto.
