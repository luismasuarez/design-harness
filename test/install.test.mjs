/**
 * test/install.test.mjs — Smoke test del instalador del design-harness
 *
 * Crea un proyecto falso en /tmp, ejecuta install.mjs (instalar → idempotencia
 * → check → uninstall) y verifica el estado en cada paso.
 *
 * Ejecutar: node --test test/
 */
import { test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const INSTALLER = join(dirname(fileURLToPath(import.meta.url)), "..", "install.mjs")
const EMBEDDED_SKILLS = ["ui-ux-pro-max", "impeccable", "vercel-react-best-practices", "vercel-react-native-skills"]
let project

function run(...args) {
  return spawnSync(process.execPath, [INSTALLER, "--project", project, ...args], {
    encoding: "utf8",
  })
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"))
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "design-harness-test-"))
  mkdirSync(join(project, ".opencode"), { recursive: true })
  writeFileSync(
    join(project, "opencode.json"),
    JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      mcp: { shadcn: { type: "local", enabled: true } },
      agent: { "custom-agent": { description: "preexistente" } },
      command: { hello: { description: "pre", agent: "custom-agent", template: "hi $ARGUMENTS" } },
    }, null, 2) + "\n"
  )
  writeFileSync(join(project, "AGENTS.md"), "# Proyecto falso\n\nTexto existente.\n")
})

afterEach(() => {
  rmSync(project, { recursive: true, force: true })
})

test("instala: agents, comando, skill+scripts, golden rule, docs/design y skills vendoriizadas", () => {
  const r = run("--write-paths", "apps/web/src/**", "--gates", "pnpm typecheck;pnpm lint", "--stack", "both")
  assert.equal(r.status, 0, r.stderr)
  const cfg = readJson(join(project, "opencode.json"))
  assert.ok(cfg.agent["design-orchestrator"])
  assert.equal(cfg.agent["design-orchestrator"].mode, "primary")
  assert.equal(cfg.agent["expert-research"].mode, "subagent")
  assert.equal(cfg.agent["expert-wireframe"].mode, "subagent")
  assert.equal(cfg.agent["expert-critique"].mode, "subagent")
  assert.equal(cfg.agent.executor.mode, "subagent")
  assert.deepEqual(cfg.agent.executor.permission.edit["apps/web/src/**"], "allow")
  assert.equal(cfg.command.design.agent, "design-orchestrator")
  assert.ok(cfg.agent["custom-agent"], "agent preexistente preservado")
  assert.ok(cfg.command.hello, "comando preexistente preservado")
  assert.ok(cfg.mcp.shadcn, "mcp preexistente preservado")
  const skillDir = join(project, ".opencode", "skills", "design-orchestrator")
  assert.ok(existsSync(join(skillDir, "SKILL.md")))
  assert.ok(existsSync(join(skillDir, "scripts", "render-audit.js")))
  assert.ok(existsSync(join(skillDir, "scripts", "run-metrics.mjs")))
  assert.ok(existsSync(join(skillDir, ".design-harness-installed.json")), "marker presente")
  for (const skill of EMBEDDED_SKILLS) {
    const dir = join(project, ".opencode", "skills", skill)
    assert.ok(existsSync(join(dir, "SKILL.md")), `skill embebida ${skill} presente`)
    assert.ok(existsSync(join(dir, ".design-harness-installed.json")), `marker de ${skill} presente`)
  }
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8")
  assert.ok(agents.includes("<!-- DESIGN-HARNESS START -->"))
  assert.ok(agents.includes("Golden Rule: el trabajo de diseño UI/UX"))
  assert.ok(existsSync(join(project, "docs", "design")))
})

test("la skill ui-ux-pro-max embebida reescribe sus rutas al path del proyecto", () => {
  run()
  const skillMd = readFileSync(join(project, ".opencode", "skills", "ui-ux-pro-max", "SKILL.md"), "utf8")
  assert.ok(skillMd.includes("python3 .opencode/skills/ui-ux-pro-max/scripts/search.py"), "rutas reescritas a .opencode/skills")
  assert.ok(!skillMd.includes("python3 skills/ui-ux-pro-max/scripts/search.py"), "sin rutas legacy skills/")
})

