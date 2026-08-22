#!/usr/bin/env node
/**
 * run-metrics.mjs — Reporte de métricas post-run del design-harness
 *
 * Lee la base de datos de sesiones de opencode y genera el reporte de una
 * corrida del harness: tokens por agente, costo, duración, delegaciones,
 * rondas de crítica y (estimada) ventana de contexto del orquestador.
 *
 * El reporte NO juzga: registra los números tal cual. Los umbrales de alerta
 * son del CASO DE REFERENCIA del autor (deepseek-v4-flash, ventana ~128K,
 * umbral de rendimiento rápido ~20%); otro modelo/sistema tendrá otros.
 *
 * Uso:
 *   node run-metrics.mjs --scope settings-page
 *   node run-metrics.mjs --session ses_fd5921916ffe1xEaaln59rLr4u
 *   node run-metrics.mjs --scope settings-page --window-tokens 128000 --observed-context-pct 12
 *
 * Flags:
 *   --scope <s>              Patrón del scope en títulos de subsesiones (ej: settings-page)
 *   --session <id>           Sesión del orquestador (alternativa a --scope)
 *   --db <path>              Ruta a opencode.db (default: ~/.local/share/opencode/opencode.db)
 *   --window-tokens <n>      Tamaño de ventana del modelo (default: 128000)
 *   --observed-context-pct <n>  % de ventana observado en la UI (autorreporte)
 *   --approval-rounds <n>    Vueltas de aprobación de la síntesis (default: 1)
 *   --tripwires <n>          Gates bloqueantes disparadas (default: 0)
 *   --out <dir>              Directorio de salida (default: docs/design/shared)
 */
import { DatabaseSync } from "node:sqlite"
import { homedir } from "node:os"
import { join, dirname } from "node:path"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const HARNESS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..")

function parseArgs(argv) {
  const args = { windowTokens: 128000, approvalRounds: 1, tripwires: 0, out: "docs/design/shared" }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => argv[++i]
    switch (flag) {
      case "--scope": args.scope = next(); break
      case "--session": args.session = next(); break
      case "--db": args.db = next(); break
      case "--window-tokens": args.windowTokens = parseInt(next(), 10); break
      case "--observed-context-pct": args.observedContextPct = parseFloat(next()); break
      case "--approval-rounds": args.approvalRounds = parseInt(next(), 10); break
      case "--tripwires": args.tripwires = parseInt(next(), 10); break
      case "--out": args.out = next(); break
    }
  }
  return args
}

function findRun(db, args) {
  // Por sesión explícita
  if (args.session) {
    const row = db.prepare("SELECT * FROM session WHERE id = ?").get(args.session)
    if (!row) throw new Error(`Sesión no encontrada: ${args.session}`)
    return row
  }
  if (!args.scope) throw new Error("Se requiere --scope o --session")
  // Subsesiones del scope → sus parent_id → la corrida del orquestador
  const subs = db
    .prepare("SELECT DISTINCT parent_id FROM session WHERE title LIKE ? AND title LIKE '%subagent%'")
    .all(`%${args.scope}%`)
  const parentIds = subs.map((s) => s.parent_id).filter(Boolean)
  if (!parentIds.length) throw new Error(`Sin subsesiones para el scope "${args.scope}"`)
  const placeholders = parentIds.map(() => "?").join(",")
  const runs = db
    .prepare(`SELECT * FROM session WHERE id IN (${placeholders}) ORDER BY time_updated DESC`)
    .all(...parentIds)
  if (!runs.length) throw new Error("Corrida del orquestador no encontrada")
  return runs[0]
}

function sumTokens(db, sessionId) {
  const r = db
    .prepare(
      `SELECT COALESCE(SUM(tokens_input),0) AS ti, COALESCE(SUM(tokens_output),0) AS to_,
              COALESCE(SUM(tokens_reasoning),0) AS tr, COALESCE(SUM(tokens_cache_read),0) AS tcr,
              COALESCE(SUM(tokens_cache_write),0) AS tcw, COALESCE(SUM(cost),0) AS cost
       FROM session WHERE parent_id = ?`
    )
    .get(sessionId)
  return r
}

