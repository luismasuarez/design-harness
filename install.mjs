#!/usr/bin/env node
/**
 * install.mjs — Instalador del design-harness en un proyecto opencode
 *
 * Ensambla el harness (agents + comando + golden rule + skill con scripts)
 * en el proyecto destino, parametrizado por flags. Idempotente, reversible.
 *
 * Uso (dentro del proyecto destino):
 *   node <path>/design-harness/install.mjs [install] [flags]
 *   npx github:luismasuarez/design-harness install --write-paths "apps/web/src/**"
 *   npx design-harness install --install-skills          (una vez publicado en npm)
 *   node <path>/design-harness/install.mjs --check
 *
 * Flags:
 *   --project <dir>        Proyecto destino (default: cwd)
 *   --write-paths <p>      Glob de escritura del executor (default: src/**)
 *   --gates "a;b"          Gates del proyecto, separadas por ; (default: pnpm typecheck;pnpm lint)
 *   --package-filter <f>   Prefijo de paquete (ej: @org/console) — opcional
 *   --stack <s>            Stack del proyecto: web|mobile|both (default: web).
 *                          Controla qué skills de Vercel se instalan y qué
 *                          carga el wireframe (web → react-best-practices,
 *                          mobile → react-native-skills, both → ambas).
 *   --check                Diagnóstico sin modificar (exit 0 = instalado, 1 = incompleto)
 *   --uninstall            Revierte la instalación (respeta docs/design/ existente)
 *   --dry-run              Muestra las acciones sin escribirlas
 *   --force                Reemplaza artefactos existentes (skill dir, bloque golden rule)
 *
 * Skills de expertos: se EMBEBEN en el paquete (skills/vendor/) y se copian
 * automáticamente a <proyecto>/.opencode/skills/<skill>/. Los flags legacy
 * --install-skills, --skip-skills-check, --skills-dir, --skills-src-dir y
 * --skills-check-dirs se aceptan por compatibilidad pero ya no tienen efecto.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, statSync, readdirSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))
const HARNESS_NAME = "design-harness"
const ORCHESTRATOR = "design-orchestrator"
const SKILL_SRC = join(HARNESS_DIR, "skills", ORCHESTRATOR)
const VENDOR_DIR = join(HARNESS_DIR, "skills", "vendor")
const MARKER = ".design-harness-installed.json"
const VALID_STACKS = ["web", "mobile", "both"]

/**
 * Skills de expertos vendoriizadas en skills/vendor/ (embebidas en el paquete).
 * Se copian automáticamente a <proyecto>/.opencode/skills/<skill>/ en cada instalación.
 * `platform`: "any" (siempre), "web" o "mobile" (solo según --stack).
 */
const EXPERT_SKILLS = [
  { skill: "ui-ux-pro-max", vendorDir: join(VENDOR_DIR, "ui-ux-pro-max"), platform: "any" },
  { skill: "impeccable", vendorDir: join(VENDOR_DIR, "impeccable"), platform: "any" },
  { skill: "vercel-react-best-practices", vendorDir: join(VENDOR_DIR, "vercel-react-best-practices"), platform: "web" },
  { skill: "vercel-react-native-skills", vendorDir: join(VENDOR_DIR, "vercel-react-native-skills"), platform: "mobile" },
]

/** True si una skill aplica para el stack elegido. */
function skillApplies(entry, stack) {
  return entry.platform === "any" || entry.platform === stack || stack === "both"
}

/** Valida el flag --stack (default web). */
function resolveStack(raw) {
  if (raw === null || raw === undefined) return "web"
  const s = String(raw).toLowerCase()
  if (!VALID_STACKS.includes(s)) throw new Error(`--stack inválido: ${raw} (usa web|mobile|both)`)
  return s
}

/**
 * Infiere el stack de las skills ya instaladas (para --check sin --stack):
 * mira qué skills de Vercel están presentes con marker. Si no hay ninguna,
 * devuelve null (→ el llamador usa el default web).
 */
function inferInstalledStack(project) {
  const hasWeb = existsSync(join(project, ".opencode", "skills", "vercel-react-best-practices", MARKER))
  const hasMobile = existsSync(join(project, ".opencode", "skills", "vercel-react-native-skills", MARKER))
  if (hasWeb && hasMobile) return "both"
  if (hasMobile) return "mobile"
  if (hasWeb) return "web"
  return null
}

/* ---------- utilidades ---------- */

function parseArgs(argv) {
  // Subcomando opcional: `design-harness install --flag` == `design-harness --flag`
  if (argv[0] === "install") argv = argv.slice(1)
  const args = { project: null, writePaths: "src/**", gates: null, stack: null, check: false, uninstall: false, dryRun: false, force: false, skipSkills: false, packageFilter: null, installSkills: false, skillsDir: join(homedir(), ".config", "opencode", "skills"), skillsSrcDir: null, skillsCheckDirs: null }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => argv[++i]
    switch (flag) {
      case "--project": args.project = next(); break
      case "--write-paths": args.writePaths = next(); break
      case "--gates": args.gates = next().split(";").map((g) => g.trim()).filter(Boolean); break
      case "--package-filter": args.packageFilter = next(); break
      case "--stack": args.stack = next(); break
      case "--check": args.check = true; break
      case "--uninstall": args.uninstall = true; break
      case "--dry-run": args.dryRun = true; break
      case "--force": args.force = true; break
      // Flags legacy: las skills van embebidas en el paquete; ya no aplican.
      case "--skip-skills-check":
      case "--install-skills":
      case "--skills-dir":
      case "--skills-src-dir":
      case "--skills-check-dirs":
        if (flag !== "--skip-skills-check" && flag !== "--install-skills") next()
        break
    }
  }
  return args
}

function readJson(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, "utf8")) } catch { return null }
}

/* ---------- auto-detección de gates ---------- */

/**
 * Detecta la raíz del proyecto desde un directorio arbitrario: sube hasta
 * encontrar el primer directorio con .git (raíz del repo) o con package.json
 * + pnpm-workspace.yaml (raíz de un monorepo sin .git). Si no hay ningún
 * marcador, usa el cwd. Permite correr `dh install` desde cualquier
 * subdirectorio del proyecto.
 */
