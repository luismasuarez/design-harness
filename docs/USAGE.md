# Uso del design-harness

Guía para desarrolladores que instalan el harness en su proyecto.

## 1. Requisitos

| Requisito | Nota |
|---|---|
| opencode | Con el MCP `chrome-devtools` habilitado (necesario para el loop visual: render del wireframe, screenshots y métricas) |
| Node ≥ 18 | Para el instalador y los scripts del harness |
| Git | El baseline gate verifica el árbol limpio |

## 2. Instalación

**Un solo comando** (sin clonar el repo):

```bash
npx ui-design-harness install --write-paths "apps/web/src/**"
# o, si el paquete aún no está publicado en npm:
npx github:luismasuarez/design-harness install --write-paths "apps/web/src/**"
```

Con el repo clonado: `node design-harness/install.mjs install <flags>` (equivalente).

**Shortcut local** (`dh`): enlaza el instalador a tu PATH una sola vez y usa un
comando corto desde cualquier subdirectorio:

```bash
ln -sf <ruta-a-design-harness>/install.mjs ~/.local/bin/dh
cd mi-proyecto/src/screens
dh install          # detecta la raíz del proyecto automáticamente
dh install --check
```

`dh` sube hasta la raíz del repo (`.git` o `package.json` + `pnpm-workspace.yaml`)
y opera ahí; con `--project <dir>` puedes apuntar a otro proyecto explícitamente.

> En proyectos Expo/React Native con monorepo pnpm, el instalador detecta solo
> las gates correctas: `npx tsc --noEmit` (o `pnpm typecheck` si existe),
> `pnpm --filter <workspace> typecheck` y `pnpm lint:ci`. No hace falta pasar
> `--gates` manualmente.

### Flags principales

| Flag | Default | Qué configura |
|---|---|---|
| `--write-paths` | `src/**` | Dónde puede escribir el executor (el código que implementa) |
| `--gates "a;b"` | auto-detectadas | Gates del baseline y de cada slice. Por defecto el instalador las infiere del proyecto: script `typecheck` (o `npx tsc --noEmit` si hay `tsconfig.json`), typecheck de workspaces que lo tengan propio, y `lint:ci` (o `lint`) |
| `--package-filter` | — | Prefijo de paquete del monorepo (ej: `@org/console`) — añade automáticamente `pnpm --filter <pkg> exec tsc -b --force` al gate, cubriendo paquetes sin script `typecheck` (el typecheck raíz de turbo no los cubre) |
| `--stack web\|mobile\|both` | `web` | Stack del proyecto. Controla qué skills de Vercel se instalan y qué carga el wireframe: `web` → `vercel-react-best-practices`, `mobile` → `vercel-react-native-skills`, `both` → ambas. Re-instalar con otro stack remueve las skills que ya no apliquen. `--check` infiere el stack de las skills instaladas si no pasas `--stack` |
| `--check` | — | Diagnóstico de instalación (exit 0 = completa) |
| `--uninstall` | — | Revierte la instalación (respeta `docs/design/` y tu config) |
| `--dry-run` | — | Muestra qué haría sin escribir nada |
| `--force` | — | Reemplaza skill/golden rule existentes |

> Flags legacy `--install-skills`, `--skip-skills-check`, `--skills-dir`,
> `--skills-src-dir` y `--skills-check-dirs` se aceptan por compatibilidad pero
> **ya no tienen efecto**: las skills de expertos van embebidas en el paquete.

### Skills de expertos (embebidas)

El harness usa 4 skills para sus expertos: `ui-ux-pro-max`, `impeccable`,
`vercel-react-best-practices` y `vercel-react-native-skills`. **Viajan
vendoriizadas dentro del paquete** (`skills/vendor/`) y el instalador las copia
automáticamente a `<proyecto>/.opencode/skills/<skill>/` en cada instalación. No
necesitas clonar repos, instalar nada en global ni correr flags extra — un solo
`install` lo deja todo listo y autocontenido en el proyecto.

El experto wireframe es **stack-aware según `--stack`**: en `web` carga y aplica
`vercel-react-best-practices` (waterfalls, bundle, fetching); en `mobile` carga
`vercel-react-native-skills` (listas virtualizadas, safe areas, navegación
nativa, expo-image, Pressable); en `both` ambas. Así una propuesta cubre tanto
UI web como móvil sin instalar skills que el proyecto no necesita.

Al copiar `ui-ux-pro-max`, el instalador reescribe las rutas de su `SKILL.md`
(`skills/ui-ux-pro-max/scripts/…` → `.opencode/skills/ui-ux-pro-max/scripts/…`)
para que sus scripts Python funcionen desde su ubicación real.

`--uninstall` remueve también las skills embebidas (solo las marcadas por el
instalador; una skill que tengas instalada a mano se conserva).

Después de instalar: `npx ui-design-harness install --check` y reinicia opencode
(el discovery de skills corre al arrancar).

## 3. Primer diseño

1. Reinicia opencode (para que cargue agents y comando).
2. En el selector de agentes verás **un solo modo nuevo**: `Design-Orchestrator`.
   Selecciónalo.
3. Ejecuta con tu brief:

```
/design settings-page "Mejora la página de ajustes: jerarquía, estados de carga y errores, UX copy. Respeta los contratos existentes y el design system del proyecto."
```

4. El pipeline corre solo y se detiene en `docs/design/settings-page/design-proposal.md`
   esperando tu OK. Revisa la propuesta (slices, contratos, riesgos) y aprueba o pide cambios.
5. Tras tu OK, el executor implementa slice por slice: gates verdes + commit por slice.
   Tú puedes detener el flujo en cualquier momento.

