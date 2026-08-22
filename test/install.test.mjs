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