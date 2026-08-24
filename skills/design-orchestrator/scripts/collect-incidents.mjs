#!/usr/bin/env node
/**
 * collect-incidents.mjs — Evidencia de incidentes del design-harness (read-only)
 *
 * Helper de la Fase 1 del prompt maestro /harness-audit. Extrae de la base de
 * sesiones de opencode los tool calls con error y los workarounds de escritura,
 * clasificados por categoría operativa y por agente, para detectar patrones de
 * fricción del harness sin abrir la DB a mano.
 *
 * Uso:
 *   node collect-incidents.mjs --db ~/.local/share/opencode/opencode.db \
 *     --project portal_cloud --since 2026-08-20
 *   node collect-incidents.mjs --project portal_cloud --scope ota --json
 *
 * Flags:
 *   --db <path>         Ruta a opencode.db (default: ~/.local/share/opencode/opencode.db)
 *   --project <dir>     Filtra sesiones cuyo directorio contiene este texto
 *   --scope <patrón>    Filtra sesiones cuyo título/scope contiene este texto
 *   --since <YYYY-MM-DD> Solo sesiones creadas en o después de esa fecha
 *   --json              Salida JSON completa (incidentes + resumen)
 *   --md                Salida markdown (reporte legible)
 *   --limit <n>         Tope de evidencias por categoría (default: 20)
 *
 * Categorías:
 *   provider_transient   Fallos de red/proveedor (reintentable)
 *   permission_denial    Tool bash bloqueada por el perfil de permisos
 *   task_cancelled       Delegación cancelada
 *   task_error           Error de subagente no clasificado
 *   tool_error           Error de tool (read/edit/write/etc.)
 *   write_truncation     Workaround de escritura (contenido partido a mano)
 */
import { DatabaseSync } from "node:sqlite"
import { homedir } from "node:os"
import { join } from "node:path"
import { existsSync } from "node:fs"

const DEFAULT_DB = join(homedir(), ".local", "share", "opencode", "opencode.db")
const TRUNCATION_HINTS = [
  "lo escribo en dos partes",
  "lo escribo en 2 partes",
  "en dos partes",
  "en 4 partes",
  "se truncó",
  "se trunco",
  "payload es muy largo",
  "contenido es muy largo",
  "muy largo para una sola",
  "el json se truncó",
  "divido en",
  "marcador de continuación",
  "continuar]",
  "<!-- more -->",
]

function parseArgs(argv) {
  const a = { db: DEFAULT_DB, since: null, project: null, scope: null, json: false, md: false, limit: 20 }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case "--db": a.db = next(); break
      case "--project": a.project = next(); break
      case "--scope": a.scope = next(); break
      case "--since": a.since = next(); break
      case "--json": a.json = true; break
      case "--md": a.md = true; break
      case "--limit": a.limit = parseInt(next(), 10); break
    }
  }
  return a
}

function classifyError(tool, err) {
  const e = (err ?? "").toLowerCase()
  if (tool === "task" && e.includes("cancelled")) return "task_cancelled"
  if (e.includes("rule which prevents")) return "permission_denial"
  if (/upstream request failed|endpoint is unavailable|network_error|invalid_request|not valid json|finish_reason/.test(e)) return "provider_transient"
  if (tool === "task") return "task_error"
  return "tool_error"
}

function isTruncationHint(text) {
  const t = (text ?? "").toLowerCase()
  return TRUNCATION_HINTS.some((h) => t.includes(h.toLowerCase()))
}

function collect(db, args) {
  const where = []
  const params = []
  if (args.project) { where.push("directory LIKE ?"); params.push(`%${args.project}%`) }
  if (args.since) { where.push("time_created >= ?"); params.push(Math.floor(new Date(args.since + "T00:00:00Z").getTime())) }
  const wh = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const sessions = db.prepare(`SELECT id, agent, title, directory, time_created FROM session ${wh} ORDER BY time_created`).all(...params)

  // Filtrar por scope en título si se pidió
  const selected = args.scope ? sessions.filter((s) => (s.title ?? "").toLowerCase().includes(args.scope.toLowerCase()) || (s.directory ?? "").toLowerCase().includes(args.scope.toLowerCase())) : sessions
  const ids = selected.map((s) => s.id)
  if (!ids.length) return { sessions: 0, incidentes: {}, evidencias: [] }

  const counts = {}
  const evidencias = []
  for (const s of selected) {
    const key = s.agent || (s.title ?? "").slice(0, 40)
    const parts = db.prepare("SELECT data, time_created FROM part WHERE session_id = ?").all(s.id)
    for (const p of parts) {
      let d
      try { d = JSON.parse(p.data) } catch { continue }
      if (!d) continue
      if (d.type === "tool" && d.state?.status === "error") {
        const cat = classifyError(d.tool ?? "?", d.state?.error ?? "")
        counts[key] = counts[key] ?? {}
        counts[key][cat] = (counts[key][cat] ?? 0) + 1
        if (cat === "provider_transient" && evidencias.filter((e) => e.categoria === cat).length < args.limit) {
          evidencias.push({ categoria: cat, sesion: s.id.slice(0, 14), agente: key, tool: d.tool, error: String(d.state.error ?? "").slice(0, 160), fecha: new Date(p.time_created).toISOString().slice(0, 16) })
        }
      }
      if (d.type === "text" && typeof d.text === "string" && isTruncationHint(d.text)) {
        counts[key] = counts[key] ?? {}
        counts[key].write_truncation = (counts[key].write_truncation ?? 0) + 1
        if (evidencias.filter((e) => e.categoria === "write_truncation").length < args.limit) {
          evidencias.push({ categoria: "write_truncation", sesion: s.id.slice(0, 14), agente: key, error: d.text.slice(0, 160), fecha: new Date(p.time_created).toISOString().slice(0, 16) })
        }
      }
    }
  }

  const total = {}
  for (const byAgent of Object.values(counts)) {
    for (const [cat, n] of Object.entries(byAgent)) total[cat] = (total[cat] ?? 0) + n
  }
  return { sessions: selected.length, incidentes: counts, resumen: total, evidencias }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.db)) throw new Error(`Base de datos no encontrada: ${args.db}`)
  const db = new DatabaseSync(args.db, { readOnly: true })
  const data = collect(db, args)
  db.close()

  if (args.json) { console.log(JSON.stringify(data, null, 2)); return }
  if (args.md) {
    console.log(`# Incidentes design-harness\n\nSesiones analizadas: ${data.sessions}\n`)
    console.log("## Resumen por categoría\n")
    for (const [c, n] of Object.entries(data.resumen).sort((a, b) => b[1] - a[1])) console.log(`- ${c}: ${n}`)
    console.log("\n## Por agente\n")
    for (const [a, cats] of Object.entries(data.incidentes)) console.log(`- ${a}: ${Object.entries(cats).map(([c, n]) => `${c}=${n}`).join(", ")}`)
    if (data.evidencias.length) {
      console.log("\n## Evidencias\n")
      for (const e of data.evidencias.slice(0, args.limit)) console.log(`- [${e.categoria}] ${e.agente} (${e.sesion} ${e.fecha}): ${e.error}`)
    }
    return
  }
  // Modo texto
  for (const [c, n] of Object.entries(data.resumen).sort((a, b) => b[1] - a[1])) console.log(`${c}: ${n}`)
  console.log(`sesiones: ${data.sessions}`)
}

try {
  main()
} catch (err) {
  console.error(`collect-incidents: ${err.message}`)
  process.exit(1)
}