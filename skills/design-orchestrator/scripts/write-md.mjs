#!/usr/bin/env node
/**
 * write-md.mjs — Escritura robusta de artefactos markdown del design-harness
 *
 * Resuelve el gap G1: la tool Write trunca payloads grandes y los agentes
 * partían los artefactos a mano ("el contenido se truncó en la serialización",
 * "lo escribo en dos partes"). Este script ensambla un artefacto a partir de
 * secciones escritas por separado (cada una dentro del límite de la tool) y
 * valida la integridad final (sin marcadores de continuación, termina completo,
 * dentro del budget del artefacto).
 *
 * Uso (agentes del harness):
 *   # Escribir cada sección con la tool Write a .tmp/<artifact>.<n>.md
 *   node write-md.mjs --file docs/design/<scope>/research.md \
 *     --sources docs/design/<scope>/.tmp/research.1.md \
 *             docs/design/<scope>/.tmp/research.2.md \
 *     --budget 32768
 *   # Validar un artefacto ya escrito (sin tocar):
 *   node write-md.mjs --file docs/design/<scope>/research.md --check
 *   # Reportar el tamaño de cada sección fuente (guía el recorte dirigido,
 *   # sin escribir nada; exit 0):
 *   node write-md.mjs --report --file docs/design/<scope>/research.md \
 *     --sources docs/design/<scope>/.tmp/research.1.md \
 *             docs/design/<scope>/.tmp/research.2.md \
 *     --budget 32768
 *
 * Exit 0 = ok; 1 = error; 2 = advertencia (excede budget / sección vacía).
 *
 * Marcadores de continuación que invalidan un artefacto (el agente los usaba
 * como workaround): `[CONTINUAR]`, `<!-- CONTINUAR -->`, `<!-- more -->`,
 * `<!-- TO BE CONTINUED -->` al final del archivo.
 */
import { readFileSync, writeFileSync, existsSync, statSync, rmSync } from "node:fs"
import { join, resolve, dirname } from "node:path"

const CONTINUATION = /\[(?:CONTINUAR|CONTINUE)\][\s\S]*$|<!--\s*(?:CONTINUAR|more|TO BE CONTINUED)[\s\S]*$/i
// Encabezados de sección (## o ###) cuyo título repetido indica una sección
// duplicada — síntoma de edits incrementales que reinsertan contenido viejo.
const HEADING = /^#{2,3}\s+.*$/gm

function findDuplicateHeadings(raw) {
  const seen = new Map()
  for (const m of raw.matchAll(HEADING)) {
    const key = m[0].trim().toLowerCase()
    if (seen.has(key)) return { heading: seen.get(key), dup: key }
    seen.set(key, m[0].trim())
  }
  return null
}

function parseArgs(argv) {
  const a = { sources: [], budget: null, check: false, report: false, cleanup: null }
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case "--file": a.file = resolve(next()); break
      case "--sources": while (argv[i + 1] && !argv[i + 1].startsWith("--")) a.sources.push(resolve(argv[++i])); break
      case "--source": a.sources.push(resolve(next())); break
      case "--budget": a.budget = parseInt(next(), 10); break
      case "--check": a.check = true; break
      case "--report": a.report = true; break
      case "--cleanup": a.cleanup = resolve(next()); break
    }
  }
  return a
}

function warn(...m) { console.error("warn:", ...m) }

function assemble(a) {
  if (!a.file) throw new Error("--file es obligatorio")
  if (!a.sources.length) throw new Error("--sources vacío (pasa una o más secciones .md)")
  const parts = []
  for (const src of a.sources) {
    if (!existsSync(src)) throw new Error(`sección no encontrada: ${src}`)
    const body = readFileSync(src, "utf8").trimEnd()
    if (!body.trim()) warn(`sección vacía, se omite: ${src}`)
    else parts.push(body)
  }
  const content = parts.join("\n\n") + "\n"
  writeFileSync(a.file, content)
  console.log(`ok: ${a.file} (${Buffer.byteLength(content)} bytes, ${parts.length} secciones)`)
  return content
}

function validate(file, budget) {
  if (!existsSync(file)) throw new Error(`artefacto no encontrado: ${file}`)
  const raw = readFileSync(file, "utf8")
  const size = Buffer.byteLength(raw)
  const errors = []
  const m = raw.match(CONTINUATION)
  if (m) errors.push(`marcador de continuación sin resolver: "${m[0].slice(0, 60).trim()}"`)
  if (!raw.endsWith("\n")) errors.push("el archivo no termina en salto de línea")
  if (!raw.trim()) errors.push("el archivo está vacío")
  if (budget != null && size > budget) errors.push(`excede el budget (${size} > ${budget} bytes)`)
  const dup = findDuplicateHeadings(raw)
  if (dup) errors.push(`sección duplicada: "${dup.heading}" aparece más de una vez (edits que reinsertan contenido viejo)`)
  for (const e of errors) warn(`- ${e}`)
  if (errors.length) {
    console.error(`fail: ${file} (${size} bytes)`)
    return false
  }
  console.log(`ok: ${file} (${size} bytes${budget ? `, budget ${budget}` : ""})`)
  return true
}

function report(a) {
  if (!a.file) throw new Error("--file es obligatorio")
  if (!a.sources.length) throw new Error("--sources vacío (pasa una o más secciones .md)")
  let total = 0
  console.log(`report: ${a.file}`)
  for (const src of a.sources) {
    if (!existsSync(src)) throw new Error(`sección no encontrada: ${src}`)
    const body = readFileSync(src, "utf8")
    const size = Buffer.byteLength(body)
    total += size
    const label = src.split("/").pop()
    const pct = a.budget ? ` (${Math.round((size / a.budget) * 100)}% del budget)` : ""
    console.log(`  ${size.toString().padStart(7)} bytes  ${label}${pct}`)
  }
  console.log(`  ${total.toString().padStart(7)} bytes  TOTAL${a.budget ? ` — budget ${a.budget}` : ""}`)
  if (a.budget) {
    const delta = total - a.budget
    if (delta > 0) {
      console.log(`  recorte necesario: ${delta} bytes (compacta primero las secciones más pesadas, nunca borres citas clave)`)
      process.exit(2)
    }
    console.log(`  margen disponible: ${-delta} bytes`)
  }
  process.exit(0)
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (a.report) return report(a)
  if (a.check) {
    const ok = validate(a.file, a.budget)
    process.exit(ok ? 0 : 1)
  }
  assemble(a)
  if (a.cleanup && existsSync(a.cleanup)) rmSync(a.cleanup, { recursive: true, force: true })
}

try {
  main()
} catch (err) {
  console.error(`write-md: ${err.message}`)
  process.exit(1)
}