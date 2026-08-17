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
 * v0.1.1 additions per《cn-linebreak 更新建议与规则路线图》:
 *   - full HTML void-element handling
 *   - depth-aware .no-break / skip-tag nesting (same-name nesting safe)
 *   - punctuation at the end of an inline tag is still a valid break point
 *   - CSS selector coverage analysis (keep-all trusted / partial; no-break-scoped nowrap)
 *   - CLReq / GB-T 15834 line-start & line-end prohibited punctuation
 *   - project protected-phrase dictionary (config) — no <wbr> inside, split detection
 *   - configurable breakAfter / minCjkLength / minLastLineCjk
 *
 * Pure functions, zero dependencies. Works in Node and in the DSH plugin sandbox.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Default punctuation after which a break opportunity is welcome (guide §2)
const BREAK_AFTER_DEFAULT = '，。；：、'

// Punctuation that must never sit alone at the start of a line (CLReq / GB-T 15834)
// Closing punctuation: full-width + ASCII closers.
const LINE_START_BAD_RE = /^[，。；：、！？）】》」』”’％‰>)\]}]+/

// Opening punctuation that must never sit alone at the end of a line (CLReq)
const LINE_END_BAD_RE = /[(（【《「『“‘<\[{]+$/

// An orphan line: exactly one CJK char + sentence-final punctuation
const ORPHAN_LINE_RE = /^[\u4e00-\u9fff]{1}[。！？]$/

// Standard HTML void elements (no closing tag, never pollute the element stack)
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
])

// Tags whose inner content must never be touched
const SKIP_TAGS = new Set([
  'script', 'style', 'pre', 'code', 'textarea', 'title',
  'template', 'svg', 'math', 'noscript',
])

// Element names that count as "target text elements" for CSS coverage analysis
const TEXT_ELEMENT_NAMES = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'li', 'td', 'th', 'blockquote', 'figcaption', 'caption',
  'dt', 'dd', 'summary', 'div', 'span', 'article', 'section', 'main',
]

// Inline tags: a closing tag of these does NOT end the text flow (§4.7)
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn',
  'em', 'i', 'ins', 'kbd', 'label', 'mark', 'q', 's', 'samp', 'small',
  'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
])

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function normalizeConfig(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {}
  return {
    protectedPhrases: Array.isArray(c.protectedPhrases) ? c.protectedPhrases.map(String).filter(Boolean) : [],
    breakAfter: typeof c.breakAfter === 'string' && c.breakAfter.length > 0 ? c.breakAfter : BREAK_AFTER_DEFAULT,
    minCjkLength: Number.isFinite(c.minCjkLength) ? c.minCjkLength : 16,
    minLastLineCjk: Number.isFinite(c.minLastLineCjk) ? c.minLastLineCjk : 2,
    selectors: Array.isArray(c.selectors) ? c.selectors.map(String) : [],
    strictWarnings: !!c.strictWarnings,
    useSegmenter: !!c.useSegmenter, // reserved: wired in v0.3.0 candidate scoring
  }
}

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

    if (kind === 'comment') {
      pos = comment.index + comment[0].length
      continue
    }
    const raw = tag[0]
    const name = tag[1].toLowerCase()
    const closing = raw[1] === '/'
    const selfClosing = /\/\s*>$/.test(raw) || VOID_TAGS.has(name)
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
 * Skip regions (script/style/pre/…) are tracked by node depth, so same-name
 * nesting (`<script><script>…</script></script>`) cannot pop early.
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
      } else if (!selfClosing) {
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

    openStack.push({
      tag: name,
      start: index + tagInfo.raw.length,
      inner: '',
      html: '',
      text: '',
      lines: [],
      wbrCount: 0,
      hasNoBreak: attrsHaveNoBreak(attrs),
    })
  }, () => {})

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
// CSS audit (v0.1.1: selector coverage analysis)
// ---------------------------------------------------------------------------

function parseCssRules(css) {
  const rules = []
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = ruleRe.exec(css)) !== null) {
    const selectorRaw = m[1]
    const decls = m[2]
    for (const single of selectorRaw.split(',')) {
      const selector = single.trim()
      if (selector) rules.push({ selector, decls })
    }
  }
  return rules
}

function declHas(decls, prop, value) {
  const re = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*' + value + '\\s*(?:;|$)', 'i')
  return re.test(decls)
}

/**
 * Whether a selector can reach target text elements (h1/h2/p/td/…) or is universal.
 * Handles `:where(h1, h2, p)`-style lists and combinator chains heuristically.
 */
