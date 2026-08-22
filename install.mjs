#!/usr/bin/env node
/**
 * install.mjs — Instalador del design-harness en un proyecto opencode
 *
 * Ensambla el harness (agents + comando + golden rule + skill con scripts)
 * en el proyecto destino, parametrizado por flags. Idempotente, reversible.
 *
 * Uso (dentro del proyecto destino):
 *   node <path>/design-harness/install.mjs
 *   node <path>/design-harness/install.mjs --write-paths "apps/web/src/**" --gates "pnpm typecheck;pnpm lint"
 *   node <path>/design-harness/install.mjs --check
 *   node <path>/design-harness/install.mjs --uninstall
 *   node <path>/design-harness/install.mjs --dry-run
 *
 * Flags:
 *   --project <dir>        Proyecto destino (default: cwd)
 *   --write-paths <p>      Glob de escritura del executor (default: src/**)
 *   --gates "a;b"          Gates del proyecto, separadas por ; (default: pnpm typecheck;pnpm lint)
 *   --package-filter <f>   Prefijo de paquete (ej: @org/console) — opcional
 *   --check                Diagnóstico sin modificar (exit 0 = instalado, 1 = incompleto)
 *   --uninstall            Revierte la instalación (respeta docs/design/ existente)
 *   --dry-run              Muestra las acciones sin escribirlas
 *   --force                Reemplaza artefactos existentes (skill dir, bloque golden rule)
 *   --skip-skills-check    Omite la verificación de skills de expertos
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, statSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))
const HARNESS_NAME = "design-harness"
const ORCHESTRATOR = "design-orchestrator"
const SKILL_SRC = join(HARNESS_DIR, "skills", ORCHESTRATOR)
const MARKER = ".design-harness-installed.json"

const EXPERT_SKILLS = [
  { skill: "ui-ux-pro-max", source: "nextlevelbuilder/ui-ux-pro-max-skill", install: "npx skills add nextlevelbuilder/ui-ux-pro-max-skill -g" },
  { skill: "impeccable", source: "pbakaus/impeccable", install: "npx skills add pbakaus/impeccable -g" },
  { skill: "vercel-react-best-practices", source: "vercel-labs/agent-skills", install: "npx skills add vercel-labs/agent-skills -g" },
]

/* ---------- utilidades ---------- */

function parseArgs(argv) {
  const args = { project: process.cwd(), writePaths: "src/**", gates: ["pnpm typecheck", "pnpm lint"], check: false, uninstall: false, dryRun: false, force: false, skipSkills: false, packageFilter: null }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => argv[++i]
    switch (flag) {
      case "--project": args.project = next(); break
      case "--write-paths": args.writePaths = next(); break
      case "--gates": args.gates = next().split(";").map((g) => g.trim()).filter(Boolean); break
      case "--package-filter": args.packageFilter = next(); break
      case "--check": args.check = true; break
      case "--uninstall": args.uninstall = true; break
      case "--dry-run": args.dryRun = true; break
      case "--force": args.force = true; break
      case "--skip-skills-check": args.skipSkills = true; break
    }
  }
  return args
}

function readJson(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, "utf8")) } catch { return null }
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

function renderExpertPrompt(expert, scopeDir) {
  const skills = expert.skills.map((s) => `skill({ name: "${s}" })`).join(" and ")
  const inputs = (expert.input ?? [])
    .map((i) => (typeof i === "string" ? i : i.ref))
    .join(", ")
  const override = expert.overrides?.prompt ? `\n- ${expert.overrides.prompt.replace(/\n/g, "\n- ")}` : ""
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
    `${override}`,
    `- Return a concise summary to the orchestrator: ${expert.summary}.`,
  ].filter((l) => l.trim() !== "" || l === "").join("\n")
}

