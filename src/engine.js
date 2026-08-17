'use strict'

/**
 * cn-linebreak engine
 *
 * Implements the rules from《中文网页文案断行修复指南》:
 *   - default guard: line-break: strict + word-break: keep-all + overflow-wrap: normal
 *   - <wbr> marks "may break here" at semantic boundaries (after ，。；：、)
 *   - <br> marks "must break here"
 *   - .no-break protects phrases that must never split
 *
 * Pure functions, zero dependencies. Works in Node and in the DSH plugin sandbox.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Punctuation after which a break opportunity is welcome
const BREAK_AFTER_RE = /[，。；：、]/

// Punctuation that must never sit alone at the start of a line
const LINE_START_BAD_RE = /^[，。；：、！？]/

// An orphan line: exactly one CJK char + sentence-final punctuation
const ORPHAN_LINE_RE = /^[\u4e00-\u9fff]{1}[。！？]$/
const ORPHAN_LINE_SHORT_RE = /^[\u4e00-\u9fff]{2}[。！？]$/

// Tags whose inner content must never be touched
const SKIP_TAGS = new Set([
  'script', 'style', 'pre', 'code', 'textarea', 'title',
  'template', 'svg', 'math', 'noscript',
])

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function cjkCount(text) {
  let n = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if ((code >= 0x3400 && code <= 0x4dbf) || (code >= 0x4e00 && code <= 0x9fff)) n += 1
  }
  return n
}

function stripTags(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// HTML tokenizer (tag / text / comment), used by both audit and fix
// ---------------------------------------------------------------------------

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
const COMMENT_RE = /<!--[\s\S]*?-->/g

/**
 * Walk an HTML string and callbacks on tags and text runs.
 * Tag callbacks receive { name, raw, closing, selfClosing, attrs, index }.
 * Text callbacks receive (text, startIndex).
 * Robust to leading junk (e.g. UTF-8 BOM) before the first tag.
 */
function scanHtml(html, onTag, onText) {
  let pos = 0
  const total = html.length

  while (pos < total) {
    // Find the next comment and the next tag from the current position.
    COMMENT_RE.lastIndex = pos
    const comment = COMMENT_RE.exec(html)
    TAG_RE.lastIndex = pos
    const tag = TAG_RE.exec(html)

    let nextPos = total
    let kind = null
    if (comment && comment.index < nextPos) {
      nextPos = comment.index
      kind = 'comment'
    }
    if (tag && tag.index < nextPos) {
      nextPos = tag.index
      kind = 'tag'
    }

    if (kind === null) {
      if (pos < total) onText(html.slice(pos, total), pos)
      break
    }

    if (nextPos > pos) {
      onText(html.slice(pos, nextPos), pos)
      pos = nextPos
      continue
    }

    // Markup starts exactly here.
    if (kind === 'comment') {
      pos = comment.index + comment[0].length
      continue
    }
    const raw = tag[0]
    const name = tag[1].toLowerCase()
    const closing = raw[1] === '/'
    const selfClosing = /\/\s*>$/.test(raw) || name === 'br' || name === 'wbr'
    const attrs = tag[2] || ''
    pos = tag.index + raw.length
    onTag({ name, raw, closing, selfClosing, attrs, index: tag.index })
  }
}

// ---------------------------------------------------------------------------
// Element collection for the audit
// ---------------------------------------------------------------------------

/**
 * Collect every auditable text-bearing element with its raw inner HTML
 * and its lines split at explicit <br> boundaries (for orphan/line checks).
 */
