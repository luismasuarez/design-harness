# design-harness 🎨

Harness Mixture-of-Experts de diseño UI/UX para opencode: investiga, genera
sistema de diseño, wireframes y layouts, critica con métricas medidas y —tras tu
aprobación— implementa en el stack real de tu proyecto.

Un solo modo en opencode (`design-orchestrator`), expertos invisibles por dentro.

![License](https://img.shields.io/github/license/luismasuarez/design-harness)
![Version](https://img.shields.io/github/v/tag/luismasuarez/design-harness)
![Node](https://img.shields.io/badge/node-%3E%3D18-339933)
![Tests](https://img.shields.io/github/actions/workflow/status/luismasuarez/design-harness/test.yml?branch=main&label=tests)

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
- Python 3 (para los scripts de la skill `ui-ux-pro-max`)
- Skills de expertos: `ui-ux-pro-max`, `impeccable`, `vercel-react-best-practices`
  y `vercel-react-native-skills` — **van embebidas** en el paquete
  (`skills/vendor/`) y el instalador las copia a cada proyecto según `--stack`.
  No necesitas instalarlas aparte. `--stack web|mobile|both` decide cuáles: la
  de Vercel web se instala en targets web, la de React Native/Expo en móviles
  (`both` instala ambas).

## Instalación (en tu proyecto)

**Vía A — un solo comando (recomendada)**: sin clonar, desde tu proyecto:

```bash
npx ui-design-harness install --write-paths "apps/web/src/**"
npx ui-design-harness install --check
```

> El bin se llama `design-harness`: `npx -p ui-design-harness design-harness install ...`.
> Hasta publicar en npm, la vía equivalente es:
> `npx github:luismasuarez/design-harness install --write-paths "apps/web/src/**"`

**Vía B — clonando el repo**: igual de completa, con el código a mano:

```bash
git clone https://github.com/luismasuarez/design-harness
node design-harness/install.mjs install --stack mobile   # app móvil (RN/Expo)
node design-harness/install.mjs install                 # web por defecto
node design-harness/install.mjs install --stack both    # web + móvil
```

**Shortcut local (`dh`)**: para probar localmente sin escribir el path del
instalador, enlaza el binario a `~/.local/bin`:

```bash
ln -sf <ruta-a-design-harness>/install.mjs ~/.local/bin/dh
```

Luego, desde **cualquier subdirectorio** del proyecto (detecta la raíz solo):
`dh install`, `dh install --check`, `dh install --uninstall`. Con `--project <dir>`
apuntas a otro proyecto. El bin se llama `dh` (y `design-harness` si usas `npm link`).

**Vía C — skill del ecosistema**: solo la skill del orquestador (para usar con
`harness-factory` o como referencia):

```bash
npx skills add luismasuarez/design-harness -g -s design-orchestrator
```

El instalador: agrega los 6 agents (orquestador primary + 4 expertos + executor,
todos subagentes invisibles) y el comando `/design` a tu `opencode.json`, copia la
skill con sus scripts a `.opencode/skills/design-orchestrator/`, **copia las 4
skills de expertos embebidas** (`ui-ux-pro-max`, `impeccable`,
`vercel-react-best-practices`, `vercel-react-native-skills`) a `.opencode/skills/`,
appendea la golden rule en `AGENTS.md` y crea `docs/design/`. Idempotente y
reversible (`--uninstall` respeta tus artefactos y remueve también las skills
embebidas que haya instalado el instalador).

**Después**: reinicia opencode → selecciona el modo `design-orchestrator` →
`/design <scope>` con tu brief.

## Personalización

Edita `harness.manifest.json` del paquete (roster, pipeline, gates) y re-ejecuta
el instalador con `--force`. El manifest es la fuente de verdad (estándar
[harness-factory](https://github.com/luismasuarez/harness-factory)).

### Monorepos: gate de typecheck del paquete de UI

El typecheck raíz de un monorepo (turbo) no cubre paquetes sin script
`typecheck` (p.ej. un console que usa `tsc -b` dentro del build). Pasa el prefijo
del paquete y el instalador añade la gate correcta:

```bash
node design-harness/install.mjs install --force --package-filter "@org/console"
# añade: pnpm --filter @org/console exec tsc -b --force
```

## Autoevaluación del harness

El harness se mejora a sí mismo: **`/harness-audit`** es un comando interno
(disponible solo en el repo fuente `design-harness`) que repite la metodología
de auditoría sobre las corridas reales — evidencia (DB de sesiones + logs +
memoria) → análisis → propuesta → aprobación → aplicación → persistencia.

```bash
/harness-audit            # análisis + propuesta; espera tu OK antes de tocar
/harness-audit --apply    # aplica directo
/harness-audit --report   # solo reporte de incidentes
```

La metodología vive en `.opencode/skills/harness-audit/SKILL.md` y el helper de
evidencia en `.opencode/skills/harness-audit/scripts/collect-incidents.mjs`
(clasifica incidentes: provider_transient, permission_denial, task_cancelled,
tool_error, write_truncation). Cada ciclo deja su sección en
[`docs/IMPROVEMENTS.md`](./docs/IMPROVEMENTS.md) y una observación en Engram.

## Hallazgos y mejoras

Análisis empírico de las corridas reales y las correcciones de la v1.1
(checkpoints, reintentos, permisos, gates por-paquete, slice de integración,
evidencia ligera para la crítica, telemetría de incidentes): ver
[`docs/IMPROVEMENTS.md`](./docs/IMPROVEMENTS.md).

## Métricas post-run

```bash
node .opencode/skills/design-orchestrator/scripts/run-metrics.mjs --scope <scope>
```

Genera `docs/design/shared/run-metrics-<scope>.{json,md}`: tokens por agente,
costo, delegaciones, contexto del orquestador, calidad **e incidentes**
(reintentos por proveedor, denials de permisos, cancelaciones — ver
[`docs/IMPROVEMENTS.md`](./docs/IMPROVEMENTS.md)). Los umbrales del reporte
son del caso de referencia (abajo) — números crudos para comparar entre modelos
y sistemas.

> La estimación de contexto `input − cache_read` no es fiable en corridas largas
> (da 0 cuando cache_read ≥ input). Pasa `--observed-context-pct <n>` con el % que
> viste en la UI para un valor real.

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