function detectProjectRoot(start) {
  let dir = resolve(start)
  while (true) {
    if (existsSync(join(dir, ".git"))) return dir
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "pnpm-workspace.yaml"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return resolve(start) // llegamos a la raíz del filesystem
    dir = parent
  }
}

/** Detecta el gestor de paquetes desde el lockfile del proyecto. */
function detectPackageManager(project) {
  if (existsSync(join(project, "pnpm-lock.yaml"))) return "pnpm"
  if (existsSync(join(project, "yarn.lock"))) return "yarn"
  if (existsSync(join(project, "package-lock.json"))) return "npm"
  return "pnpm"
}

/**
 * Expande un patrón de workspace simple ("packages/*", "cli", ".") a
 * directorios existentes. Solo soporta el caso común (sin globs anidados).
 */
function expandWorkspaceGlobs(project, patterns) {
  const out = new Set()
  for (const p of patterns) {
    const clean = p.replace(/^\.\//, "")
    if (clean === ".") { out.add(project); continue }
    if (clean.includes("*")) {
      const [head, tail] = clean.split("*/")
      const dir = join(project, head || ".")
      if (existsSync(dir)) {
        for (const child of readdirSync(dir, { withFileTypes: true })) {
          if (child.isDirectory() && (!tail || existsSync(join(dir, child.name, tail)))) {
            out.add(join(dir, child.name, tail || ""))
          }
        }
      }
    } else if (existsSync(join(project, clean))) {
      out.add(join(project, clean))
    }
  }
  return [...out]
}

/** Workspaces del monorepo (pnpm-workspace.yaml o "workspaces" en package.json). */
function detectWorkspaces(project) {
  const pnpmWs = join(project, "pnpm-workspace.yaml")
  if (existsSync(pnpmWs)) {
    const yaml = readFileSync(pnpmWs, "utf8")
    const patterns = [...yaml.matchAll(/^\s*-\s+['"]?([^'"\n]+)['"]?\s*$/gm)].map((m) => m[1].trim())
    return expandWorkspaceGlobs(project, patterns.filter(Boolean))
  }
  const pkg = readJson(join(project, "package.json"))
  const ws = pkg?.workspaces
  if (Array.isArray(ws)) return expandWorkspaceGlobs(project, ws)
  if (ws?.packages) return expandWorkspaceGlobs(project, ws.packages)
  return []
}

/**
 * Infiere las gates del proyecto cuando el usuario no pasa --gates:
 * - typecheck: script "typecheck", o `tsc --noEmit` si hay tsconfig.
 * - workspaces con script typecheck propio (el typecheck raíz no los cubre).
 * - lint: script "lint:ci" (no modifica) o "lint".
 * Fallback conservador: pnpm typecheck;pnpm lint.
 */
function detectGates(project) {
  const pm = detectPackageManager(project)
  const pkg = readJson(join(project, "package.json"))
  const scripts = pkg?.scripts ?? {}
  const gates = []

  if (scripts.typecheck) gates.push(`${pm} typecheck`)
  else if (existsSync(join(project, "tsconfig.json"))) gates.push("npx tsc --noEmit")

  for (const ws of detectWorkspaces(project)) {
    if (ws === project) continue
    const pkg = readJson(join(ws, "package.json"))
    if (pkg?.name && pkg.scripts?.typecheck) {
      gates.push(`${pm} --filter ${pkg.name} typecheck`)
    }
  }

  if (scripts["lint:ci"]) gates.push(`${pm} lint:ci`)
  else if (scripts.lint) gates.push(`${pm} lint`)

  return gates.length ? gates : ["pnpm typecheck", "pnpm lint"]
}

function manifest() {
  const m = readJson(join(HARNESS_DIR, "harness.manifest.json"))
  if (!m) throw new Error("harness.manifest.json no encontrado junto al instalador")
  return m
}

function log(action, msg) {
  console.log(`${action ? action.padEnd(10) : ""} ${msg}`)
}

/* ---------- render de prompts (desde el manifest) ---------- */

function renderExpertPrompt(expert, scopeDir, stack = "web") {
  // Filtra las skills del experto por el stack del proyecto (las de plataforma
  // no aplicable no se cargan ni se referencian).
  const applicable = expert.skills.filter((s) => {
    const entry = EXPERT_SKILLS.find((e) => e.skill === s)
    return !entry || skillApplies(entry, stack)
  })
  const skills = applicable.map((s) => `skill({ name: "${s}" })`).join(" and ")
  const inputs = (expert.input ?? [])
    .map((i) => (typeof i === "string" ? i : i.ref))
    .join(", ")
  const override = expert.overrides?.prompt ? `\n- ${expert.overrides.prompt.replace(/\n/g, "\n- ")}` : ""
  const empirical = expert.id === "expert-research"
    ? `\n- VERIFICACIÓN EMPÍRICA: todo supuesto y todo gap cerrado como "no-gap" DEBE citar evidencia (archivo:línea o comando real ejecutado). Lo que no se pueda verificar se marca como "abierto/requiere verificación" — nunca lo des por cerrado por fe. Si existe una fuente funcional (otro proyecto, CLI propio, backend desplegado), verifica contra ella. Un gap mal cerrado en research cuesta un fix post-freeze.`
    : ""
  const writing = `\n- ESCRITURA ROBUSTA (límite real medido de la tool Write: writes OK de 33-46KB en corridas reales; el server no limita, el límite es la serialización del tool call):
  - Si el deliverable estimado <= 28 KB, escríbelo con UNA sola Write directa al destino. No uses .tmp/ ni ensamblaje sin necesidad.
  - Si estimas > 28 KB (o el write directo falla), escríbelo POR SECCIONES en docs/design/<scope>/.tmp/<artifact>.<n>.md y ensámblalo con: node .opencode/skills/design-orchestrator/scripts/write-md.mjs --file <destino> --sources <secciones ordenadas> --budget <budget-del-artefacto> --cleanup docs/design/<scope>/.tmp.
  - PRESUPUESTO POR SECCIÓN ANTES DE ESCRIBIR: reparte el budget del artefacto entre las secciones (la suma debe quedar <= 90% del budget). Estima el tamaño de cada sección mientras la redactas, no después del check.
  - Si --check falla por budget: RECORTE DIRIGIDO, nunca regeneres todo desde cero. Usa el delta exacto que reporta el script y compacta por prioridad: primero "Supuestos/alternativas" y el copy redundante, después contexto; NUNCA borres citas archivo:línea ni estados obligatorios. Para ver cuánto pesa cada sección: write-md.mjs --report --file <destino> --sources <secciones>.
  - Máximo 2 ciclos de regeneración completa. Si el check sigue fallando tras el 2º recorte dirigido, DETENTE y reporta al orquestador el delta y el plan de recorte en vez de seguir iterando.
  - TOPE DE EDITS (anti-edit-storm): escribe el artefacto con UNA escritura (write directo o --sources); como máximo 5 edits correctivos por artefacto. Si el ajuste exige más de 5 edits, REESCRIBE el archivo completo con el contenido ya compactado — nunca edites sección por sección (166 edits en design-system.md consumieron 367k tokens y 81 min en una corrida real).
  - RELEER ANTES DE EDITAR: tras ensamblar con write-md.mjs --sources, el archivo en disco cambió — relee SIEMPRE el archivo antes de cualquier edit (edit contra un oldString desactualizado = tool error + secciones duplicadas).
  - Valida al final con: write-md.mjs --file <destino> --check --budget <budget-del-artefacto>. El --check falla también si detecta secciones duplicadas (encabezado ##/### repetido). NUNCA partas el archivo a mano con marcas de continuación ([CONTINUAR], <!-- more -->) — invalidan el artefacto.`
  const wireframeRules = expert.id === "expert-wireframe"
    ? (() => {
        const stackSkills = applicable.filter((s) => ["vercel-react-best-practices", "vercel-react-native-skills"].includes(s))
        const stackNote = stackSkills.length
          ? `\n- SKILL DE STACK DISPONIBLE: este proyecto tiene instalada(s) ${stackSkills.map((s) => `\`${s}\``).join(", ")}. Usa la que aplique al target del scope; si el target no coincide con la instalada, explica la limitación en el wireframe.`
          : ""
        return `\n- WIREFRAME CANÓNICO: UNA variante por pantalla/estado/flujo. Sin subvariantes (WF-5c/5d, v2a/v2b, "opción A/B"). Las alternativas exploradas van a research.md (sección "Exploración / alternativas descartadas" con justificación), NUNCA al wireframe.
- TOKENS DEL PROYECTO: el wireframe.html usa los CSS custom props/tokens reales de DESIGN.md y del design system del proyecto; solo los tokens inexistentes se proponen, marcados como "propuesta de token" (el critique los valida).
- COBERTURA DE ESTADOS: cubre SIEMPRE loading, empty, error y los estados interactivos de cada pantalla (lectura/edición/guardando), con presupuestos de interacción (clics máx. por acción).${stackNote}`
      })()
    : ""
  return [
    `You are the ${expert.roleLabel} expert in the ${HARNESS_NAME} harness.`,
    ``,
    `MANDATORY FIRST STEP: load your skill by calling the skill tool: ${skills}. Read any reference files it provides.`,
    ``,
    `TARGET DIR: the scope name and artifact path are given in your task prompt (e.g. docs/design/<scope>/). Write ONLY under that directory.`,
    ``,
    `INPUT: read ${inputs || "the scope artifacts passed in your task prompt"}.`,
    ``,
    `TASK: using the skill's methodology, ${expert.task}. Then write your deliverable to the artifact path given in your task prompt (${expert.deliverable}) using the Write tool.`,
    ``,
    `HARD CONSTRAINTS:`,
    `- You are READ-ONLY on code: you may ONLY write inside the docs/design/ directory. Never edit source files.`,
    `- Never run installs, migrations or destructive commands.`,
    `${empirical}`,
    `${writing}`,
    `${wireframeRules}`,
    `${override}`,
    `- Return a concise summary to the orchestrator: ${expert.summary}.`,
  ].filter((l) => l.trim() !== "" || l === "").join("\n")
}