function renderExecutorPrompt(executor, gates, writePaths) {
  const gateLines = gates.map((g) => {
    const [cmd, ...rest] = g.split(" ")
    return `- ${g}: gate ${rest.includes("typecheck") ? "typecheck" : ""}`.trim()
  })
  const gateBlock = gates
    .map((g, i) => `${i + 1}. \`${g}\``)
    .join("\n")
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
    `- If any gate is red: revert the slice per the blueprint's rollback section and report — never commit a red slice.`,
    ``,
    `COMMIT (only when all gates are green): stage ONLY the slice paths listed in the blueprint + the blueprint artifact itself; commit message exactly as given in your task prompt. Never git add -A/git add ., never amend, never push.`,
    ``,
    `HARD CONSTRAINTS: no migrations, no prisma generate, no dependency installs, no edits outside ${writePaths} unless the blueprint says so.`,
    `If any tool call is permission-denied, STOP and report the denial verbatim — do not work around it.`,
    ``,
    `RETURN to the orchestrator: (a) files applied (NEW/MOD), (b) per-gate results with the REAL numbers recorded, (c) commit hash, (d) final git status --short, (e) any deviation from the blueprint and why.`,
  ].join("\n")
}

function renderOrchestratorPrompt(gates, packageFilter) {
  const gateList = gates.map((g) => `\`${g}\``).join(", ")
  const pf = packageFilter ? ` (prefijo de paquete: ${packageFilter})` : ""
  return [
    `You are the ${ORCHESTRATOR}, the central coordinator of the ${HARNESS_NAME} harness (Mixture of Experts).`,
    ``,
    `SCOPE: the target (scope, e.g. "settings-page") is given in the user request or the command argument. All artifacts for this scope live under docs/design/<scope>/.`,
    ``,
    `PIPELINE (run in strict order, delegating each phase via the Task tool to the expert subagents):`,
    ``,
    `0. BASELINE (gate): verify git status is clean, then run the baseline gates: ${gateList}${pf}. Record the baseline commit SHA. If the baseline is not green, STOP and report — never proceed on a red baseline.`,
    `0.5. Create the artifacts directory: mkdir -p docs/design/<scope>.`,
    `1. Delegate to expert-research: (brief, audiencia, contexto visual del proyecto, mapa de pantallas). Handoff: pasa el scope y la ruta docs/design/<scope>/research.md.`,
    `2. Delegate to expert-design-system: (estilo, paleta, tipografía, tokens, anti-patrones — input: research). Handoff: pasa research.md como input, ruta de salida docs/design/<scope>/design-system.md.`,
    `3. Delegate to expert-wireframe: (wireframes por pantalla, layouts.md, wireframe.html lo-fi — inputs: research + design-system). Handoff: pasa ambos artifacts como inputs, rutas de salida bajo docs/design/<scope>/.`,
    `4. Delegate to expert-critique: (ronda 1 — score por heurísticas sobre wireframes + layouts. ANTES de delegar, el orquestador renderiza wireframe.html en chrome-devtools y captura screenshots a docs/design/<scope>/screenshots/). Handoff: pasa wireframes + layouts + screenshots como inputs, ruta de salida docs/design/<scope>/critique.md.`,
    `5. Delegate to expert-wireframe: (ronda 2 — SOLO si el score de critique < umbral: refina wireframes con critique.md como input; si el score es aceptable, se omite). Handoff: pasa critique.md como input.`,
    `6. Delegate to expert-critique: (ronda 2 — re-evaluación final si hubo ronda 2; se omite si no hubo). Handoff: re-audita los wireframes refinados.`,
    ``,
    `HANDOFF RULE: every Task delegation MUST include the scope name and the exact artifact path so the expert writes into the right subfolder. Pass the prior artifacts' full paths as inputs.`,
    ``,
    `Synthesis (gate): consolidate all artifacts into docs/design/<scope>/design-proposal.md as surgical slices — un slice = una pantalla o componente del scope; sin cambiar contratos existentes; cada slice verificable con las gates del proyecto antes del commit. PRESENT the plan and STOP for user approval.`,
    ``,
    `EXECUTION (only after approval): delegate each slice to the executor subagent via the Task tool (blueprint = design-proposal.md + the exact slice). Never apply source edits yourself in this phase — you only validate the executor's return (files applied, per-gate results, commit hash, final git status). If a slice leaves the tree red, have it reverted before continuing.`,
    ``,
    `HARD CONSTRAINTS:`,
    `- You are the ONLY agent allowed to edit source code, and only after approval. In the execution phase, however, delegate EVERY slice to the executor via the Task tool — never apply source edits yourself; you only validate the return.`,
    `- Never skip a gate. Never parallelize phases — handoff is strictly sequential.`,
    `- Keep every change behavior-preserving unless the approved plan explicitly allows a contract change.`,
    `- Shared-kernel artifacts (cross-scope contracts) go under docs/design/shared/.`,
  ].join("\n")
}