### Brief de ejemplo (listo para copiar)

```
/design settings-page

Mejora la página de ajustes de usuario en <apps/web/src/features/settings/>.
El estado actual es una sola Card con formulario de lectura/edición: email (disabled),
nombre, empresa y teléfono. Quiero una propuesta de rediseño de nivel producto,
no solo un maquillaje.

Objetivos de la propuesta (evalúa cuáles aportan más valor, no implementes todos por inercia):
1. Cabecera de perfil con avatar (iniciales o placeholder), nombre, empresa y estado
   de cuenta; jerarquía visual clara.
2. Layout de dos columnas (contenido principal + barra lateral) o secciones
   visualmente diferenciadas: Datos personales / Empresa / Enlaces / Preferencias.
3. Mejorar estados: loading con skeleton realista, empty (sin datos), error con
   retry, y feedback de guardado (éxito/error).
4. UX copy en español LATAM neutral, tuteo, consistente con el resto de la app.
5. Respeta el design system del proyecto: usa DESIGN.md, tokens y componentes de
   la librería UI. Nada de clases ad hoc fuera del sistema.

Restricciones:
- NO cambies contratos existentes: <DevProfile>, hook use-<entity>-profile, schema zod
  ni el endpoint del SDK. Cualquier cambio de campos debe marcarse como propuesta
  opcional en la síntesis, nunca como requisito.
- Los componentes deben seguir el patrón presentacional del código actual
  (dumb components + hooks por separado).
- Mantén los tests existentes funcionando; si la propuesta altera el formulario,
  incluye en el plan la actualización de tests como slice.
- Solo propuesta: tras la síntesis (design-proposal.md) espera mi aprobación
  explícita antes de implementar cualquier slice.
```

> Sustituye los marcadores `<apps/web/src/...>`, `<DevProfile>` y
> `use-<entity>-profile` por los nombres reales de tu proyecto. El harness
> investiga el contexto por sí solo: un brief corto ("mejora X respetando el
> design system") también basta.

## 4. Buenas prácticas del brief

- Describe el **estado actual** (qué hay hoy) y el **objetivo** (qué quieres).
- Declara **contratos intocables** (componentes, hooks, schemas, endpoints, tests).
- Pide respetar el **design system del proyecto** (DESIGN.md, tokens, librería UI).
- Pide la **propuesta primero**: el harness siempre espera tu OK antes de tocar código.

## 5. Métricas post-run

```bash
node .opencode/skills/design-orchestrator/scripts/run-metrics.mjs --scope settings-page
node .opencode/skills/design-orchestrator/scripts/run-metrics.mjs --session ses_xxxx  # por id de sesión
```

Genera `docs/design/shared/run-metrics-<scope>.{json,md}` con tokens, costo,
delegaciones, contexto del orquestador y calidad. Útil para comparar el costo de
los diseños entre scopes, modelos y equipos.

## 6. Personalización

El `harness.manifest.json` del paquete es la fuente de verdad (roster, pipeline,
gates, slices). Cámbialo y re-ejecuta:

```bash
npx ui-design-harness install --force
```

Para re-generar los artefactos desde el manifest usando el estándar completo,
puedes usar [harness-factory](https://github.com/luismasuarez/harness-factory)
(`/factory build`).

## 7. Troubleshooting

| Problema | Solución |
|---|---|
| No aparece el modo `Design-Orchestrator` | Reinicia opencode; verifica `npx ui-design-harness install --check` |
| El critique no audita el render | Verifica el MCP `chrome-devtools` habilitado; el critique degrada a snapshot de accesibilidad + métricas DOM |
| Gates fallan en el baseline | El harness se detiene (tripwire) y reporta; corrige el baseline antes de continuar — es la red de seguridad |
| El critique no ve imágenes | Es la vía compatible: audita el DOM renderizado con métricas medidas (`render-audit.js`); el orquestador ya prepara evidencia ligera (JPEG ≤ 250KB + a11y + JSON) para evitar que el critique lea PNG grandes que lo bloquean; para auditoría visual de píxeles usa un modelo con visión |
| Gates verdes "falsos" (turbo cache) | El harness corre las gates con `--force`/`--no-cache` cuando están disponibles; si sospechas un falso verde, re-corre el comando a mano sin caché |
| Comandos bash bloqueados en expertos/executor | El perfil de permisos usa allow para la inspección estándar (node, python3, wc, grep, sed, cp, mv, file, mkdir, git show/log/diff, etc.) y `ask` para el resto; si un comando con `pipe \|` no matchea un allow, usa redirección a un archivo temporal o pide aprobación |
| El pipeline se cortó por red/suscripción | Reanuda con `/design <scope>` (mismo scope): el orquestador lee `docs/design/<scope>/RUN-STATE.json` y continúa desde la fase pendiente sin re-auditar el árbol |
| Un subagente falla con "Endpoint is unavailable"/"network_error" | Es un fallo transitorio del proveedor: el orquestador reintenta hasta 3 veces reanudando el mismo `task_id`; si persiste, degrada inyectando la metodología de la skill manualmente |
| Un archivo recién escrito desapareció del disco | Incidente observado (causa indeterminada): el executor verifica post-escritura que cada archivo existe y aparece en `git status`; si se repite, reescríbelo y reporta. Revisa también que el directorio no esté en `.gitignore` |
| La página quedó vacía tras implementar los slices | La propuesta debe incluir un slice de integración (conectar componentes en la página real); si falta, añádelo y verifica el render real con el dev server antes de cerrar el scope |
| Quieres deshacer | `npx ui-design-harness install --uninstall` revierte agents, comando, skill y golden rule; tus artefactos de `docs/design/` se conservan |