function renderExecutorPrompt(executor, gates, writePaths, hasImpeccable) {
  const extraGates = hasImpeccable
    ? [`node .opencode/skills/impeccable/scripts/detect.mjs --json --no-advisory <files-del-slice>`]
    : []
  const gateBlock = [...gates, ...extraGates]
    .map((g, i) => `${i + 1}. \`${g}\``)
    .join("\n")
  const detectBlock = hasImpeccable
    ? `
DETECT GATE (lint de UX): corre el detector de impeccable sobre los archivos NEW/MOD del slice: node .opencode/skills/impeccable/scripts/detect.mjs --json --no-advisory <files>. Expect no-new-warnings (baseline 0; los advisory NO cuentan). Si hay warnings nuevos, DOCUMENTALOS como deuda en el RETURN (ruta + antipattern) sin commitearlos como bloqueantes — nunca silencies el detector.`
    : ""
  return [
    `You are the executor subagent of the ${HARNESS_NAME} harness.`,
    ``,
    `MANDATORY FIRST STEP: read the blueprint path given in your task prompt IN FULL before touching any file. The blueprint is the source of truth: file inventory (NEW/MOD), exact file contents/diffs, execution order, rollback and gotchas.`,
    ``,
    `TASK: apply the blueprint exactly (files NEW/MOD, order, gotchas it documents). Then run the harness gates in order from the repo root:`,
    ``,
    gateBlock,
    ``,
    `Gate semantics:`,
    `- A gate with expect "green" must exit 0.`,
    `- A gate with expect "no-new-errors" must show NO NEW errors over the baseline count given in your task prompt. If the tool auto-fixes files, revert ONLY the known alien files listed in your task prompt with git checkout --; NEVER revert the slice files (formatting mutations on slice files stay; document them).`,
    `- A gate with expect "no-new-warnings" (detect de impeccable) must show NO NEW warnings over the slice baseline (0); advisories never count.`,
    `- If any gate is red: revert the slice per the blueprint's rollback section and report — never commit a red slice.`,
    `- Run gates with --force/--no-cache when available (turbo caches y puede dar falsos verdes).`,
    ``,
    `POST-WRITE VERIFICATION: after writing each NEW/MOD file, confirm it exists on disk and is non-trivial (git status --short debe listarlo). If a written file is missing from the tree, rewrite it and report the incident.`,
    `${detectBlock}`,
    ``,
    `COMMIT (only when all gates are green): stage ONLY the slice paths listed in the blueprint + the blueprint artifact itself; commit message exactly as given in your task prompt. Never git add -A/git add ., never amend, never push.`,
    ``,
    `HARD CONSTRAINTS: no migrations, no prisma generate, no dependency installs, no edits outside ${writePaths} unless the blueprint says so.`,
    ``,
    `RETURN to the orchestrator: (a) files applied (NEW/MOD) — verify each exists on disk, (b) per-gate results with the REAL numbers recorded (incl. detect warnings), (c) commit hash, (d) final git status --short, (e) any deviation from the blueprint and why.`,
  ].join("\n")
}

