# Skills vendoriizadas

Estas 3 skills de expertos viajan embebidas en el paquete y `install.mjs` las
copia automáticamente a `<proyecto>/.opencode/skills/<skill>/` en cada
instalación. Así el harness es autocontenido: sin clonar repos, sin depender de
la instalación global de opencode.

## Origen y licencias

| Skill | Repo fuente | Licencia | Cubre |
|---|---|---|---|
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | MIT | Investigación y design system |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | Apache 2.0 | Crítica y detector de UI |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT | Patrones web (React/Next.js) |
| `vercel-react-native-skills` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | MIT | Patrones móviles (RN/Expo) |

Para actualizar una skill: reemplaza su carpeta aquí por la versión nueva del
repo fuente (o `npx skills add <repo>` y copia la carpeta instalada) y corre los
tests del instalador.

## Notas de embebido

- Al copiar `ui-ux-pro-max`, el instalador reescribe las rutas de su `SKILL.md`
  (`skills/ui-ux-pro-max/scripts/…` → `.opencode/skills/ui-ux-pro-max/scripts/…`)
  para que sus scripts Python funcionen desde su ubicación real.
- `vercel-react-native-skills` se usa en `expert-wireframe` cuando el target del
  scope es móvil (React Native/Expo); `vercel-react-best-practices` para web.
  Ambas son markdown puro (sin scripts), así que no requieren reescritura.
- `--uninstall` remueve las skills embebidas solo si tienen el marker del
  instalador (una skill instalada a mano se conserva).