function listDelegations(db, sessionId) {
  const msgs = db.prepare("SELECT id FROM message WHERE session_id = ?").all(sessionId)
  const delegations = []
  for (const m of msgs) {
    const parts = db.prepare("SELECT data FROM part WHERE message_id = ?").all(m.id)
    for (const p of parts) {
      let d
      try { d = JSON.parse(p.data) } catch { continue }
      if (d?.type !== "tool" || d?.tool !== "task") continue
      const input = d?.state?.input ?? {}
      delegations.push({
        subagent: input.subagent_type ?? "?",
        description: (input.description ?? "").slice(0, 80),
      })
    }
  }
  return delegations
}

function messagesCount(db, sessionId) {
  return db.prepare("SELECT COUNT(*) AS n FROM message WHERE session_id = ?").get(sessionId).n
}

function findScore(scope) {
  const file = join(process.cwd(), "docs", "design", scope, "critique.md")
  if (!existsSync(file)) return null
  const text = readFileSync(file, "utf8")
  const lines = text.split("\n")
  let score = null
  for (const line of lines) {
    // última mención del veredicto: "4.38 / 5" o "APROBADO"
    const m = line.match(/(\d+\.\d+)\s*\/\s*5/)
    if (m) score = parseFloat(m[1])
  }
  return score
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const dbPath = args.db ?? join(homedir(), ".local", "share", "opencode", "opencode.db")
  if (!existsSync(dbPath)) throw new Error(`Base de datos no encontrada: ${dbPath}`)

  const db = new DatabaseSync(dbPath, { readOnly: true })
  const run = findRun(db, args)
  const runId = run.id

  const subs = db
    .prepare("SELECT * FROM session WHERE parent_id = ? ORDER BY time_created")
    .all(runId)

  const byAgent = subs.map((s) => ({
    agent: s.agent,
    title: s.title,
    tokensInput: s.tokens_input ?? 0,
    tokensOutput: s.tokens_output ?? 0,
    tokensReasoning: s.tokens_reasoning ?? 0,
    cost: s.cost ?? 0,
    durationMs: (s.time_updated ?? s.time_created) - s.time_created,
  }))

  const totals = sumTokens(db, runId)
  const delegations = listDelegations(db, runId)
  const roundsCritique = byAgent.filter((s) => s.agent === "expert-critique").length
  const executorDelegated = delegations.some((d) => d.subagent === "executor")

  // Ventana del orquestador: estimación desde cache + autorreporte opcional
  const contextTokens = Math.max(0, (run.tokens_input ?? 0) - (run.tokens_cache_read ?? 0))
  const contextPctEstimated = Math.round((contextTokens / args.windowTokens) * 1000) / 10
  const contextPct = args.observedContextPct ?? contextPctEstimated

  const score = findScore(args.scope)

  const metrics = {
    scope: args.scope ?? run.title,
    run: { id: runId, title: run.title, agent: run.agent, model: run.model },
    referenceCase: {
      author: "luisma",
      model: "deepseek-v4-flash (opencode-go)",
      windowTokens: args.windowTokens,
      fastReasoningThresholdPct: 20,
      note: "Umbrales de ALERTA del caso de referencia, no reglas universales. Para comparar con otros modelos/sistemas usa los números crudos.",
    },
    orchestrator: {
      tokensInput: run.tokens_input ?? 0,
      tokensOutput: run.tokens_output ?? 0,
      tokensReasoning: run.tokens_reasoning ?? 0,
      tokensCacheRead: run.tokens_cache_read ?? 0,
      tokensCacheWrite: run.tokens_cache_write ?? 0,
      cost: run.cost ?? 0,
      durationMs: (run.time_updated ?? run.time_created) - run.time_created,
      messages: messagesCount(db, runId),
      contextPct: contextPct,
      contextPctSource: args.observedContextPct != null ? "observado (UI)" : "estimado (input-cache)",
      contextPctEstimated: contextPctEstimated,
      contextTokens: contextTokens,
      contextPctAlert: contextPct > 15 ? true : false,
      contextPctAlertThreshold: 15,
    },
    delegation: {
      totalCalls: delegations.length,
      bySubagent: Object.fromEntries(
        delegations.reduce((acc, d) => acc.set(d.subagent, (acc.get(d.subagent) ?? 0) + 1), new Map())
      ),
      executorDelegated: executorDelegated,
      details: delegations,
    },
    subagents: byAgent,
    totals: {
      tokensInput: totals.ti,
      tokensOutput: totals.to_,
      tokensReasoning: totals.tr,
      tokensCacheRead: totals.tcr,
      tokensCacheWrite: totals.tcw,
      cost: totals.cost,
      tokensGrandTotal: totals.ti + totals.to_ + totals.tr,
    },
    quality: {
      critiqueRounds: roundsCritique,
      finalScore: score,
      threshold: 4.0,
      approved: score != null ? score >= 4.0 : null,
      approvalRounds: args.approvalRounds,
      tripwires: args.tripwires,
    },
    generatedAt: new Date().toISOString(),
  }

  // Salida
  const outDir = join(process.cwd(), args.out)
  mkdirSync(outDir, { recursive: true })
  const base = args.scope ? `run-metrics-${args.scope}` : `run-metrics-${runId.slice(0, 8)}`
  writeFileSync(join(outDir, `${base}.json`), JSON.stringify(metrics, null, 2) + "\n")

  const pct = metrics.orchestrator.contextPct
  const flag = metrics.orchestrator.contextPctAlert ? "⚠️  > 15% (umbral del caso de referencia)" : "ok"
  const md = `# Métricas de corrida — ${metrics.scope}

Corrida del harness design-harness. Números crudos para comparativa entre
modelos/sistemas. Los umbrales marcados son del **caso de referencia**
(${metrics.referenceCase.model}, ventana ${metrics.referenceCase.windowTokens} tokens,
rendimiento rápido ≈ ${metrics.referenceCase.fastReasoningThresholdPct}%).

| Sesión | ${run.title} (${runId}) |
|---|---|
| Orquestador | ${run.agent} |
| Fecha | ${new Date(run.time_created).toLocaleString()} |
| Duración | ${Math.round(metrics.orchestrator.durationMs / 60000)} min |

## Orquestador

| Métrica | Valor |
|---|---|
| Contexto hasta la síntesis | **${pct}%** de la ventana (${metrics.orchestrator.contextPctSource}) ${flag} |
| Tokens input / output / reasoning | ${metrics.orchestrator.tokensInput.toLocaleString()} / ${metrics.orchestrator.tokensOutput.toLocaleString()} / ${metrics.orchestrator.tokensReasoning.toLocaleString()} |
| Costo | \$${metrics.orchestrator.cost.toFixed(4)} |
| Mensajes | ${metrics.orchestrator.messages} |

## Delegación

| Métrica | Valor |
|---|---|
| Llamadas Task | ${metrics.delegation.totalCalls} |
| Por subagente | ${Object.entries(metrics.delegation.bySubagent).map(([k, v]) => `${k}×${v}`).join(", ") || "—"} |
| Executor delegado | ${metrics.delegation.executorDelegated ? "sí" : "**NO** (ejecución inline del orquestador)"} |

## Subagentes

| Agente | Input | Output | Costo |
|---|---|---|---|
${metrics.subagents.map((s) => `| ${s.agent} | ${s.tokensInput.toLocaleString()} | ${s.tokensOutput.toLocaleString()} | \$${s.cost.toFixed(4)} |`).join("\n")}

## Totales del sistema

| Métrica | Valor |
|---|---|
| Tokens input / output / reasoning | ${metrics.totals.tokensInput.toLocaleString()} / ${metrics.totals.tokensOutput.toLocaleString()} / ${metrics.totals.tokensReasoning.toLocaleString()} |
| Gran total | ${metrics.totals.tokensGrandTotal.toLocaleString()} |
| Costo total | \$${metrics.totals.cost.toFixed(4)} |

## Calidad

| Métrica | Valor |
|---|---|
| Rondas de crítica | ${metrics.quality.critiqueRounds} |
| Score final | ${metrics.quality.finalScore ?? "—"} / 5 (umbral ${metrics.quality.threshold}) |
| Aprobado | ${metrics.quality.approved === null ? "—" : metrics.quality.approved ? "sí" : "no"} |
| Vueltas de aprobación | ${metrics.quality.approvalRounds} |
| Tripwires disparadas | ${metrics.quality.tripwires} |

*Generado por \`scripts/run-metrics.mjs\`.*
`
  writeFileSync(join(outDir, `${base}.md`), md)

  console.log(`Reporte escrito en ${outDir}/${base}.json y .md`)
  console.log(`Contexto del orquestador: ${pct}% de la ventana (${metrics.orchestrator.contextPctSource})`)
  db.close()
}

try {
  main()
} catch (err) {
  console.error(`run-metrics: ${err.message}`)
  process.exit(1)
}