function renderOrchestratorPrompt(gates, packageFilter, hasImpeccable) {
  const gateList = gates.map((g) => `\`${g}\``).join(", ")
  const pf = packageFilter ? ` (prefijo de paquete: ${packageFilter})` : ""
  const detectNote = hasImpeccable
    ? ` En la síntesis, audita el wireframe.html aprobado con detect.mjs (node .opencode/skills/impeccable/scripts/detect.mjs --json --no-advisory <wireframe.html>) y cita los warnings en el design-proposal como deuda a evitar en la implementación.`
    : ""
  return [
    `You are the ${ORCHESTRATOR}, the central coordinator of the ${HARNESS_NAME} harness (Mixture of Experts).`,
    ``,
    `SCOPE: the target (scope, e.g. "settings-page") is given in the user request or the command argument. All artifacts for this scope live under docs/design/<scope>/.`,
    ``,
    `PIPELINE (run in strict order, delegating each phase via the Task tool to the expert subagents):`,
    ``,
    `0. RESUME CHECK: if docs/design/<scope>/RUN-STATE.json exists, read it and resume from the pending phase (verify artifacts on disk; re-run only what is missing). If not, start fresh.`,
    `0. BASELINE (gate): verify git status is clean, then run the baseline gates: ${gateList}${pf} with --force/--no-cache when available (turbo cachea y puede dar falsos verdes). Record the baseline commit SHA. If the baseline is not green, STOP and report — never proceed on a red baseline.`,
    `0.5. Create the artifacts directory: mkdir -p docs/design/<scope>.`,
    `0.6. CHECKPOINT: after EVERY completed phase, write/update docs/design/<scope>/RUN-STATE.json with: current phase, baseline SHA, artifacts written (path + size), subagents completed, critique threshold. This allows resuming after network/provider cuts without auditing the tree by hand.`,
    `1. Delegate to expert-research: (brief, audiencia, contexto visual del proyecto, mapa de pantallas). Handoff: pasa el scope y la ruta docs/design/<scope>/research.md. El research DEBE verificar empíricamente todo supuesto y "no-gap" (citar archivo:línea o comando real); lo que no se verifica se marca abierto. Si existe una fuente funcional (otro proyecto, CLI propio), se verifica contra ella. Las alternativas de diseño exploradas se documentan en research.md bajo "Exploración / alternativas descartadas" (con justificación) — NUNCA en el wireframe.`,
    `2. Delegate to expert-design-system: (estilo, paleta, tipografía, tokens, anti-patrones — input: research). Handoff: pasa research.md como input, ruta de salida docs/design/<scope>/design-system.md.`,
    `3. Delegate to expert-wireframe: (wireframes por pantalla, layouts.md, wireframe.html lo-fi — inputs: research + design-system). Handoff: pasa ambos artifacts como inputs, rutas de salida bajo docs/design/<scope>/. Indica el TARGET del scope (móvil React Native/Expo vs web) según el research/brief para que el wireframe aplique la skill de stack correcta. El wireframe es CANÓNICO: una variante por pantalla/estado/flujo, usando los tokens reales del proyecto; sin subvariantes acumuladas.`,
    `4. Delegate to expert-critique: (ronda 1 — score por heurísticas sobre wireframes + layouts. ANTES de delegar, el orquestador renderiza wireframe.html en chrome-devtools y prepara SIEMPRE evidencia ligera: screenshots en JPEG <= 250KB + snapshot de accesibilidad (a11y) + JSON de render-audit.js; guarda todo en docs/design/<scope>/screenshots/. Prohíbe al critique leer PNG/archivos > 500KB (bloquea subagentes sin visión). Handoff: pasa wireframes + layouts + screenshots como inputs, ruta de salida docs/design/<scope>/critique.md.`,
    `5. Delegate to expert-wireframe: (ronda 2 — SOLO si el score de critique < umbral: refina wireframes con critique.md como input; si el score es aceptable, se omite). Handoff: pasa critique.md como input. Los refinamientos se aplican IN PLACE (reemplazan el wireframe), nunca acumulando subvariantes.`,
    `6. Delegate to expert-critique: (ronda 2 — re-evaluación final si hubo ronda 2; se omite si no hubo). Handoff: re-audita los wireframes refinados.`,
    ``,
    `HANDOFF RULE: every Task delegation MUST include the scope name and the exact artifact path so the expert writes into the right subfolder. Pass the prior artifacts' full paths as inputs.`,
    ``,
    `ARTIFACT INTEGRITY: tras cada delegación, valida el artefacto con: node .opencode/skills/design-orchestrator/scripts/write-md.mjs --file <artefacto> --check --budget <bytes>. Confirma que existe, termina completo y no tiene marcadores de continuación sin resolver. Respeta los budgets del artifactBudget.`,
    ``,
    `RETRY POLICY: if a delegated subagent fails with a transient error (Upstream request failed, Endpoint is unavailable, network_error, invalid_request, response was not valid JSON), RETRY up to 3 times with backoff, resuming the SAME task_id if possible. Only after 3 failures apply the fail-safe rule (load the expert's skill yourself and inject its methodology). Record each retry in RUN-STATE.json and in the final report.`,
    ``,
    `DELTA RULE: un delta (refinamiento/actualización de un artefacto ya aprobado) se delega SIEMPRE con la tool Task SIN task_id — sesión nueva y limpia. NUNCA reutilices la sesión del experto para un delta (acumula el historial completo: un delta de design-system.md sobre la sesión de la ronda 1 llegó a 840 parts / 367k tokens y reintrodujo una sección duplicada que el usuario ya había corregido). Al delegar un delta, pasa en el prompt el estado ACTUAL del artefacto (contenido ya corregido + path).`,
    ``,
    `Synthesis (gate): consolidate all artifacts into docs/design/<scope>/design-proposal.md as surgical slices — un slice = una pantalla o componente del scope; sin cambiar contratos existentes; cada slice verificable con las gates del proyecto antes del commit. OBLIGATORIO: cuando el scope es una pantalla/sección, incluye un slice final de INTEGRACIÓN (conectar los componentes en la página real: routing, data fetching, estados loading/empty/error) — los slices por componente sin integración dejan la UI vacía aunque las gates pasen verdes. LISTA de pantallas canónicas (WF ids aprobados): la síntesis y el IMPLEMENTATION-PROMPT referencian SOLO esas; las alternativas descartadas quedan en research, no se implementan.${detectNote} PRESENT the plan and STOP for user approval.`,
    ``,
    `EXECUTION (only after approval): delegate each slice to the executor subagent via the Task tool (blueprint = design-proposal.md + the exact slice). Never apply source edits yourself in this phase — you only validate the executor's return (files applied and confirmed on disk, per-gate results, commit hash, final git status). If a slice leaves the tree red, have it reverted before continuing. After the integration slice: (a) verify the page actually renders (dev server + snapshot via chrome-devtools), and (b) run the PARITY GATE — delegate a final audit to expert-critique comparing the implemented UI against the canonical wireframe (states implemented vs wireframe states, copy, order, interaction budgets). Only close the scope when parity passes.`,
    ``,
    `HARD CONSTRAINTS:`,
    `- You are the ONLY agent allowed to edit source code, and only after approval. In the execution phase, however, delegate EVERY slice to the executor via the Task tool — never apply source edits yourself; you only validate the return.`,
    `- Never skip a gate. Never parallelize phases — handoff is strictly sequential.`,
    `- Keep every change behavior-preserving unless the approved plan explicitly allows a contract change.`,
    `- Shared-kernel artifacts (cross-scope contracts) go under docs/design/shared/.`,
  ].join("\n")
}