test("idempotente: segunda instalación no duplica", () => {
  run()
  const r2 = run()
  assert.equal(r2.status, 0, r2.stderr)
  const cfg = readJson(join(project, "opencode.json"))
  assert.equal(Object.keys(cfg.agent).filter((k) => k === "design-orchestrator").length, 1)
  assert.equal(Object.keys(cfg.command).filter((k) => k === "design").length, 1)
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8")
  assert.equal(agents.split("<!-- DESIGN-HARNESS START -->").length - 1, 1, "un solo bloque golden rule")
})

test("--check reporta instalación completa (exit 0) y luego incompleta tras uninstall (exit 1)", () => {
  run()
  const ok = run("--check")
  assert.equal(ok.status, 0, ok.stdout)
  assert.ok(ok.stdout.includes("Instalación completa"), ok.stdout)
  const u = run("--uninstall")
  assert.equal(u.status, 0, u.stderr)
  const missing = run("--check")
  assert.equal(missing.status, 1, "check debe fallar tras uninstall")
})

test("--uninstall revierte y preserva lo preexistente", () => {
  run()
  const u = run("--uninstall")
  assert.equal(u.status, 0, u.stderr)
  const cfg = readJson(join(project, "opencode.json"))
  assert.ok(!cfg.agent?.["design-orchestrator"])
  assert.ok(!cfg.command?.design)
  assert.ok(cfg.agent["custom-agent"], "agent preexistente intacto")
  assert.ok(cfg.command.hello, "comando preexistente intacto")
  assert.ok(cfg.mcp.shadcn, "mcp intacto")
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8")
  assert.ok(!agents.includes("DESIGN-HARNESS START"))
  assert.ok(!existsSync(join(project, ".opencode", "skills", "design-orchestrator")), "skill removida")
})

test("--dry-run no escribe nada", () => {
  const before = readFileSync(join(project, "opencode.json"), "utf8")
  const r = run("--dry-run")
  assert.equal(r.status, 0, r.stderr)
  const after = readFileSync(join(project, "opencode.json"), "utf8")
  assert.equal(after, before)
  assert.ok(!existsSync(join(project, ".opencode", "skills", "design-orchestrator")))
  assert.ok(!existsSync(join(project, "docs", "design")))
})

test("gates parametrizadas llegan al prompt del executor", () => {
  run("--gates", "pnpm --filter @org/console typecheck;pnpm lint")
  const cfg = readJson(join(project, "opencode.json"))
  assert.ok(cfg.agent.executor.prompt.includes("pnpm --filter @org/console typecheck"))
  assert.ok(cfg.agent["design-orchestrator"].prompt.includes("pnpm --filter @org/console typecheck"))})

test("auto-detecta gates del proyecto: typecheck/tsc, workspaces y lint:ci", () => {
  // Simula un monorepo pnpm con app raíz (sin script typecheck) + workspace cli
  writeFileSync(join(project, "pnpm-lock.yaml"), "")
  writeFileSync(join(project, "tsconfig.json"), "{}")
  const pkg = readJson(join(project, "opencode.json"))
  writeFileSync(join(project, "package.json"), JSON.stringify({
    name: "root-app",
    scripts: { "lint:ci": "biome ci ." },
    workspaces: ["cli"],
  }, null, 2))
  mkdirSync(join(project, "cli"), { recursive: true })
  writeFileSync(join(project, "cli", "package.json"), JSON.stringify({
    name: "@portal-saas/cli",
    scripts: { typecheck: "tsc --noEmit" },
  }, null, 2))
  const r = run()
  assert.equal(r.status, 0, r.stderr)
  const cfg = readJson(join(project, "opencode.json"))
  const executorPrompt = cfg.agent.executor.prompt
  assert.ok(executorPrompt.includes("npx tsc --noEmit"), "typecheck raíz sin script → tsc --noEmit")
  assert.ok(executorPrompt.includes("pnpm --filter @portal-saas/cli typecheck"), "workspace cli con typecheck propio")
  assert.ok(executorPrompt.includes("pnpm lint:ci"), "usa lint:ci (no modifica) sobre lint")
})

