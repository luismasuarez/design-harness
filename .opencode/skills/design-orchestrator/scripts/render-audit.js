/**
 * render-audit.js — Auditoría medida del render (design-harness)
 *
 * Complemento numérico de la crítica de impeccable: donde las heurísticas
 * evalúan "a ojo", este script COMPUTA métricas reales del DOM renderizado.
 *
 * Uso (desde expert-critique):
 *   1. Abrir docs/design/<scope>/wireframe.html en chrome-devtools.
 *   2. evaluate(<contenido de este archivo> + "; window.renderAudit({ all: true })")
 *   3. Interpretar el JSON devuelto y citar los números reales en critique.md.
 *
 * Sin dependencias: JS puro, autocontenido, listo para inyectar en la página.
 * No modifica el DOM (excepto recorrer estados temporalmente y restaurarlos).
 */
(function () {
  "use strict"

  const WCAG = { normal: 4.5, large: 3.0, largeMinPx: 24, largeBoldPx: 18.66 }

  /* ---------- utilidades de color (WCAG 2.x) ---------- */

  function parseColor(cssColor) {
    const m = cssColor.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/)
    if (!m) return null
    return {
      r: Number(m[1]) / 255,
      g: Number(m[2]) / 255,
      b: Number(m[3]) / 255,
      a: m[4] === undefined ? 1 : Number(m[4]),
    }
  }

  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }

  function luminance(c) {
    return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b)
  }

  function blend(fg, bg) {
    return {
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    }
  }

  /** Fondo efectivo: sube ancestros blendando alfa hasta superficie sólida. */
  function effectiveBackground(el) {
    let node = el
    let acc = null
    while (node && node !== document.documentElement) {
      const bg = parseColor(getComputedStyle(node).backgroundColor)
      if (bg && bg.a > 0) {
        acc = acc ? blend(bg, acc) : bg
        if (acc.a >= 0.999) break
      }
      node = node.parentElement
    }
    if (!acc) acc = parseColor(getComputedStyle(document.body).backgroundColor) || { r: 1, g: 1, b: 1, a: 1 }
    return acc
  }

  function contrastRatio(fg, bg) {
    const L1 = luminance(fg)
    const L2 = luminance(bg)
    const [hi, lo] = L1 >= L2 ? [L1, L2] : [L2, L1]
    return (hi + 0.05) / (lo + 0.05)
  }

  /* ---------- utilidades de DOM ---------- */

  function isVisible(el) {
    const s = getComputedStyle(el)
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  function hasOwnText(el) {
    return Array.from(el.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
    )
  }

  function isLargeText(el) {
    const s = getComputedStyle(el)
    const px = parseFloat(s.fontSize)
    if (px >= WCAG.largeMinPx) return true
    return px >= WCAG.largeBoldPx && parseInt(s.fontWeight, 10) >= 700
  }

  const rounded = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d

  /* ---------- métricas ---------- */

  function auditContrast() {
    const results = []
    const textEls = Array.from(document.querySelectorAll("body *")).filter(
      (el) => isVisible(el) && hasOwnText(el)
    )
    for (const el of textEls) {
      const fg = parseColor(getComputedStyle(el).color)
      if (!fg) continue
      const bg = effectiveBackground(el)
      const ratio = contrastRatio(fg, bg)
      const large = isLargeText(el)
      const min = large ? WCAG.large : WCAG.normal
      const text = el.textContent.trim().replace(/\s+/g, " ").slice(0, 40)
      results.push({
        el: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""),
        text,
        fg: getComputedStyle(el).color,
        bg: `rgb(${Math.round(bg.r * 255)},${Math.round(bg.g * 255)},${Math.round(bg.b * 255)})`,
        ratio: rounded(ratio),
        large,
        pass: ratio >= min,
      })
    }
    const fails = results.filter((r) => !r.pass)
    return { total: results.length, fails, summary: { measured: results.length, fails: fails.length } }
  }

  function auditRhythm() {
    const results = { groups: [], misalignments: [], maxGapDeviationPx: 0 }
    // Grupos de hermanos visibles del mismo padre: gaps verticales reales
    for (const parent of document.querySelectorAll("body *")) {
      const kids = Array.from(parent.children).filter(isVisible)
      if (kids.length < 3) continue
      const tops = kids.map((k) => k.getBoundingClientRect().top)
      const gaps = tops.slice(1).map((t, i) => rounded(t - (tops[i] + kids[i].getBoundingClientRect().height), 0))
      if (gaps.length < 2) continue
      const uniq = new Set(gaps)
      if (uniq.size > 1) {
        const dev = Math.max(...gaps) - Math.min(...gaps)
        results.maxGapDeviationPx = Math.max(results.maxGapDeviationPx, dev)
        results.groups.push({
          parent: parent.tagName.toLowerCase() + (parent.className && typeof parent.className === "string" ? "." + parent.className.split(" ")[0] : ""),
          gaps,
          deviationPx: dev,
          regular: dev <= 2,
        })
      }
    }
    // Alineación X: inputs vs labels del mismo field
    for (const field of document.querySelectorAll(".form-field, [class*='field'], form > div")) {
      const label = field.querySelector("label")
      const input = field.querySelector("input, select, textarea")
      if (!label || !input) continue
      const dx = rounded(input.getBoundingClientRect().left - label.getBoundingClientRect().left, 0)
      results.misalignments.push({ field: field.className || field.tagName, labelLeft: rounded(label.getBoundingClientRect().left, 0), inputLeft: rounded(input.getBoundingClientRect().left, 0), dx })
    }
    return results
  }

  function auditTypeScale() {
    const selectors = ["h1", "h2", ".card-title", ".section-title", "label", "input", "p", "small", ".hint"]
    const out = {}
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (!el) continue
      const s = getComputedStyle(el)
      out[sel] = {
        fontSize: s.fontSize,
        lineHeight: s.lineHeight,
        fontWeight: s.fontWeight,
        letterSpacing: s.letterSpacing,
      }
    }
    return out
  }

  function auditTargets() {
    const els = Array.from(document.querySelectorAll("button, a[href], input, select, textarea, [role='button']")).filter(isVisible)
    const small = els
      .map((el) => {
        const r = el.getBoundingClientRect()
        return { el: el.tagName.toLowerCase(), w: rounded(r.width, 0), h: rounded(r.height, 0), pass: r.width >= 24 && r.height >= 24 }
      })
      .filter((t) => !t.pass)
    return { measured: els.length, fails: small.length, small }
  }

  function auditOverflow() {
    const doc = document.documentElement
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      viewport: window.innerWidth,
      overflowX: doc.scrollWidth > doc.clientWidth,
    }
  }

  function auditFocus() {
    const tabbables = Array.from(
      document.querySelectorAll("a[href], button, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")
    ).filter(isVisible)
    // ¿Existen reglas :focus-visible / outline en el CSS del documento?
    let focusVisibleRules = 0
    let outlineRules = 0
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of rules) {
        if (!rule.selectorText) continue
        if (rule.selectorText.includes(":focus-visible")) focusVisibleRules++
        if (rule.selectorText.includes(":focus") && rule.style && rule.style.outline && rule.style.outline !== "none") outlineRules++
      }
    }
    return { tabbableCount: tabbables.length, hasFocusVisibleStyles: focusVisibleRules > 0 || outlineRules > 0 }
  }

  /* ---------- orquestador ---------- */

  function measure() {
    return {
      contrast: auditContrast(),
      rhythm: auditRhythm(),
      typeScale: auditTypeScale(),
      targets: auditTargets(),
      overflow: auditOverflow(),
      focus: auditFocus(),
    }
  }

  /**
   * renderAudit({ all }) — audita el estado actual, o todos los estados
   * conocidos del wireframe (botones de demo con data-state) si all=true.
   */
  function renderAudit(opts) {
    opts = opts || {}
    if (!opts.all) {
      const m = measure()
      return { state: document.body.dataset.state || "actual", ...m }
    }
    const states = Array.from(document.querySelectorAll("[data-state]"))
      .map((b) => b.dataset.state)
      .filter(Boolean)
    const unique = states.length ? Array.from(new Set(states)) : ["lectura", "edicion", "guardando", "loading", "error", "empty"]
    const out = { states: {} }
    for (const st of unique) {
      document.body.setAttribute("data-state", st)
      // dejar que el CSS aplique antes de medir
      const m = measure()
      out.states[st] = m
      // resumen por estado
      out.states[st].summary = {
        contrastFails: m.contrast.summary.fails,
        contrastMeasured: m.contrast.summary.measured,
        rhythmMaxDeviationPx: m.rhythm.maxGapDeviationPx,
        targetFails: m.targets.fails,
        overflowX: m.overflow.overflowX,
      }
    }
    // restaurar estado
    const demo = document.querySelector(".demo-bar button.active")
    document.body.setAttribute("data-state", demo ? demo.dataset.state : "lectura")
    return out
  }

  window.renderAudit = renderAudit
  return renderAudit
})()