/* ---------- permisos ---------- */

function expertPermissions(expert, stack = "web") {
  // Deny por defecto bloqueó decenas de comandos de inspección (wc, grep, sed,
  // node -e, pipes...) en las corridas reales. Ampliamos el allow con las
  // herramientas estándar de lectura/verificación y pasamos el resto a "ask"
  // (supervisado) en vez de deny silencioso.
  const bashAllow = [
    "git *",
    "git show *",
    "git log *",
    "git diff *",
    "ls *",
    "find *",
    "cat *",
    "rg *",
    "grep *",
    "wc *",
    "sed *",
    "file *",
    "head *",
    "tail *",
    "mkdir *",
    "node *",
    "npx *",
  ]
  if (expert.skills.includes("ui-ux-pro-max")) bashAllow.push("python3 *")
  if (expert.skills.includes("impeccable")) {
    bashAllow.push("npx impeccable *", "node .opencode/skills/impeccable/scripts/*")
  }
  const applicable = expert.skills.filter((s) => {
    const entry = EXPERT_SKILLS.find((e) => e.skill === s)
    return !entry || skillApplies(entry, stack)
  })
  const skillAllow = Object.fromEntries(applicable.map((s) => [s, "allow"]))
  return {
    edit: { "*": "deny", "docs/design/**": "allow" },
    bash: { "*": "ask", ...Object.fromEntries(bashAllow.map((b) => [b, "allow"])) },
    skill: { "*": "deny", ...skillAllow },
  }
}

function executorPermissions(writePaths) {
  const bashAllow = [
    "git *",
    "git show *",
    "git log *",
    "git diff *",
    "git status *",
    "pnpm *",
    "npm *",
    "yarn *",
    "node *",
    "npx *",
    "python3 *",
    "ls *",
    "find *",
    "cat *",
    "rg *",
    "grep *",
    "wc *",
    "sed *",
    "cp *",
    "mv *",
    "rm *",
    "file *",
    "mkdir *",
    "head *",
    "tail *",
  ]
  return {
    edit: { "*": "deny", [writePaths]: "allow", "docs/**": "allow" },
    bash: { "*": "ask", ...Object.fromEntries(bashAllow.map((b) => [b, "allow"])) },
    skill: { "*": "allow" },
  }
}

/* ---------- build de opencode.json ---------- */

function buildConfig(manifestData, args) {
  const m = manifestData
  const writePaths = args.writePaths
  const stack = resolveStack(args.stack)
  const agents = {}
  // Las skills de expertos van vendoriizadas en el paquete y se copian al
  // proyecto según el stack: el gate detect de impeccable queda activo siempre.
  const hasImpeccable = true

  agents[ORCHESTRATOR] = {
    description: m.orchestrator.agent.description,
    mode: "primary",
    prompt: renderOrchestratorPrompt(args.gates, args.packageFilter, hasImpeccable),
    permission: {
      edit: "ask",
      bash: "ask",
      task: { "*": "deny", "expert-*": "allow", "executor": "allow" },
      skill: { "*": "deny", [ORCHESTRATOR]: "allow" },
    },
  }

  for (const expert of m.roster.experts) {
    agents[expert.id] = {
      description: expert.description,
      mode: "subagent",
      prompt: renderExpertPrompt(expert, null, stack),
      permission: expertPermissions(expert, stack),
    }
  }

  agents.executor = {
    description: m.roster.executor.description,
    mode: "subagent",
    prompt: renderExecutorPrompt(m.roster.executor, args.gates, writePaths, hasImpeccable),
    permission: executorPermissions(writePaths),
  }

  return {
    $schema: "https://opencode.ai/config.json",
    command: {
      design: {
        description: m.command.description,
        agent: m.command.agent,
        template: m.command.template,
      },
    },
    agent: agents,
  }
}