test("--uninstall remueve las skills embebidas por el instalador", () => {
  run("--stack", "both")
  for (const skill of EMBEDDED_SKILLS) {
    assert.ok(existsSync(join(project, ".opencode", "skills", skill)), `${skill} presente tras instalar`)
  }
  const u = run("--uninstall")
  assert.equal(u.status, 0, u.stderr)
  for (const skill of EMBEDDED_SKILLS) {
    assert.ok(!existsSync(join(project, ".opencode", "skills", skill)), `${skill} removida por uninstall`)
  }
})

test("--uninstall conserva una skill de experto instalada manualmente (sin marker)", () => {
  run()
  const manual = join(project, ".opencode", "skills", "impeccable")
  rmSync(manual, { recursive: true, force: true })
  mkdirSync(manual, { recursive: true })
  writeFileSync(join(manual, "SKILL.md"), "---\nname: impeccable\ndescription: instalada a mano\n---\n")
  const u = run("--uninstall")
  assert.equal(u.status, 0, u.stderr)
  assert.ok(existsSync(join(manual, "SKILL.md")), "skill manual se conserva")
})

test("migra la golden rule legacy v1.0 (sin marcadores) sin duplicarla", () => {
  const legacy = `# Proyecto falso

Texto existente.

## Golden Rule: el trabajo de diseño UI/UX pasa por el harness design-harness

Cualquier tarea que involucre **generar propuestas de diseño UI/UX iterativas** DEBE pasar por el harness design-harness (Mixture of Experts).

**Trigger**: ejecuta \`/design <scope>\` o carga la skill \`design-orchestrator\`.

**Nunca evites el harness** haciendo este trabajo ad hoc.
`
  writeFileSync(join(project, "AGENTS.md"), legacy)
  const r = run("--force")
  assert.equal(r.status, 0, r.stderr)
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8")
  assert.equal(agents.split("<!-- DESIGN-HARNESS START -->").length - 1, 1, "un solo bloque con marcador")
  assert.equal(agents.split("## Golden Rule: el trabajo de diseño UI/UX pasa por el harness design-harness").length - 1, 1, "una sola golden rule, sin duplicado legacy")
  assert.ok(agents.includes("<!-- DESIGN-HARNESS END -->"), "bloque cerrado")
})

test("prompts de expertos incluyen escritura robusta (write-md) y budget", () => {
  run("--stack", "both")
  const cfg = readJson(join(project, "opencode.json"))
  const research = cfg.agent["expert-research"].prompt
  assert.ok(research.includes("write-md.mjs"), "expertos referencian write-md.mjs")
  assert.ok(research.includes("ESCRITURA ROBUSTA"), "regla de escritura robusta presente")
  const wireframe = cfg.agent["expert-wireframe"].prompt
  assert.ok(wireframe.includes("WIREFRAME CANÓNICO"), "regla wireframe canónico presente")
  assert.ok(wireframe.includes("TOKENS DEL PROYECTO"), "regla de tokens del proyecto presente")
  assert.ok(wireframe.includes("COBERTURA DE ESTADOS"), "regla de cobertura de estados presente")
  assert.ok(wireframe.includes("vercel-react-native-skills"), "wireframe carga la skill RN")
  assert.ok(wireframe.includes("STACK-AWARE"), "regla stack-aware del wireframe presente")
  const orq = cfg.agent["design-orchestrator"].prompt
  assert.ok(orq.includes("ARTIFACT INTEGRITY"), "orquestador valida integridad de artefactos")
  assert.ok(orq.includes("PARITY GATE"), "orquestador incluye gate de paridad")
})