function coversTextElements(selector) {
  if (/(?:^|[\s>~+.#\[(,])(html|body|:root)(?:$|[\s>~+.#\[(,:])/.test(selector)) return true
  if (/(?:^|[\s>~+.#\[(,])[*](?:$|[\s>~+.#\[(,:])/.test(selector)) return true
  const names = TEXT_ELEMENT_NAMES.join('|')
  const re = new RegExp('(?:^|[\\s>~+.#\\[(,])(' + names + ')(?:$|[\\s>~+.#\\[(,:])')
  return re.test(selector)
}

function isNoBreakScoped(selector) {
  return /\.no-break/.test(selector) && !coversTextElements(selector)
}

function auditCss(html) {
  const styleBlocks = []
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let m
  while ((m = styleRe.exec(html)) !== null) styleBlocks.push(m[1])

  const css = styleBlocks.join('\n')
  const rules = parseCssRules(css)
  const hasStyle = styleBlocks.length > 0
  const lineBreakStrict = /\bline-break\s*:\s*strict\b/i.test(css)
  const overflowWrapNormal = /\boverflow-wrap\s*:\s*normal\b/i.test(css)
  const textWrapPretty = /\btext-wrap\s*:\s*(pretty|balance)\b/i.test(css)

  const keepAllRules = rules.filter((r) => declHas(r.decls, 'word-break', 'keep-all'))
  const nowrapRules = rules.filter((r) => declHas(r.decls, 'white-space', 'nowrap'))

  const keepAllFound = keepAllRules.length > 0
  const keepAllTrusted = keepAllRules.some((r) => coversTextElements(r.selector))
  const keepAllCoverage = keepAllTrusted ? 'trusted' : keepAllFound ? 'partial' : 'none'

  // Broad nowrap = nowrap rule that reaches text elements; `.no-break`-scoped
  // rules (e.g. `:where(.no-break) { white-space: nowrap }`) are legitimate.
  const nowrapBroad = nowrapRules.some((r) => coversTextElements(r.selector) && !isNoBreakScoped(r.selector))

  return {
    hasStyle,
    keepAll: keepAllFound,
    keepAllCoverage,
    lineBreakStrict,
    overflowWrapNormal,
    textWrapPretty,
    nowrapBroad,
    keepAllRules: keepAllRules.length,
    nowrapRules: nowrapRules.length,
    cssLength: css.length,
  }
}

// ---------------------------------------------------------------------------
// Fix: insert <wbr> after breakAfter punctuation at semantic boundaries
// ---------------------------------------------------------------------------

function topTagClass(raw) {
  const m = /class\s*=\s*["']([^"']*)["']/.exec(raw)
  return m ? m[1] : ''
}

/**
 * Whether a raw tag string carries the no-break class, quoted or unquoted:
 * `class="no-break"`, `class='no-break'`, `class=no-break`.
 */
function attrsHaveNoBreak(raw) {
  return /(^|["'\s=])no-break(["'\s=]|$)/.test(raw)
}

/**
 * Build sorted [start, end) spans of protected phrases over the raw HTML.
 * Phrase occurrences wrapped in tags are not matched (use .no-break there).
 */
function buildProtectedSpans(html, phrases) {
  const spans = []
  for (const phrase of phrases) {
    if (typeof phrase !== 'string' || phrase.length < 2) continue
    let idx = html.indexOf(phrase)
    while (idx !== -1) {
      spans.push([idx, idx + phrase.length])
      idx = html.indexOf(phrase, idx + 1)
    }
  }
  return spans
}

function inSpans(spans, pos) {
  for (const [s, e] of spans) {
    if (pos >= s && pos < e) return true
  }
  return false
}

/**
 * Insert <wbr> after breakAfter punctuation (default ，。；：、) inside text
 * content. Skips:
 *   - script/style/pre/code/textarea/title and .no-break regions (depth-aware)
 *   - positions already followed by <wbr>/<br>
 *   - positions inside protected phrases
 *   - end-of-element punctuation (nothing follows the closing tags)
 * Punctuation at the end of an *inline* tag still gets a <wbr> when real
 * content follows the closing tag (§4.7: `<strong>第一步，</strong>第二步`).
 */
function insertWbr(html, options) {
  const config = normalizeConfig(options && options.config)
  const breakChars = new Set(config.breakAfter.split(''))
  const protectedSpans = buildProtectedSpans(html, config.protectedPhrases)

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
        const selfClosing = /\/\s*>$/.test(tagRaw) || VOID_TAGS.has(lower)
        if (closing) {
          if (skipStack.length > 0 && skipStack[skipStack.length - 1] === lower) {
            skipStack.pop()
          }
        } else if (!selfClosing) {
          // while inside a skip region, every nested open keeps the depth correct
          if (skipStack.length > 0) {
            skipStack.push(lower)
          } else if (SKIP_TAGS.has(lower)) {
            skipStack.push(lower)
          } else if (attrsHaveNoBreak(tagRaw)) {
            skipStack.push(lower)
          }
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

    if (breakChars.has(ch)) {
      // skip protected-phrase positions
      if (inSpans(protectedSpans, i) || inSpans(protectedSpans, i + 1)) {
        out += ch
        continue
      }
      let j = i + 1
      while (j < html.length && /\s/.test(html[j])) j += 1
      const next = html[j]
      if (next === undefined) {
        out += ch
        continue
      }
      if (next === '<') {
        const after = html.slice(j, j + 8).toLowerCase()
        if (/^<\s*(wbr|br)\b/.test(after)) {
          out += ch
          continue
        }
        if (/^<\/\s*[a-zA-Z]/.test(after)) {
          // closing tag: only insert when real content follows the close chain
          if (hasContentAfterCloseChain(html, j)) {
            out += ch + '<wbr>'
          } else {
            out += ch
          }
          continue
        }
        // opening tag of a normal element: good break point
        out += ch + '<wbr>'
        continue
      }
      if (breakChars.has(next) || /[）】》」』”’>)\]}]/.test(next)) {
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

/**
 * From a closing-tag start index, scan forward. Inline closing tags continue
 * the text flow (§4.7); a block closing tag ends it. Return true when real
 * content (text or an opening tag) follows before a block boundary.
 */
function hasContentAfterCloseChain(html, fromIndex) {
  let i = fromIndex
  const total = html.length
  while (i < total) {
    while (i < total && /\s/.test(html[i])) i += 1
    if (i >= total) return false
    if (html[i] === '<') {
      if (html.slice(i, i + 4) === '<!--') {
        const end = html.indexOf('-->', i + 4)
        if (end === -1) return false
        i = end + 3
        continue
      }
      if (html[i + 1] === '/') {
        const tagEnd = html.indexOf('>', i + 2)
        if (tagEnd === -1) return false
        const name = /^<\/([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i, tagEnd + 1))
        const lower = name ? name[1].toLowerCase() : ''
        if (!INLINE_TAGS.has(lower)) return false // block boundary
        i = tagEnd + 1
        continue
      }
      return true
    }
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

/**
 * Audit an HTML string against the guide's rules.
 * Returns { ok, summary, issues, css, stats, fixedHtml? }
 */
function auditHtml(html, options) {
  const opts = options || {}
  const fixMode = opts.mode === 'fix'
  const config = normalizeConfig(opts.config)
  const issues = []
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
    if (css.keepAllCoverage === 'none') {
      push('error', 'missing-keep-all', '<style>',
        '缺少 word-break: keep-all，浏览器可能把中文按单字任意断开。',
        '为 h1/h2/p 等文本容器添加 word-break: keep-all。')
    } else if (css.keepAllCoverage === 'partial') {
      push('warn', 'keep-all-partial', '<style>',
        '检测到 word-break: keep-all，但其选择器未覆盖 h1/h2/p 等目标文本元素，保护可能不生效。',
        '把 keep-all 应用到 :where(h1, h2, p, …) 这样的文本容器选择器上。')
    }
    if (!css.lineBreakStrict) {
      push('warn', 'missing-line-break-strict', '<style>',
        '缺少 line-break: strict，换行规则可能偏宽松。',
        '建议添加 line-break: strict。')
    }
    if (css.nowrapBroad) {
      push('error', 'broad-nowrap', '<style>',
        '检测到覆盖文本元素的 white-space: nowrap 规则，窄屏会直接横向溢出。',
        '只在单个不可拆短语（.no-break）上使用 nowrap，不要应用到通用文本元素。')
    }
    if (css.textWrapPretty) {
      push('info', 'text-wrap-only', '<style>',
        '依赖 text-wrap: pretty/balance 辅助排版，但不同浏览器结果不稳定。',
        '仅作辅助；关键位置仍应由 <wbr>/<br>/.no-break 明确指定。')
    }
  }

  // --- Per-element checks ------------------------------------------------
  for (const el of elements) {
    const where = '<' + el.tag + '>'
    const plain = el.text
    const cjk = cjkCount(plain)

    if (cjk === 0) continue

    // Explicit <br> line checks: orphan lines, line-start / line-end punctuation
    for (const line of el.lines) {
      if (!line) continue
      const lineCjk = cjkCount(line)
      if (ORPHAN_LINE_RE.test(line)) {
        push('error', 'orphan-line', where,
          '存在“孤字行”：整行只有“' + line + '”，违反“没有一个字+标点单独留在末行”。',
          '在上层语义边界加 <wbr> 或调整文字，不要让单字+句号独占一行。')
      } else if (lineCjk > 0 && lineCjk <= config.minLastLineCjk && /[。！？]$/.test(line)) {
        push('warn', 'orphan-line', where,
          '行内容过短：整行只有“' + line + '”，接近孤字风险。',
          '检查该行是否为自然停顿，必要时调整断行点。')
      }
      if (LINE_START_BAD_RE.test(line)) {
        push('error', 'line-start-punctuation', where,
          '行首出现闭式标点“' + line[0] + '”，标点不应单独占行首。',
          '把标点保留在上一行的语义片段末尾，或调整断行位置。')
      }
      if (LINE_END_BAD_RE.test(line)) {
        push('error', 'line-end-punctuation', where,
          '行尾出现开式标点“' + line[line.length - 1] + '”，开启标点不应孤立在行尾。',
          '把开式标点与后续内容保持在同一行。')
      }
    }

    // Long copy with punctuation but no break opportunity at all
    if (cjk >= config.minCjkLength && /[，。；：、]/.test(plain)) {
      const hasBreak = /<wbr\b|<br\b/i.test(el.html)
      if (!hasBreak) {
        push('warn', 'no-breakpoint', where,
          '较长文案（约 ' + cjk + ' 个汉字）没有任何 <wbr>/<br> 换行点，窄屏时浏览器会任意切断。',
          '在逗号、分号、句号之后等自然停顿处添加 <wbr>。')
      }
    }

    // Overlong .no-break
    if (el.hasNoBreak && cjk > 14) {
      push('warn', 'overlong-no-break', where,
        '.no-break 内的内容较长（约 ' + cjk + ' 个汉字），窄屏可能放不下而溢出。',
        '缩短该短语，或在更上层的语义边界换行。')
    }

    // Protected phrases split across explicit <br> lines
    for (const phrase of config.protectedPhrases) {
      if (phrase.length < 2) continue
      let split = false
      for (let k = 0; k < el.lines.length - 1; k += 1) {
        const a = el.lines[k]
        const b = el.lines[k + 1]
        // phrase crosses boundary k iff a suffix of line k + a prefix of line k+1 == phrase
        for (let cut = 1; cut <= Math.min(phrase.length - 1, a.length); cut += 1) {
          if (a.endsWith(phrase.slice(0, cut)) && b.startsWith(phrase.slice(cut))) {
            split = true
            break
          }
        }
        if (split) break
      }
      if (split) {
        push('error', 'protected-phrase-split', where,
          '保护词“' + phrase + '”被换行拆开。',
          '为该词使用 .no-break 容器，或调整断行点。')
      }
    }

    // Punctuation right at the very start of element text
    if (LINE_START_BAD_RE.test(plain)) {
      push('warn', 'leading-punctuation', where,
        '元素文本以标点“' + plain[0] + '”开头，通常是上一处断行把标点挤到了行首。',
        '检查该元素之前的断行点，标点应留在其所属句子的行尾。')
    }
  }

  // --- Fix mode -----------------------------------------------------------
  let fixedHtml = ''
  if (fixMode) {
    fixedHtml = insertWbr(html, { config })
    const after = (fixedHtml.match(/<wbr\b/gi) || []).length
    const inserted = after - docWbrCount
    issues.push({
      severity: 'info', rule: 'fix-applied', where: 'document',
      message: '修复模式：已在 ' + inserted + ' 处标点后插入 <wbr>（共 ' + after + ' 个）。',
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
    : '发现 ' + errors + ' 个错误、' + warns + ' 个警告、' + infos + ' 条提示，需修复后再验收。'

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
// Exports (CommonJS so it runs in Node CLI and DSH plugin sandbox alike)
// ---------------------------------------------------------------------------

module.exports = {
  auditHtml,
  insertWbr,
  collectElements,
  auditCss,
  normalizeConfig,
  buildProtectedSpans,
  stripTags,
  cjkCount,
  BREAK_AFTER_DEFAULT,
  VOID_TAGS,
  SKIP_TAGS,
}