/* ---------- golden rule ---------- */

const GOLDEN_START = "<!-- DESIGN-HARNESS START -->"
const GOLDEN_END = "<!-- DESIGN-HARNESS END -->"
const LEGACY_GOLDEN_HEADER = "## Golden Rule: el trabajo de diseño UI/UX pasa por el harness design-harness"

function goldenRuleBlock() {
  return `${GOLDEN_START}
## Golden Rule: el trabajo de diseño UI/UX pasa por el harness design-harness

Cualquier tarea que involucre **generar propuestas de diseño UI/UX iterativas: investigación, sistema de diseño, wireframes y layouts con crítica visual, orquestadas por design-orchestrator** DEBE pasar por el harness design-harness (Mixture of Experts).

**Trigger**: ejecuta \`/design <scope>\` o carga la skill \`design-orchestrator\`. El orquestador delega en los expertos subagentes (\`expert-research\`, \`expert-design-system\`, \`expert-wireframe\`, \`expert-critique\`) y sintetiza la propuesta.

**Nunca evites el harness** haciendo este trabajo ad hoc.

## Invariantes del harness (aplicadas por \`design-orchestrator\`)

- **Baseline gate**: las gates del proyecto verdes antes de tocar nada. Si el baseline falla, no comienza el trabajo.
- **Expertos read-only**: los expertos solo analizan y escriben artefactos bajo \`docs/design/<scope>\` (una subcarpeta por scope; \`docs/design/shared/\` para contratos compartidos). Nunca editan código fuente.
- **Aprobación**: \`docs/design/<scope>/design-proposal.md\` (en la subcarpeta del scope) se presenta y espera tu OK explícito antes de cualquier edición.
- **Crítica con métricas medidas**: la crítica combina las heurísticas de impeccable con números reales del render (contraste WCAG, ritmo, target sizes, overflow, focus) vía \`scripts/render-audit.js\` + chrome-devtools; si el modelo no ve imágenes, la evidencia es el DOM renderizado (a11y snapshot + métricas).
- **Slices**: un slice = una pantalla o componente del scope; sin cambiar contratos existentes; cada slice verificable con las gates del proyecto antes del commit.
- **Gates por slice**: después de cada slice, las gates del proyecto; si algo queda en rojo, revierte el slice.

## Comandos

- \`/design <scope>\` — ejecuta el pipeline completo del harness (baseline → síntesis → aprobación → ejecución por slices).
${GOLDEN_END}`
}

/* ---------- skills de expertos (vendoriizadas) ---------- */

/**
 * Las 4 skills de expertos viajan EMBEBIDAS en el paquete bajo skills/vendor/.
 * `install` las copia a <proyecto>/.opencode/skills/<skill>/ según el --stack
 * elegido, sin clonar repos ni depender de la instalación global de opencode.
 */

/** True si la skill `<skill>` está instalada en el proyecto destino. */
function skillInstalled(project, skill) {
  return existsSync(join(project, ".opencode", "skills", skill, "SKILL.md"))
}

/** Skills que aplican al stack dado. */
function applicableSkills(skillList, stack) {
  return skillList.filter((entry) => skillApplies(entry, stack))
}

function checkExpertSkills(project, _extraDir, skillList = EXPERT_SKILLS, stack = "web") {
  return applicableSkills(skillList, stack).filter((entry) => !skillInstalled(project, entry.skill))
}

/**
 * Copia una skill vendoriizada al proyecto destino. Reescribe las rutas del
 * SKILL.md de ui-ux-pro-max (skills/ui-ux-pro-max/scripts → .opencode/skills/...).
 */
