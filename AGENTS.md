
<!-- DESIGN-HARNESS START -->
## Golden Rule: el trabajo de diseño UI/UX pasa por el harness design-harness

Cualquier tarea que involucre **generar propuestas de diseño UI/UX iterativas: investigación, sistema de diseño, wireframes y layouts con crítica visual, orquestadas por design-orchestrator** DEBE pasar por el harness design-harness (Mixture of Experts).

**Trigger**: ejecuta `/design <scope>` o carga la skill `design-orchestrator`. El orquestador delega en los expertos subagentes (`expert-research`, `expert-design-system`, `expert-wireframe`, `expert-critique`) y sintetiza la propuesta.

**Nunca evites el harness** haciendo este trabajo ad hoc.

## Invariantes del harness (aplicadas por `design-orchestrator`)

- **Baseline gate**: las gates del proyecto verdes antes de tocar nada. Si el baseline falla, no comienza el trabajo.
- **Expertos read-only**: los expertos solo analizan y escriben artefactos bajo `docs/design/<scope>` (una subcarpeta por scope; `docs/design/shared/` para contratos compartidos). Nunca editan código fuente.
- **Aprobación**: `docs/design/<scope>/design-proposal.md` (en la subcarpeta del scope) se presenta y espera tu OK explícito antes de cualquier edición.
- **Crítica con métricas medidas**: la crítica combina las heurísticas de impeccable con números reales del render (contraste WCAG, ritmo, target sizes, overflow, focus) vía `scripts/render-audit.js` + chrome-devtools; si el modelo no ve imágenes, la evidencia es el DOM renderizado (a11y snapshot + métricas).
- **Slices**: un slice = una pantalla o componente del scope; sin cambiar contratos existentes; cada slice verificable con las gates del proyecto antes del commit.
- **Gates por slice**: después de cada slice, las gates del proyecto; si algo queda en rojo, revierte el slice.

## Comandos

- `/design <scope>` — ejecuta el pipeline completo del harness (baseline → síntesis → aprobación → ejecución por slices).
<!-- DESIGN-HARNESS END -->