test("prompts de expertos incluyen la estrategia G6 (write directo, presupuesto por sección, recorte dirigido)", () => {
  run("--stack", "both")
  const cfg = readJson(join(project, "opencode.json"))
  for (const id of ["expert-research", "expert-design-system", "expert-wireframe", "expert-critique"]) {
    const p = cfg.agent[id].prompt
    assert.ok(p.includes("28 KB"), `${id}: umbral de write directo <= 28 KB presente`)
    assert.ok(p.includes("PRESUPUESTO POR SECCIÓN"), `${id}: presupuesto por sección presente`)
    assert.ok(p.includes("RECORTE DIRIGIDO"), `${id}: recorte dirigido presente`)
    assert.ok(p.includes("--report"), `${id}: referencia a write-md --report`)
    assert.ok(p.includes("Máximo 2 ciclos"), `${id}: límite de 2 ciclos presente`)
    assert.ok(p.includes("TOPE DE EDITS"), `${id}: tope de edits correctivos presente`)
    assert.ok(p.includes("RELEER ANTES DE EDITAR"), `${id}: releer antes de editar presente`)
  }
})

test("el orquestador incluye la SESIÓN LIMPIA (toda delegación nueva sin task_id)", () => {
  run("--stack", "both")
  const cfg = readJson(join(project, "opencode.json"))
  const orq = cfg.agent["design-orchestrator"].prompt
  assert.ok(orq.includes("SESIÓN LIMPIA"), "orquestador con SESIÓN LIMPIA")
  assert.ok(orq.includes("SIN task_id"), "SESIÓN LIMPIA prohíbe reutilizar la sesión del experto")
  assert.ok(orq.includes("NUNCA reutilices la sesión del experto"), "SESIÓN LIMPIA explícita")
  assert.ok(orq.includes("retry transitorio del MISMO intento"), "task_id solo para retry transitorio")
})