function copyVendoredSkill(entry, project) {
  const dest = join(project, ".opencode", "skills", entry.skill)
  if (!existsSync(join(entry.vendorDir, "SKILL.md"))) {
    return { ok: false, error: `skill vendoriizada ${entry.skill} sin SKILL.md en ${entry.vendorDir}` }
  }
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(join(project, ".opencode", "skills"), { recursive: true })
  cpSync(entry.vendorDir, dest, { recursive: true })
  writeFileSync(join(dest, MARKER), JSON.stringify({ harness: HARNESS_NAME, skill: entry.skill, installedAt: new Date().toISOString() }, null, 2) + "\n")
  if (entry.skill === "ui-ux-pro-max") {
    const skillMd = join(dest, "SKILL.md")
    const content = readFileSync(skillMd, "utf8")
    const next = content.replace(/skills\/ui-ux-pro-max\/scripts\//g, ".opencode/skills/ui-ux-pro-max/scripts/")
    if (next !== content) writeFileSync(skillMd, next)
  }
  return { ok: true, dest }
}

/**
 * Instala (o repara) las skills vendoriizadas aplicables al stack. Remueve las
 * skills instaladas por el instalador que ya no apliquen al stack (p. ej.
 * re-instalar `both` → `web` deja el proyecto consistente).
 */
function copyVendoredSkills(project, stack = "web") {
  const results = []
  const kept = []
  for (const entry of applicableSkills(EXPERT_SKILLS, stack)) {
    const res = copyVendoredSkill(entry, project)
    kept.push(entry.skill)
    results.push({ ...entry, ...res })
  }
  for (const entry of EXPERT_SKILLS) {
    if (kept.includes(entry.skill)) continue
    const dest = join(project, ".opencode", "skills", entry.skill)
    if (existsSync(join(dest, MARKER))) {
      rmSync(dest, { recursive: true, force: true })
      results.push({ ...entry, ok: true, removed: true })
    }
  }
  return results
}

/** Remueve las skills embebidas por el instalador (marcadas con el marker). */
function removeVendoredSkills(project) {
  const removed = []
  for (const entry of EXPERT_SKILLS) {
    const dest = join(project, ".opencode", "skills", entry.skill)
    if (existsSync(join(dest, MARKER))) {
      rmSync(dest, { recursive: true, force: true })
      removed.push(entry.skill)
    }
  }
  return removed
}

/* ---------- acciones ---------- */

function readAgentsConfig(project) {
  const path = join(project, "opencode.json")
  const cfg = readJson(path) ?? { $schema: "https://opencode.ai/config.json" }
  return { path, cfg }
}

function mergeConfig(cfg, built) {
  cfg.command = { ...cfg.command, ...built.command }
  cfg.agent = { ...cfg.agent, ...built.agent }
  return cfg
}

function stripConfig(cfg) {
  if (cfg.command) delete cfg.command.design
  if (cfg.agent) {
    delete cfg.agent[ORCHESTRATOR]
    for (const expert of ["expert-research", "expert-design-system", "expert-wireframe", "expert-critique"]) delete cfg.agent[expert]
    delete cfg.agent.executor
  }
  if (cfg.command && Object.keys(cfg.command).length === 0) delete cfg.command
  if (cfg.agent && Object.keys(cfg.agent).length === 0) delete cfg.agent
  return cfg
}

function upsertGoldenRule(project, force) {
  const path = join(project, "AGENTS.md")
  const block = goldenRuleBlock()
  if (!existsSync(path)) {
    return { action: "create", path }
  }
  const content = readFileSync(path, "utf8")
  if (content.includes(GOLDEN_START)) {
    return force ? { action: "replace", path } : { action: "skip", path }
  }
  if (content.includes(LEGACY_GOLDEN_HEADER)) {
    // Bloque v1.0 sin marcadores START/END (instalado antes de que el
    // instalador los usara). Reemplazarlo para NO duplicar la golden rule.
    return force ? { action: "replace-legacy", path } : { action: "skip-legacy", path }
  }
  return { action: "append", path }
}

function stripGoldenRule(project) {
  const path = join(project, "AGENTS.md")
  if (!existsSync(path)) return { action: "skip", path }
  const content = readFileSync(path, "utf8")
  if (content.includes(GOLDEN_START)) return { action: "strip", path }
  if (content.includes(LEGACY_GOLDEN_HEADER)) return { action: "strip-legacy", path }
  return { action: "skip", path }
}

/* ---------- main ---------- */

function main() {
  const args = parseArgs(process.argv.slice(2))
  const project = args.project ? resolve(args.project) : detectProjectRoot(process.cwd())
  if (!existsSync(project) || !statSync(project).isDirectory()) {
    throw new Error(`Proyecto destino no encontrado: ${project}`)
  }

  const m = manifest()
  const SKILLS = EXPERT_SKILLS
  const stack = args.stack ? resolveStack(args.stack) : (args.check ? inferInstalledStack(project) ?? "web" : "web")
  // Gates por defecto: auto-detectadas del proyecto (gestor, typecheck, lint,
  // workspaces). El usuario puede sobreescribirlas con --gates.
  if (!args.gates) args.gates = detectGates(project)

  if (args.check) {
    const { cfg } = readAgentsConfig(project)
    const skillDir = join(project, ".opencode", "skills", ORCHESTRATOR)
    const agentsOk = !!cfg.agent?.[ORCHESTRATOR] && !!cfg.agent?.executor
    const commandOk = !!cfg.command?.design
    const skillOk = existsSync(join(skillDir, "SKILL.md")) && existsSync(join(skillDir, "scripts", "render-audit.js"))
    const goldenOk = existsSync(join(project, "AGENTS.md")) && readFileSync(join(project, "AGENTS.md"), "utf8").includes(GOLDEN_START)
    const missing = checkExpertSkills(project, null, SKILLS, stack)
    const rows = [
      ["Agents (orchestrator + expertos + executor)", agentsOk ? "ok" : "falta"],
      ["Comando /design", commandOk ? "ok" : "falta"],
      ["Skill design-orchestrator + scripts", skillOk ? "ok" : "falta"],
      ["Golden rule en AGENTS.md", goldenOk ? "ok" : "falta"],
      ["docs/design/", existsSync(join(project, "docs", "design")) ? "ok" : "falta"],
      ["Stack", "ok (" + stack + ")"],
      ...missing.map((s) => [`Skill experto: ${s.skill}`, "falta — reinstala el harness (va embebida)"]),
    ]
    console.log(`## Diagnóstico design-harness en ${project}\n`)
    for (const [k, v] of rows) console.log(`- [${v.startsWith("ok") ? "x" : " "}] ${k}: ${v}`)
    const complete = agentsOk && commandOk && skillOk && goldenOk && missing.length === 0
    console.log(complete ? "\nInstalación completa." : "\nInstalación incompleta.")
    process.exit(complete ? 0 : 1)
  }

  if (args.uninstall) {
    const { path: cfgPath, cfg } = readAgentsConfig(project)
    const stripped = stripConfig(cfg)
    const skillDir = join(project, ".opencode", "skills", ORCHESTRATOR)
    const marker = join(skillDir, MARKER)
    const golden = stripGoldenRule(project)
    const vendored = EXPERT_SKILLS.map((e) => e.skill).filter((s) => existsSync(join(project, ".opencode", "skills", s, MARKER)))
    if (args.dryRun) {
      log("dry-run", `desinstalaría: ${cfgPath} (quitar agents+comando), ${golden.path} (${golden.action}), ${skillDir}${existsSync(marker) ? " (con marker → borrado)" : " (sin marker → se conserva)"}`)
      for (const s of vendored) log("dry-run", `removería skill embebida ${s}`)
      return
    }
    writeFileSync(cfgPath, JSON.stringify(stripped, null, 2) + "\n")
    log("ok", `${cfgPath} — agents y comando /design removidos`)
    if (golden.action === "strip") {
      const content = readFileSync(golden.path, "utf8")
      const start = content.indexOf(GOLDEN_START)
      const end = content.indexOf(GOLDEN_END) + GOLDEN_END.length
      const next = content.slice(0, start).trimEnd() + "\n" + content.slice(end).replace(/^\n+/, "")
      writeFileSync(golden.path, next)
      log("ok", `${golden.path} — bloque golden rule removido`)
    } else if (golden.action === "strip-legacy") {
      const content = readFileSync(golden.path, "utf8")
      const start = content.indexOf(LEGACY_GOLDEN_HEADER)
      const next = content.slice(0, start).trimEnd() + "\n"
      writeFileSync(golden.path, next)
      log("ok", `${golden.path} — bloque golden rule legacy (v1.0) removido`)
    } else {
      log("skip", "golden rule ausente")
    }
    if (existsSync(skillDir) && existsSync(marker)) {
      rmSync(skillDir, { recursive: true, force: true })
      log("ok", `${skillDir} — skill removida (instalada por el instalador)`)
    } else if (existsSync(skillDir)) {
      log("warn", `${skillDir} — no tiene marker del instalador; se conserva (¿instalada manualmente?)`)
    }
    const removed = removeVendoredSkills(project)
    for (const s of removed) log("ok", `.opencode/skills/${s} — skill embebida removida`)
    log("ok", "design-harness desinstalado (docs/design/ se conserva)")
    return
  }

  // Instalación
  if (args.packageFilter && !args.gates.some((g) => g.includes("tsc -b"))) {
    // El typecheck raíz de un monorepo (turbo) NO cubre paquetes sin script
    // "typecheck" (p.ej. el console usa tsc -b dentro del build). Si hay
    // --package-filter, añadimos el gate del paquete automáticamente.
    args.gates.push(`pnpm --filter ${args.packageFilter} exec tsc -b --force`)
  }
  const built = buildConfig(m, args)
  const { path: cfgPath, cfg } = readAgentsConfig(project)
  const merged = mergeConfig(cfg, built)
  const skillDir = join(project, ".opencode", "skills", ORCHESTRATOR)
  const skillExists = existsSync(skillDir)
  const golden = upsertGoldenRule(project, args.force)
  const docsDir = join(project, "docs", "design")

  if (args.dryRun) {
    log("dry-run", `escribiría ${cfgPath} (agents + comando /design, ${Object.keys(built.agent).length} agents)`)
    log("dry-run", `${skillExists && !args.force ? "skill existente → skip (usa --force para reemplazar)" : "copiaría skill a " + skillDir}`)
    log("dry-run", `${golden.path}: ${golden.action}`)
    log("dry-run", `crearía ${docsDir}`)
    for (const e of applicableSkills(EXPERT_SKILLS, stack)) log("dry-run", `copiaría skill embebida ${e.skill} → .opencode/skills/${e.skill} [${e.platform}]`)
    for (const e of EXPERT_SKILLS) {
      if (skillApplies(e, stack)) continue
      const dest = join(project, ".opencode", "skills", e.skill)
      if (existsSync(join(dest, MARKER))) log("dry-run", `removería skill embebida ${e.skill} (no aplica a --stack ${stack})`)
    }
    return
  }

  writeFileSync(cfgPath, JSON.stringify(merged, null, 2) + "\n")
  log("ok", `${cfgPath} — agents (${Object.keys(built.agent).length}) + comando /design`)

  if (skillExists && !args.force) {
    log("skip", `${skillDir} ya existe (usa --force para reemplazar con la del paquete)`)
  } else {
    rmSync(skillDir, { recursive: true, force: true })
    cpSync(SKILL_SRC, skillDir, { recursive: true })
    writeFileSync(join(skillDir, MARKER), JSON.stringify({ harness: HARNESS_NAME, version: m.harness.version, installedAt: new Date().toISOString() }, null, 2) + "\n")
    log("ok", `${skillDir} — skill + scripts instalados`)
  }

  if (golden.action === "skip" || golden.action === "skip-legacy") {
    log("skip", `${golden.path} — golden rule ya presente`)
  } else {
    const content = golden.action === "create" ? "" : readFileSync(golden.path, "utf8")
    const block = goldenRuleBlock()
    const next = golden.action === "append"
      ? content.replace(/\s*$/, "\n") + "\n" + block + "\n"
      : golden.action === "replace"
        ? content.replace(/\n?<!-- DESIGN-HARNESS START -->[\s\S]*?<!-- DESIGN-HARNESS END -->\n?/, "\n" + block + "\n")
        : golden.action === "replace-legacy"
          ? content.slice(0, content.indexOf(LEGACY_GOLDEN_HEADER)).trimEnd() + "\n\n" + block + "\n"
          : block + "\n"
    writeFileSync(golden.path, next)
    log("ok", `${golden.path} — golden rule ${golden.action === "create" ? "creada" : golden.action === "replace-legacy" ? "reemplazada (legacy)" : golden.action}`)
  }

  mkdirSync(docsDir, { recursive: true })
  log("ok", `${docsDir} — directorio de artefactos`)

  // Skills de expertos vendoriizadas → se copian las aplicables al --stack.
  const skillResults = copyVendoredSkills(project, stack)
  for (const res of skillResults) {
    if (res.removed) log("ok", `.opencode/skills/${res.skill} — skill removida (no aplica a --stack ${stack})`)
    else if (res.ok) log("ok", `.opencode/skills/${res.skill} — skill embebida copiada`)
    else log("warn", `skill ${res.skill} NO copiada: ${res.error}`)
  }
  const stillMissing = checkExpertSkills(project, null, SKILLS, stack)
  if (stillMissing.length) {
    for (const s of stillMissing) log("warn", `skill aún faltante en el proyecto: ${s.skill} (revisa skills/vendor/${s.skill})`)
  } else {
    log("ok", "skills de expertos disponibles en el proyecto")
  }

  log("ok", "design-harness instalado. Reinicia opencode y selecciona el modo design-orchestrator.")
}

try {
  main()
} catch (err) {
  console.error(`install: ${err.message}`)
  process.exit(1)
}