/* ---------- permisos ---------- */

function expertPermissions(expert) {
  const bashAllow = ["git *", "ls *", "find *", "cat *", "rg *"]
  if (expert.skills.includes("ui-ux-pro-max")) bashAllow.push("python3 *")
  if (expert.skills.includes("impeccable")) {
    bashAllow.push("npx impeccable *", "node .opencode/skills/impeccable/scripts/*")
  }
  const skillAllow = Object.fromEntries(expert.skills.map((s) => [s, "allow"]))
  return {
    edit: { "*": "deny", "docs/design/**": "allow" },
    bash: { "*": "deny", ...Object.fromEntries(bashAllow.map((b) => [b, "allow"])) },
    skill: { "*": "deny", ...skillAllow },
  }
}

function executorPermissions(writePaths) {
  const bashAllow = ["git *", "pnpm *", "npm *", "yarn *", "ls *", "find *", "cat *", "rg *", "grep *", "wc *", "rm *", "mkdir *"]
  return {
    edit: { "*": "deny", [writePaths]: "allow", "docs/**": "allow" },
    bash: { "*": "deny", ...Object.fromEntries(bashAllow.map((b) => [b, "allow"])) },
    skill: { "*": "allow" },
  }
}

/* ---------- build de opencode.json ---------- */