test("write-md.mjs --report lista el tamaño por sección y el recorte necesario (G6-5)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "writemd-report-"))
  try {
    const s1 = join(tmp, "sec-1.md")
    const s2 = join(tmp, "sec-2.md")
    writeFileSync(s1, "# Sección 1\n\n" + "x".repeat(8000))
    writeFileSync(s2, "# Sección 2\n\n" + "x".repeat(4000))
    const script = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "design-orchestrator", "scripts", "write-md.mjs")
    // Dentro del budget → exit 0 y margen disponible
    const ok = spawnSync(process.execPath, [script, "--report", "--file", join(tmp, "out.md"), "--sources", s1, s2, "--budget", "20000"], { encoding: "utf8" })
    assert.equal(ok.status, 0, ok.stderr)
    assert.ok(ok.stdout.includes("sec-1.md"), "lista la sección 1")
    assert.ok(ok.stdout.includes("sec-2.md"), "lista la sección 2")
    assert.ok(ok.stdout.includes("margen disponible"), "reporta margen")
    // Sobre el budget → exit 2 y recorte necesario con delta exacto
    const over = spawnSync(process.execPath, [script, "--report", "--file", join(tmp, "out.md"), "--sources", s1, s2, "--budget", "10000"], { encoding: "utf8" })
    assert.equal(over.status, 2, "exit 2 cuando excede el budget")
    const total = Buffer.byteLength(readFileSync(s1)) + Buffer.byteLength(readFileSync(s2))
    assert.ok(over.stdout.includes(`recorte necesario: ${total - 10000} bytes`), `delta exacto en stdout: ${over.stdout}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("write-md.mjs --check falla con secciones duplicadas (anti-edit-storm, G6-6)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "writemd-dup-"))
  try {
    const out = join(tmp, "dup.md")
    writeFileSync(out, "# Reporte\n\n## 9.1 Targets táctiles\n\nx\n\n## 9.1 Targets táctiles\n\nx\n\n## 9.2 Disabled\n\nx\n")
    const script = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "design-orchestrator", "scripts", "write-md.mjs")
    const r = spawnSync(process.execPath, [script, "--check", "--file", out, "--budget", "100000"], { encoding: "utf8" })
    assert.equal(r.status, 1, "check debe fallar con sección duplicada")
    assert.ok(r.stderr.includes("sección duplicada"), `mensaje de duplicado en stderr: ${r.stderr}`)
    assert.ok(r.stderr.includes("9.1 Targets táctiles"), "cita el encabezado duplicado")
    // Sin duplicados → ok
    writeFileSync(out, "# Reporte\n\n## 9.1 Targets táctiles\n\nx\n\n## 9.2 Disabled\n\nx\n")
    const ok = spawnSync(process.execPath, [script, "--check", "--file", out, "--budget", "100000"], { encoding: "utf8" })
    assert.equal(ok.status, 0, ok.stderr)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})

test("detecta la raíz del proyecto desde un subdirectorio (sin --project)", () => {
  // Raíz con .git + workspace
  mkdirSync(join(project, ".git"), { recursive: true })
  mkdirSync(join(project, "package.json", ".."), { recursive: true })
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: "root" }))
  writeFileSync(join(project, "pnpm-workspace.yaml"), "packages:\n  - 'cli'\n")
  // Subdirectorio profundo
  const deep = join(project, "apps", "web", "src", "screens")
  mkdirSync(deep, { recursive: true })
  const r = spawnSync(process.execPath, [INSTALLER, "--dry-run"], {
    encoding: "utf8",
    cwd: deep,
  })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes(`escribiría ${join(project, "opencode.json")}`), `instala en la raíz: ${r.stdout}`)
})

test("--stack web (default): no instala ni carga la skill RN", () => {
  run()
  assert.ok(existsSync(join(project, ".opencode", "skills", "vercel-react-best-practices")), "skill web instalada")
  assert.ok(!existsSync(join(project, ".opencode", "skills", "vercel-react-native-skills")), "skill RN no instalada en web")
  const cfg = readJson(join(project, "opencode.json"))
  const wireframe = cfg.agent["expert-wireframe"].prompt
  assert.ok(wireframe.includes("skill({ name: \"vercel-react-best-practices\" })"), "wireframe carga skill web")
  assert.ok(!wireframe.includes("vercel-react-native-skills"), "wireframe NO referencia skill RN en web")
  assert.ok(!cfg.agent["expert-wireframe"].permission.skill["vercel-react-native-skills"], "permiso de skill RN ausente")
})

test("--stack mobile: instala la skill RN y no la web", () => {
  run("--stack", "mobile")
  assert.ok(existsSync(join(project, ".opencode", "skills", "vercel-react-native-skills")), "skill RN instalada")
  assert.ok(!existsSync(join(project, ".opencode", "skills", "vercel-react-best-practices")), "skill web no instalada en mobile")
  const cfg = readJson(join(project, "opencode.json"))
  const wireframe = cfg.agent["expert-wireframe"].prompt
  assert.ok(wireframe.includes("vercel-react-native-skills"), "wireframe carga skill RN")
  assert.ok(!wireframe.includes("vercel-react-best-practices"), "wireframe NO referencia skill web en mobile")
})

test("--stack both: instala ambas skills de Vercel", () => {
  run("--stack", "both")
  assert.ok(existsSync(join(project, ".opencode", "skills", "vercel-react-best-practices")), "skill web instalada")
  assert.ok(existsSync(join(project, ".opencode", "skills", "vercel-react-native-skills")), "skill RN instalada")
})

test("re-instalar web tras both remueve la skill RN (consistencia del stack)", () => {
  run("--stack", "both")
  assert.ok(existsSync(join(project, ".opencode", "skills", "vercel-react-native-skills")), "RN presente tras both")
  const r2 = run("--stack", "web", "--force")
  assert.equal(r2.status, 0, r2.stderr)
  assert.ok(!existsSync(join(project, ".opencode", "skills", "vercel-react-native-skills")), "RN removida al pasar a web")
})

test("--stack inválido falla con error claro", () => {
  const r = run("--stack", "desktop")
  assert.notEqual(r.status, 0, "debe fallar")
  assert.ok(r.stderr.includes("--stack inválido"), r.stderr)
})

test("gate detect de impeccable en el executor (skill embebida siempre presente)", () => {
  run()
  const cfg = readJson(join(project, "opencode.json"))
  assert.ok(cfg.agent.executor.prompt.includes("DETECT GATE"), "executor con DETECT GATE")
  assert.ok(cfg.agent.executor.prompt.includes("impeccable/scripts/detect.mjs"), "comando detect.mjs presente")
  assert.ok(cfg.agent["design-orchestrator"].prompt.includes("detect.mjs"), "orquestador audita wireframe con detect.mjs")
})

test("G8-1: orquestador con SESIÓN LIMPIA universal (toda delegación nueva sin task_id)", () => {
  run()
  const cfg = readJson(join(project, "opencode.json"))
  const orq = cfg.agent["design-orchestrator"].prompt
  assert.ok(orq.includes("SESIÓN LIMPIA"), "orquestador con SESIÓN LIMPIA")
  assert.ok(orq.includes("SIN task_id"), "prohíbe task_id en delegaciones nuevas")
  assert.ok(orq.includes("retry transitorio del MISMO intento"), "task_id solo para retry transitorio")
  assert.ok(!orq.includes("DELTA RULE"), "DELTA RULE vieja reemplazada por SESIÓN LIMPIA")
})

test("G8-2/3: expert-wireframe con SCOPE FIDELITY y FIDELIDAD DE DATOS", () => {
  run()
  const cfg = readJson(join(project, "opencode.json"))
  const wf = cfg.agent["expert-wireframe"].prompt
  assert.ok(wf.includes("SCOPE FIDELITY"), "wireframe con SCOPE FIDELITY")
  assert.ok(wf.includes('PLACEHOLDER mínimo declarado') || wf.includes('placeholder mínimo declarado'), "contexto fuera de alcance = placeholder")
  assert.ok(wf.includes('no reproduciendo su contenido interno') || wf.includes('sin reproducir su contenido interno'), "nunca reproducir contenido interno")
  assert.ok(wf.includes("FIDELIDAD DE DATOS"), "wireframe con FIDELIDAD DE DATOS")
  assert.ok(wf.includes('"no aplica"'), "dato inexistente → no aplica")
})

test("G8-5: expert-critique con heurísticas de SCOPE FIDELITY y FIDELIDAD DE DATOS", () => {
  run()
  const cfg = readJson(join(project, "opencode.json"))
  const cr = cfg.agent["expert-critique"].prompt
  assert.ok(cr.includes("SCOPE FIDELITY (heurística"), "critique con heurística de alcance")
  assert.ok(cr.includes("FIDELIDAD DE DATOS (heurística"), "critique con heurística de datos")
  assert.ok(cr.includes("NO es APROBADO"), "veredicto exige fidelidad")
  assert.ok(cr.includes("además del umbral de score"), "fidelidad es requisito, no solo score")
})

test("G9: orquestador con allowlist de permisos (fin de la fricción de aprobaciones)", () => {
  run()
  const cfg = readJson(join(project, "opencode.json"))
  const orq = cfg.agent["design-orchestrator"]
  const perm = orq.permission
  assert.ok(perm.edit && typeof perm.edit === "object", "edit NO es 'ask' plano")
  assert.equal(perm.edit["docs/design/**"], "allow", "orquestador escribe artefactos del pipeline sin confirmar")
  assert.equal(perm.edit["*"], "deny", "nunca edita código fuente (deny)")
  assert.ok(perm.bash && typeof perm.bash === "object", "bash NO es 'ask' plano")
  assert.equal(perm.bash["pnpm *"], "allow", "gates del baseline permitidas")
  assert.equal(perm.bash["node *"], "allow", "validación de artefactos permitida")
  assert.equal(perm.bash["sort *"], "allow", "inspección con sort permitida")
  assert.equal(perm.bash["*"], "ask", "lo desconocido sigue supervisado")
  assert.equal(perm.task["expert-*"], "allow", "delega a expertos")
  assert.equal(perm.task["*"], "deny", "no delega a agentes arbitrarios")
  // regla de agrupación presente en el prompt instalado
  assert.ok(orq.prompt.includes("GROUPED COMMANDS"), "prompt con GROUPED COMMANDS")
})