function collectElements(html) {
  const elements = []
  const openStack = []
  const skipStack = []

  scanHtml(html, (tagInfo) => {
    const { name, closing, selfClosing, attrs, index } = tagInfo

    if (skipStack.length > 0) {
      if (closing) {
        if (skipStack[skipStack.length - 1] === name) skipStack.pop()
      } else if (!selfClosing && !SKIP_TAGS.has(name)) {
        skipStack.push(name)
      }
      return
    }

    if (!closing && !selfClosing && SKIP_TAGS.has(name)) {
      skipStack.push(name)
      return
    }

    if (closing) {
      const top = openStack[openStack.length - 1]
      if (top && top.tag === name) {
        const element = openStack.pop()
        element.inner = html.slice(element.start, index)
        element.html = element.inner
        element.text = stripTags(element.inner)
        element.lines = element.inner.split(/<br\b[^>]*>/i).map(stripTags)
        element.wbrCount = (element.inner.match(/<wbr\b/gi) || []).length
        elements.push(element)
      }
      return
    }

    if (selfClosing) return

    // opening non-void element
    openStack.push({
      tag: name,
      start: index + tagInfo.raw.length,
      inner: '',
      html: '',
      text: '',
      lines: [],
      wbrCount: 0,
      hasNoBreak: /(^|["'\s])no-break(["'\s]|$)/.test(attrs),
    })
  }, () => {})

  // Anything still open at the end (unclosed tags) still counts
  for (const open of openStack) {
    open.inner = html.slice(open.start)
    open.html = open.inner
    open.text = stripTags(open.inner)
    open.lines = open.inner.split(/<br\b[^>]*>/i).map(stripTags)
    open.wbrCount = (open.inner.match(/<wbr\b/gi) || []).length
    elements.push(open)
  }

  return elements
}

// ---------------------------------------------------------------------------
// CSS audit
// ---------------------------------------------------------------------------

function auditCss(html) {
  const styleBlocks = []
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let m
  while ((m = styleRe.exec(html)) !== null) styleBlocks.push(m[1])

  const css = styleBlocks.join('\n')
  const hasStyle = styleBlocks.length > 0
  const keepAll = /\bword-break\s*:\s*keep-all\b/i.test(css)
  const lineBreakStrict = /\bline-break\s*:\s*strict\b/i.test(css)
  const overflowWrapNormal = /\boverflow-wrap\s*:\s*normal\b/i.test(css)
  const textWrapPretty = /\btext-wrap\s*:\s*(pretty|balance)\b/i.test(css)

  // broad nowrap: nowrap on a global-ish selector
  let nowrapBroad = false
  const nowrapRe = /([^{}]+)\{([^}]*white-space\s*:\s*nowrap[^}]*)\}/gi
  while ((m = nowrapRe.exec(css)) !== null) {
    const selector = m[1].trim()
    if (
      /(^|,|\s)\*(?:\s|$|,)/.test(selector) ||
      /\b(?:html|body|:root)\b/.test(selector) ||
      /:where\(/.test(selector)
    ) nowrapBroad = true
  }

  return { hasStyle, keepAll, lineBreakStrict, overflowWrapNormal, textWrapPretty, nowrapBroad, cssLength: css.length }
}

// ---------------------------------------------------------------------------
// Fix: insert <wbr> after ，。；：、 at semantic boundaries
// ---------------------------------------------------------------------------

function topTagClass(raw) {
  const m = /class\s*=\s*["']([^"']*)["']/.exec(raw)
  return m ? m[1] : ''
}

/**
 * Insert <wbr> after CJK punctuation (，。；：、) inside text content,
 * skipping script/style/pre/code/textarea/title and .no-break spans,
 * and skipping positions that already have a <wbr>/<br> or sit before a closing tag.
 */
function insertWbr(html) {
  let out = ''
  let inTag = false
  let inComment = false
  let tagRaw = ''
  const skipStack = []

  for (let i = 0; i < html.length; i += 1) {
    const ch = html[i]

    if (inComment) {
      out += ch
      if (ch === '>' && html.slice(i - 2, i + 1) === '-->') inComment = false
      continue
    }

    if (inTag) {
      tagRaw += ch
      out += ch
      if (ch === '>') {
        inTag = false
        const name = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(tagRaw)
        const lower = name ? name[1].toLowerCase() : ''
        const closing = tagRaw[1] === '/'
        const selfClosing = /\/\s*>$/.test(tagRaw) || lower === 'br' || lower === 'wbr'
        if (closing) {
          if (skipStack.length > 0 && skipStack[skipStack.length - 1] === lower) {
            skipStack.pop()
          }
        } else if (!selfClosing && SKIP_TAGS.has(lower)) {
          skipStack.push(lower)
        } else if (!selfClosing && /(^|["'\s])no-break(["'\s]|$)/.test(topTagClass(tagRaw))) {
          skipStack.push(lower)
        }
      }
      continue
    }

    if (ch === '<') {
      if (html.slice(i, i + 4) === '<!--') {
        inComment = true
        out += '<!--'
        i += 3
        continue
      }
      inTag = true
      tagRaw = '<'
      out += ch
      continue
    }

    if (skipStack.length > 0) {
      out += ch
      continue
    }

    if (BREAK_AFTER_RE.test(ch)) {
      let j = i + 1
      while (j < html.length && /\s/.test(html[j])) j += 1
      const next = html[j]
      if (next === undefined) {
        out += ch
        continue
      }
      if (next === '<') {
        const after = html.slice(j, j + 8).toLowerCase()
        if (/^<\s*(wbr|br)\b/.test(after) || /^<\/\s*[a-zA-Z]/.test(after)) {
          out += ch
          continue
        }
        out += ch + '<wbr>'
        continue
      }
      if (BREAK_AFTER_RE.test(next) || /[）】》」』”’]/.test(next)) {
        out += ch
        continue
      }
      out += ch + '<wbr>'
      continue
    }

    out += ch
  }

  return out
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Audit an HTML string against the guide's rules.
 * Returns { ok, summary, issues, css, stats, fixedHtml? }
 */
function auditHtml(html, options = {}) {
  const issues = []
  const fixMode = options.mode === 'fix'
  const elements = collectElements(html)
  const css = auditCss(html)
  const docWbrCount = (html.match(/<wbr\b/gi) || []).length
  const docBrCount = (html.match(/<br\b/gi) || []).length

  const push = (severity, rule, where, message, suggestion) => {
    issues.push({ severity, rule, where, message, suggestion })
  }

  // --- CSS guard ---------------------------------------------------------
  if (!css.hasStyle) {
    push('warn', 'missing-css-guard', '<style>',
      '页面没有 <style> 块，缺少全局断行保护。',
      '建议加入全局规则：line-break: strict; word-break: keep-all; overflow-wrap: normal。')
  } else {
    if (!css.keepAll) {
      push('error', 'missing-keep-all', '<style>',
        '缺少 word-break: keep-all，浏览器可能把中文按单字任意断开。',
        '为 h1/h2/p 等文本容器添加 word-break: keep-all。')
    }
    if (!css.lineBreakStrict) {
      push('warn', 'missing-line-break-strict', '<style>',
        '缺少 line-break: strict，换行规则可能偏宽松。',
        '建议添加 line-break: strict。')
    }
    if (css.nowrapBroad) {
      push('error', 'broad-nowrap', '<style>',
        '检测到全局选择器上使用 white-space: nowrap，窄屏会直接横向溢出。',
        '只在单个不可拆短语（.no-break）上使用 nowrap，不要全局使用。')
    }
    if (css.textWrapPretty) {
      push('info', 'text-wrap-only', '<style>',
        '依赖 text-wrap: pretty/balance 辅助排版，但不同浏览器结果不稳定。',
        '仅作辅助；关键位置仍应由 <wbr>/<br>/.no-break 明确指定。')
    }
  }

  // --- Per-element checks ------------------------------------------------
  for (const el of elements) {
    const where = `<${el.tag}>`
    const plain = el.text
    const cjk = cjkCount(plain)

    if (cjk === 0) continue

    // Orphan line: explicit <br> produced a line of "one char + 。"
    for (const line of el.lines) {
      if (!line) continue
      if (ORPHAN_LINE_RE.test(line)) {
        push('error', 'orphan-line', where,
          `存在“孤字行”：整行只有“${line}”，违反“没有'一个字+标点'单独留在末行”。`,
          '在上层语义边界加 <wbr> 或调整文字，不要让单字+句号独占一行。')
      } else if (ORPHAN_LINE_SHORT_RE.test(line)) {
        push('warn', 'orphan-line', where,
          `行内容过短：整行只有“${line}”，接近孤字风险。`,
          '检查该行是否为自然停顿，必要时调整断行点。')
      }
      if (LINE_START_BAD_RE.test(line)) {
        push('error', 'line-start-punctuation', where,
          `行首出现标点“${line[0]}”，标点不应单独占行首。`,
          '把标点保留在上一行的语义片段末尾，或调整断行位置。')
      }
    }

    // Long copy with punctuation but no break opportunity at all
    if (cjk >= 16 && BREAK_AFTER_RE.test(plain)) {
      const hasBreak = /<wbr\b|<br\b/i.test(el.html)
      if (!hasBreak) {
        push('warn', 'no-breakpoint', where,
          `较长文案（约 ${cjk} 个汉字）没有任何 <wbr>/<br> 换行点，窄屏时浏览器会任意切断。`,
          '在逗号、分号、句号之后等自然停顿处添加 <wbr>。')
      }
    }

    // Overlong .no-break
    if (el.hasNoBreak && cjk > 14) {
      push('warn', 'overlong-no-break', where,
        `.no-break 内的内容较长（约 ${cjk} 个汉字），窄屏可能放不下而溢出。`,
        '缩短该短语，或在更上层的语义边界换行。')
    }

    // Punctuation right at the very start of element text
    if (LINE_START_BAD_RE.test(plain)) {
      push('warn', 'leading-punctuation', where,
        `元素文本以标点“${plain[0]}”开头，通常是上一处断行把标点挤到了行首。`,
        '检查该元素之前的断行点，标点应留在其所属句子的行尾。')
    }
  }

  // --- Fix mode -----------------------------------------------------------
  let fixedHtml = null
  if (fixMode) {
    fixedHtml = insertWbr(html)
    const after = (fixedHtml.match(/<wbr\b/gi) || []).length
    const inserted = after - docWbrCount
    issues.push({
      severity: 'info', rule: 'fix-applied', where: 'document',
      message: `修复模式：已在 ${inserted} 处标点后插入 <wbr>（共 ${after} 个）。`,
      suggestion: '请人工复查每个 <wbr> 是否符合语义边界，尤其产品名/专有名词内部不应有 <wbr>。',
    })
  }

  // --- Summary & stats ----------------------------------------------------
  const errors = issues.filter((i) => i.severity === 'error').length
  const warns = issues.filter((i) => i.severity === 'warn').length
  const infos = issues.filter((i) => i.severity === 'info').length
  const ok = errors === 0

  const summary = ok
    ? '未发现明确的断行错误；请按验收清单逐页人工复查。'
    : `发现 ${errors} 个错误、${warns} 个警告、${infos} 条提示，需修复后再验收。`

  const stats = {
    elements: elements.length,
    cjkElements: elements.filter((e) => cjkCount(e.text) > 0).length,
    wbrs: docWbrCount,
    breaks: docBrCount,
    insertedWbr: fixMode ? (fixedHtml.match(/<wbr\b/gi) || []).length - docWbrCount : 0,
  }

  return { ok, summary, issues, css, stats, fixedHtml }
}

// ---------------------------------------------------------------------------
// Exports (CommonJS so it runs in Node CLI and DSH sandbox alike)
// ---------------------------------------------------------------------------

module.exports = { auditHtml, insertWbr, collectElements, auditCss, stripTags, cjkCount }
