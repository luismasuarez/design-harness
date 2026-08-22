# design-harness 🎨

Harness Mixture-of-Experts de diseño UI/UX para opencode: investiga, genera
sistema de diseño, wireframes y layouts, critica con métricas medidas y —tras tu
aprobación— implementa en el stack real de tu proyecto.

Un solo modo en opencode (`design-orchestrator`), expertos invisibles por dentro.

![License](https://img.shields.io/github/license/luismasuarez/design-harness)
![Node](https://img.shields.io/badge/node-%3E%3D18-339933)

## Qué hace

```
/design <scope> "mejora la sección X..."
```

1. **Baseline gate** — gates del proyecto verdes (typecheck/lint) antes de tocar nada.
2. **Delegación read-only** — expertos que escriben artefactos en `docs/design/<scope>/`:
   `research` → `design-system` → `wireframes` (+ `wireframe.html` lo-fi renderizable) → `critique`.
3. **Loop de crítica con métricas medidas** — el critique audita el render real en el
   navegador: contraste WCAG calculado, ritmo, target sizes, overflow, focus
   (`scripts/render-audit.js`). Si el score < 4.0, iteración de refinamiento (máx 2 rondas).
4. **Síntesis y aprobación** — `design-proposal.md` espera tu OK explícito.
5. **Ejecución por slices** — tras tu OK, el `executor` implementa en tu stack
   (React/shadcn, etc.) un slice = un commit, gates por slice, sin tocar contratos.

## Requisitos

- [opencode](https://opencode.ai) con el MCP `chrome-devtools` configurado
- Node ≥ 18
- Skills de expertos (el instalador las verifica y te da el comando exacto):
  `ui-ux-pro-max`, `impeccable`, `vercel-react-best-practices`

## Instalación (en tu proyecto)

```bash
git clone https://github.com/luismasuarez/design-harness
node design-harness/install.mjs                              # defaults: src/** + pnpm gates
# o parametrizado a tu stack:
node design-harness/install.mjs --write-paths "apps/web/src/**" --gates "pnpm typecheck;pnpm lint"
node design-harness/install.mjs --check                      # diagnóstico
```

El instalador: agrega los 6 agents (orquestador primary + 4 expertos + executor,
todos subagentes invisibles) y el comando `/design` a tu `opencode.json`, copia la
skill con sus scripts a `.opencode/skills/design-orchestrator/`, appendea la
golden rule en `AGENTS.md` y crea `docs/design/`. Idempotente y reversible
(`--uninstall` respeta tus artefactos).

**Después**: reinicia opencode → selecciona el modo `design-orchestrator` →
`/design <scope>` con tu brief.

## Personalización

Edita `harness.manifest.json` del paquete (roster, pipeline, gates) y re-ejecuta
el instalador con `--force`. El manifest es la fuente de verdad (estándar
[harness-factory](https://github.com/luismasuarez/harness-factory)).

## Métricas post-run

```bash
node .opencode/skills/design-orchestrator/scripts/run-metrics.mjs --scope <scope>
```

Genera `docs/design/shared/run-metrics-<scope>.{json,md}`: tokens por agente,
costo, delegaciones, contexto del orquestador, calidad. Los umbrales del reporte
son del caso de referencia (abajo) — números crudos para comparar entre modelos
y sistemas.

## Caso de referencia

Corrida real de un **scope de perfil de usuario en una consola React (monorepo
pnpm)** con `deepseek-v4-flash` (ventana ~128K, rendimiento rápido ~20%):

| Métrica | Valor |
|---|---|
| Contexto del orquestador hasta la síntesis | **12%** de la ventana |
| Tokens del sistema (gran total) | ~975K |
| Costo total | ~$0.44 |
| Delegaciones | 6 (research, design-system, wireframe ×2, critique ×2) |
| Rondas de crítica hasta umbral | 2 (score 3.79 → **4.38/5**) |
| Aprobación de la síntesis | 1 vuelta |
| Tripwires disparadas | 1 (baseline lint rojo → corregido) |

Lección clave: la **delegación mantiene la ventana del orquestador estable**
(crecimiento sublineal); la ejecución siempre pasa por el `executor`, nunca la
hace el orquestador.

## Documentación

- [`docs/USAGE.md`](./docs/USAGE.md) — guía completa de uso para devs
- [`skills/design-orchestrator/README.md`](./skills/design-orchestrator/README.md) — recursos del harness

## Licencia

[MIT](./LICENSE)