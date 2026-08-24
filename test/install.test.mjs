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
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const INSTALLER = join(dirname(fileURLToPath(import.meta.url)), "..", "install.mjs")
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

test("instala: agents, comando, skill+scripts, golden rule, docs/design", () => {
  const r = run("--write-paths", "apps/web/src/**", "--gates", "pnpm typecheck;pnpm lint")
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
  const agents = readFileSync(join(project, "AGENTS.md"), "utf8")
  assert.ok(agents.includes("<!-- DESIGN-HARNESS START -->"))
  assert.ok(agents.includes("Golden Rule: el trabajo de diseño UI/UX"))
  assert.ok(existsSync(join(project, "docs", "design")))
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
  const ok = run("--check", "--skip-skills-check")
  assert.equal(ok.status, 0, ok.stdout)
  const u = run("--uninstall")
  assert.equal(u.status, 0, u.stderr)
  const missing = run("--check", "--skip-skills-check")
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
  assert.ok(cfg.agent["design-orchestrator"].prompt.includes("pnpm --filter @org/console typecheck"))
})

test("--install-skills instala las 3 skills de expertos desde repo fuente local", () => {
  // Repo fuente falso con los skillPaths del manifest
  const fakeRepo = mkdtempSync(join(tmpdir(), "dh-fake-repo-"))
  const skills = [
    [".claude/skills/ui-ux-pro-max", "ui-ux-pro-max"],
    [".agents/skills/impeccable", "impeccable"],
    ["skills/react-best-practices", "vercel-react-best-practices"],
  ]
  for (const [folder, name] of skills) {
    const dir = join(fakeRepo, folder)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: skill falsa para test\n---\n`)
  }
  const skillsDir = mkdtempSync(join(tmpdir(), "dh-skills-dest-"))
  const isolated = ["--skills-check-dirs", skillsDir]

  const r = run("--install-skills", "--skills-dir", skillsDir, "--skills-src-dir", fakeRepo, ...isolated)
  assert.equal(r.status, 0, r.stderr + r.stdout)
  assert.ok(existsSync(join(skillsDir, "ui-ux-pro-max", "SKILL.md")), "ui-ux-pro-max instalada")
  assert.ok(existsSync(join(skillsDir, "impeccable", "SKILL.md")), "impeccable instalada")
  assert.ok(existsSync(join(skillsDir, "vercel-react-best-practices", "SKILL.md")), "vercel-react-best-practices instalada")

  // Idempotente: no reclona ni duplica en una segunda corrida
  const r2 = run("--install-skills", "--skills-dir", skillsDir, "--skills-src-dir", fakeRepo, ...isolated)
  assert.equal(r2.status, 0, r2.stderr)
  assert.equal(readdirSync(join(skillsDir, "ui-ux-pro-max")).filter((f) => f === "SKILL.md").length, 1)

  // --check ahora las detecta (status 0)
  const chk = run("--check", "--skills-dir", skillsDir, ...isolated)
  assert.equal(chk.status, 0, chk.stdout)
  assert.ok(chk.stdout.includes("Instalación completa"), chk.stdout)
})

test("--install-skills reporta error si el skillPath no existe en el repo fuente", () => {
  const fakeRepo = mkdtempSync(join(tmpdir(), "dh-fake-repo2-"))
  mkdirSync(join(fakeRepo, ".claude", "skills"), { recursive: true })
  // sin la skill dentro
  const skillsDir = mkdtempSync(join(tmpdir(), "dh-skills-dest2-"))
  const r = run("--install-skills", "--skills-dir", skillsDir, "--skills-src-dir", fakeRepo, "--skills-check-dirs", skillsDir)
  assert.equal(r.status, 0, "el instalador no falla; reporta warning")
  assert.ok(r.stdout.includes("NO instalada"), r.stdout)
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
  run()
  const cfg = readJson(join(project, "opencode.json"))
  const research = cfg.agent["expert-research"].prompt
  assert.ok(research.includes("write-md.mjs"), "expertos referencian write-md.mjs")
  assert.ok(research.includes("ESCRITURA ROBUSTA"), "regla de escritura robusta presente")
  const wireframe = cfg.agent["expert-wireframe"].prompt
  assert.ok(wireframe.includes("WIREFRAME CANÓNICO"), "regla wireframe canónico presente")
  assert.ok(wireframe.includes("TOKENS DEL PROYECTO"), "regla de tokens del proyecto presente")
  assert.ok(wireframe.includes("COBERTURA DE ESTADOS"), "regla de cobertura de estados presente")
  const orq = cfg.agent["design-orchestrator"].prompt
  assert.ok(orq.includes("ARTIFACT INTEGRITY"), "orquestador valida integridad de artefactos")
  assert.ok(orq.includes("PARITY GATE"), "orquestador incluye gate de paridad")
})

test("gate detect de impeccable en el executor cuando la skill existe", () => {
  const skillDir = join(project, ".opencode", "skills", "impeccable")
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: impeccable\ndescription: fake\n---\n")
  run()
  const cfg = readJson(join(project, "opencode.json"))
  assert.ok(cfg.agent.executor.prompt.includes("DETECT GATE"), "executor con DETECT GATE")
  assert.ok(cfg.agent.executor.prompt.includes("impeccable/scripts/detect.mjs"), "comando detect.mjs presente")
  assert.ok(cfg.agent["design-orchestrator"].prompt.includes("detect.mjs"), "orquestador audita wireframe con detect.mjs")
})