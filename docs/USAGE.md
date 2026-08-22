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
npx design-harness install --write-paths "apps/web/src/**"
# o, si el paquete aún no está publicado en npm:
npx github:luismasuarez/design-harness install --write-paths "apps/web/src/**"
```

Con el repo clonado: `node design-harness/install.mjs install <flags>` (equivalente).

### Flags principales

| Flag | Default | Qué configura |
|---|---|---|
| `--write-paths` | `src/**` | Dónde puede escribir el executor (el código que implementa) |
| `--gates "a;b"` | `pnpm typecheck;pnpm lint` | Gates del baseline y de cada slice |
| `--package-filter` | — | Prefijo de paquete del monorepo (ej: `@org/console`) |
| `--install-skills` | — | Instala automáticamente las skills de expertos faltantes (clona el repo fuente y copia la skill al dir global de opencode) |
| `--skills-dir` | `~/.config/opencode/skills` | Directorio destino de las skills instaladas por `--install-skills` |
| `--check` | — | Diagnóstico de instalación (exit 0 = completa) |
| `--uninstall` | — | Revierte la instalación (respeta `docs/design/` y tu config) |
| `--dry-run` | — | Muestra qué haría sin escribir nada |
| `--force` | — | Reemplaza skill/golden rule existentes |

### Skills de expertos (automático o manual)

El harness usa 3 skills para sus expertos: `ui-ux-pro-max`, `impeccable` y
`vercel-react-best-practices`. El instalador las verifica al instalar.

**Automático (recomendado)** — durante la instalación:

```bash
node design-harness/install.mjs --install-skills
```

Clona cada repo fuente (`git clone --depth 1`) y copia la skill a
`~/.config/opencode/skills/` (dir de discovery global de opencode). Es
determinista: usa el `skillPath` exacto declarado en el manifest. Si alguna
falla (sin red, path inexistente), reporta el warning y te da la alternativa
manual — nunca aborta la instalación del harness.

**Manual** — las 3 vías equivalentes:

```bash
npx skills add nextlevelbuilder/ui-ux-pro-max-skill -g
npx skills add pbakaus/impeccable -g
npx skills add vercel-labs/agent-skills -g
```

```bash
git clone --depth 1 https://github.com/pbakaus/impeccable /tmp/impeccable
cp -r /tmp/impeccable/.agents/skills/impeccable ~/.config/opencode/skills/
```

> Nota: `ui-ux-pro-max-skill` y `agent-skills` contienen varias skills — si el
> CLI `npx skills` te pide seleccionar, elige la exacta (`ui-ux-pro-max` /
> `vercel-react-best-practices`). Con `--install-skills` no hay selección: copia
> solo la skill declarada en el manifest.

Después de cualquier vía: `node design-harness/install.mjs --check` y reinicia
opencode (el discovery de skills corre al arrancar).

Sin las skills el harness degrada (el orquestador inyecta la metodología), pero
instálalas para calidad completa.

## 3. Primer diseño

1. Reinicia opencode (para que cargue agents y comando).
2. En el selector de agentes verás **un solo modo nuevo**: `Design-Orchestrator`.
   Selecciónalo.
3. Ejecuta con tu brief:

```
/design settings-page "Mejora la página de ajustes: jerarquía, estados de carga y errores, UX copy. Respeta los contratos existentes y el design system del proyecto."
```

1. El pipeline corre solo y se detiene en `docs/design/settings-page/design-proposal.md`
   esperando tu OK. Revisa la propuesta (slices, contratos, riesgos) y aprueba o pide cambios.
2. Tras tu OK, el executor implementa slice por slice: gates verdes + commit por slice.
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

```
/design dev-profile

Mejora la sección de perfil de usuario (DevProfilePage) en apps/console/src/features/dev/.
El estado actual es una sola Card con formulario de lectura/edición: email (disabled),
nombre, empresa, GitHub y teléfono. Quiero una propuesta de rediseño de nivel
producto, no solo un maquillaje.

Objetivos de la propuesta (evalúa cuáles aportan más valor, no implementes todos por inercia):
1. Cabecera de perfil con avatar (iniciales o placeholder), nombre, empresa y estado
   de cuenta; jerarquía visual clara.
2. Layout de dos columnas (contenido principal + barra lateral) o secciones
   visualmente diferenciadas: Datos personales / Empresa / Enlaces (GitHub, web) /
   Preferencias.
3. Mejorar estados: loading con skeleton realista, empty (sin datos), error con
   retry, y feedback de guardado (éxito/error).
4. UX copy en español LATAM neutral, tuteo, consistente con el resto de la consola.
5. Respeta el design system del proyecto: usa DESIGN.md, tokens y componentes de
   @/core/components/ui (shadcn). Nada de clases ad hoc fuera del sistema.

Restricciones:
- NO cambies contratos existentes: DevProfile, use-dev-profile, schema zod
  (profileFormSchema) ni el endpoint del SDK. Cualquier cambio de campos debe
  marcarse como propuesta opcional en la síntesis, nunca como requisito.
- Los componentes deben seguir el patrón presentacional del código actual
  (dumb components + hooks por separado).
- Mantén el test existente profile-form.spec.tsx funcionando; si la propuesta
  altera el formulario, incluye en el plan la actualización de tests como slice.
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
node /ruta/a/design-harness/install.mjs --force
```

Para re-generar los artefactos desde el manifest usando el estándar completo,
puedes usar [harness-factory](https://github.com/luismasuarez/harness-factory)
(`/factory build`).

## 7. Troubleshooting

| Problema | Solución |
|---|---|
| No aparece el modo `Design-Orchestrator` | Reinicia opencode; verifica `node install.mjs --check` |
| El critique no audita el render | Verifica el MCP `chrome-devtools` habilitado; el critique degrada a snapshot de accesibilidad + métricas DOM |
| Gates fallan en el baseline | El harness se detiene (tripwire) y reporta; corrige el baseline antes de continuar — es la red de seguridad |
| El critique no ve imágenes | Es la vía compatible: audita el DOM renderizado con métricas medidas (`render-audit.js`); para auditoría visual de píxeles usa un modelo con visión |
| Quieres deshacer | `node install.mjs --uninstall` revierte agents, comando, skill y golden rule; tus artefactos de `docs/design/` se conservan |