function buildConfig(manifestData, args) {
  const m = manifestData
  const writePaths = args.writePaths
  const agents = {}

  agents[ORCHESTRATOR] = {
    description: m.orchestrator.agent.description,
    mode: "primary",
    prompt: renderOrchestratorPrompt(args.gates, args.packageFilter),
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
      prompt: renderExpertPrompt(expert),
      permission: expertPermissions(expert),
    }
  }

  agents.executor = {
    description: m.roster.executor.description,
    mode: "subagent",
    prompt: renderExecutorPrompt(m.roster.executor, args.gates, writePaths),
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

/* ---------- skills check ---------- */

function skillDirs(project) {
  return [
    join(project, ".opencode", "skills"),
    join(project, ".agents", "skills"),
    join(homedir(), ".config", "opencode", "skills"),
    join(homedir(), ".agents", "skills"),
  ]
}

function checkExpertSkills(project) {
  const missing = []
  for (const entry of EXPERT_SKILLS) {
    const found = skillDirs(project).some((dir) => existsSync(join(dir, entry.skill)))
    if (!found) missing.push(entry)
  }
  return missing
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
  return { action: "append", path }
}

function stripGoldenRule(project) {
  const path = join(project, "AGENTS.md")
  if (!existsSync(path)) return { action: "skip", path }
  const content = readFileSync(path, "utf8")
  if (!content.includes(GOLDEN_START)) return { action: "skip", path }
  return { action: "strip", path }
}

/* ---------- main ---------- */

function main() {
  const args = parseArgs(process.argv.slice(2))
  const project = resolve(args.project)
  if (!existsSync(project) || !statSync(project).isDirectory()) {
    throw new Error(`Proyecto destino no encontrado: ${project}`)
  }

  const m = manifest()

  if (args.check) {
    const { cfg } = readAgentsConfig(project)
    const skillDir = join(project, ".opencode", "skills", ORCHESTRATOR)
    const agentsOk = !!cfg.agent?.[ORCHESTRATOR] && !!cfg.agent?.executor
    const commandOk = !!cfg.command?.design
    const skillOk = existsSync(join(skillDir, "SKILL.md")) && existsSync(join(skillDir, "scripts", "render-audit.js"))
    const goldenOk = existsSync(join(project, "AGENTS.md")) && readFileSync(join(project, "AGENTS.md"), "utf8").includes(GOLDEN_START)
    const missing = args.skipSkills ? [] : checkExpertSkills(project)
    const rows = [
      ["Agents (orchestrator + expertos + executor)", agentsOk ? "ok" : "falta"],
      ["Comando /design", commandOk ? "ok" : "falta"],
      ["Skill design-orchestrator + scripts", skillOk ? "ok" : "falta"],
      ["Golden rule en AGENTS.md", goldenOk ? "ok" : "falta"],
      ["docs/design/", existsSync(join(project, "docs", "design")) ? "ok" : "falta"],
      ...missing.map((s) => [`Skill experto: ${s.skill}`, "falta — instala con: " + s.install]),
    ]
    console.log(`## Diagnóstico design-harness en ${project}\n`)
    for (const [k, v] of rows) console.log(`- [${v === "ok" ? "x" : " "}] ${k}: ${v}`)
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
    if (args.dryRun) {
      log("dry-run", `desinstalaría: ${cfgPath} (quitar agents+comando), ${golden.path} (${golden.action}), ${skillDir}${existsSync(marker) ? " (con marker → borrado)" : " (sin marker → se conserva)"}`)
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
    } else {
      log("skip", "golden rule ausente")
    }
    if (existsSync(skillDir) && existsSync(marker)) {
      rmSync(skillDir, { recursive: true, force: true })
      log("ok", `${skillDir} — skill removida (instalada por el instalador)`)
    } else if (existsSync(skillDir)) {
      log("warn", `${skillDir} — no tiene marker del instalador; se conserva (¿instalada manualmente?)`)
    }
    log("ok", "design-harness desinstalado (docs/design/ se conserva)")
    return
  }

  // Instalación
  const built = buildConfig(m, args)
  const { path: cfgPath, cfg } = readAgentsConfig(project)
  const merged = mergeConfig(cfg, built)
  const skillDir = join(project, ".opencode", "skills", ORCHESTRATOR)
  const skillExists = existsSync(skillDir)
  const golden = upsertGoldenRule(project, args.force)
  const docsDir = join(project, "docs", "design")
  const missingSkills = args.skipSkills ? [] : checkExpertSkills(project)

  if (args.dryRun) {
    log("dry-run", `escribiría ${cfgPath} (agents + comando /design, ${Object.keys(built.agent).length} agents)`)
    log("dry-run", `${skillExists && !args.force ? "skill existente → skip (usa --force para reemplazar)" : "copiaría skill a " + skillDir}`)
    log("dry-run", `${golden.path}: ${golden.action}`)
    log("dry-run", `crearía ${docsDir}`)
    for (const s of missingSkills) log("warn", `skill faltante: ${s.skill} → ${s.install}`)
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

  if (golden.action === "skip") {
    log("skip", `${golden.path} — golden rule ya presente`)
  } else {
    const content = golden.action === "create" ? "" : readFileSync(golden.path, "utf8")
    const block = goldenRuleBlock()
    const next = golden.action === "append"
      ? content.replace(/\s*$/, "\n") + "\n" + block + "\n"
      : golden.action === "replace"
        ? content.replace(/\n?<!-- DESIGN-HARNESS START -->[\s\S]*?<!-- DESIGN-HARNESS END -->\n?/, "\n" + block + "\n")
        : block + "\n"
    writeFileSync(golden.path, next)
    log("ok", `${golden.path} — golden rule ${golden.action === "create" ? "creada" : golden.action}`)
  }

  mkdirSync(docsDir, { recursive: true })
  log("ok", `${docsDir} — directorio de artefactos`)

  if (missingSkills.length) {
    for (const s of missingSkills) log("warn", `skill de experto faltante: ${s.skill} → instala con: ${s.install}`)
    log("warn", "Sin las skills de expertos, los subagentes degradarán (el orquestador inyecta la metodología).")
  }

  log("ok", "design-harness instalado. Reinicia opencode y selecciona el modo design-orchestrator.")
}

try {
  main()
} catch (err) {
  console.error(`install: ${err.message}`)
  process.exit(1)
}