# design-orchestrator — Recursos del harness

Skill del orquestador del design-harness. Este directorio se instala en
`.opencode/skills/design-orchestrator/` de cada proyecto vía `install.mjs`.

## Contenido

| Recurso | Rol |
|---|---|
| `SKILL.md` | Skill del orquestador: roster, pipeline, gates, handoff, fail-safe |
| `scripts/render-audit.js` | Auditoría medida del render: contraste WCAG real, ritmo, escala tipográfica, target sizes, overflow, focus. El critique lo inyecta en el wireframe renderizado vía chrome-devtools `evaluate`; devuelve JSON con passes/fails numéricos. Complementa (no reemplaza) la metodología de impeccable. |
| `scripts/run-metrics.mjs` | Reporte post-run: tokens por agente, costo, delegaciones, contexto del orquestador, calidad. Genera `docs/design/shared/run-metrics-<scope>.{json,md}`. |

## Métricas post-run

```bash
node .opencode/skills/design-orchestrator/scripts/run-metrics.mjs --scope <scope>
node .opencode/skills/design-orchestrator/scripts/run-metrics.mjs --session <session-id>
```

Flags: `--window-tokens <n>` (ventana del modelo), `--observed-context-pct <n>`
(% de contexto visto en la UI), `--tripwires <n>`, `--approval-rounds <n>`.

**Los números son crudos.** Los umbrales del reporte pertenecen al caso de
referencia (ver README del paquete) — otro modelo u otro sistema tiene su propia
ventana y su propio punto de degradación.

## Nota de ejecución

- `render-audit.js` asume un wireframe con estados en `body[data-state]`
  (convención del harness); `renderAudit({ all: true })` recorre todos los estados.
- `run-metrics.mjs` lee la DB de opencode (`~/.local/share/opencode/opencode.db`)
  en modo read-only; requiere Node ≥ 22.5 (usa `node:sqlite`).