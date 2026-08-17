'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { auditHtml, insertWbr, collectElements } = require('../src/engine')

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOOD_HTML = `
<style>
  :where(h1, h2, p, .card-body, .step-body, .micro, th, td) {
    line-break: strict;
    word-break: keep-all;
    overflow-wrap: normal;
  }
</style>
<h2>WB 二期作业：<wbr>选一个致趣模块，<wbr>做培训材料。</h2>
<p>AI 现场写插件<wbr>→ 读产品手册<wbr>→ 按培训结构输出。</p>
<h2>一整条工作链，<br>每个环节都是工具。</h2>
<h2><span class="no-break">落盘成“产品培训专员”</span><br>预设。</h2>
`

// ---------------------------------------------------------------------------
// Basic audit
// ---------------------------------------------------------------------------

test('good document passes audit with zero errors', () => {
  const r = auditHtml(GOOD_HTML, { mode: 'audit' })
  assert.equal(r.ok, true, r.summary)
  assert.equal(r.css.keepAll, true)
  assert.equal(r.css.keepAllCoverage, 'trusted')
  assert.equal(r.css.lineBreakStrict, true)
  assert.equal(r.issues.filter((i) => i.severity === 'error').length, 0)
})

test('missing keep-all is an error; partial keep-all is a warning', () => {
  const r = auditHtml('<style>p { color: red }</style><p>一段中文文案。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'missing-keep-all' && i.severity === 'error'))
  const partial = auditHtml('<style>.card-body { word-break: keep-all }</style><p>一段中文文案。</p>')
  assert.ok(partial.issues.some((i) => i.rule === 'keep-all-partial' && i.severity === 'warn'))
  assert.equal(partial.css.keepAllCoverage, 'partial')
})

test('missing style block warns', () => {
  const r = auditHtml('<p>一段中文文案。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'missing-css-guard' && i.severity === 'warn'))
})

test('no-break-scoped nowrap is not flagged as broad', () => {
  const r = auditHtml('<style>:where(.no-break) { white-space: nowrap }</style><p>中文文案。</p>')
  assert.equal(r.css.nowrapBroad, false)
})

test('broad white-space: nowrap on text elements is an error', () => {
  const r = auditHtml('<style>* { white-space: nowrap }</style><p>中文文案。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'broad-nowrap' && i.severity === 'error'))
})

// ---------------------------------------------------------------------------
// Line checks (CLReq / GB-T 15834)
// ---------------------------------------------------------------------------

test('orphan line of one char + 。 is an error', () => {
  const r = auditHtml('<h2>三种扩展，<br>子。</h2>')
  assert.ok(r.issues.some((i) => i.rule === 'orphan-line' && i.severity === 'error' && i.where === '<h2>'))
})

test('short line of two chars + 。 warns', () => {
  const r = auditHtml('<h2>三种扩展，<br>自由。</h2>')
  assert.ok(r.issues.some((i) => i.rule === 'orphan-line' && i.severity === 'warn'))
})

test('closing punctuation at line start is an error', () => {
  const r = auditHtml('<p>读完产品手册<br>，再写总结。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'line-start-punctuation' && i.severity === 'error'))
})

test('opening punctuation at line end is an error (CLReq)', () => {
  const r = auditHtml('<p>他强调（<br>这不是重点）。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'line-end-punctuation' && i.severity === 'error'))
})

test('closing bracket at line start is caught', () => {
  const r = auditHtml('<p>读产品手册<br>）再写总结。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'line-start-punctuation' && i.severity === 'error'))
})

// ---------------------------------------------------------------------------
// Element collection / void elements
// ---------------------------------------------------------------------------

test('HTML void elements do not pollute the element stack', () => {
  const html = '<p>第一行。<img src="x.png" alt="图">第二行。</p><meta charset="utf-8"><input value="x">'
  const els = collectElements(html)
  const p = els.find((e) => e.tag === 'p')
  assert.ok(p, 'p element must be collected')
  assert.equal(p.text, '第一行。 第二行。')
  assert.ok(!els.some((e) => e.tag === 'img' || e.tag === 'meta' || e.tag === 'input'))
})

test('uppercase tags are normalized', () => {
  const els = collectElements('<H2>三种扩展，三种自由。</H2>')
  assert.equal(els.length, 1)
  assert.equal(els[0].tag, 'h2')
})

test('HTML comments are ignored', () => {
  const r = auditHtml('<h2>三种<!-- 注释，含标点 -->扩展，三种自由。</h2>')
  assert.equal(r.stats.elements, 1)
  assert.ok(r.stats.cjkElements === 1)
})

test('incomplete HTML is tolerated (unclosed element still collected)', () => {
  const els = collectElements('<p>一段没有闭合的中文文案。')
  assert.equal(els.length, 1)
  assert.equal(els[0].tag, 'p')
})

// ---------------------------------------------------------------------------
// .no-break nesting
// ---------------------------------------------------------------------------

test('no-break with nested inline tags protects content', () => {
  const html = '<h2><span class="no-break">落盘成<b>“产品培训专员”</b></span><br>预设。</h2>'
  const out = insertWbr(html)
  assert.ok(out.includes('<span class="no-break">落盘成<b>“产品培训专员”</b></span><br>预设。'))
  assert.ok(!out.includes('专员”<wbr>'))
})

test('same-name nested spans inside no-break keep protection depth', () => {
  const html = '<h2><span class="no-break">产品<span>培训</span>专员</span>，上岗。</h2>'
  const out = insertWbr(html)
  assert.ok(out.includes('<span class="no-break">产品<span>培训</span>专员</span>，<wbr>上岗。'))
  assert.ok(!out.includes('专员，'))
  assert.ok(out.includes('专员</span>，<wbr>上岗。'))
})

test('unquoted no-break class is detected', () => {
  const html = '<h2><span class=no-break>产品培训专员</span>，上岗。</h2>'
  const out = insertWbr(html)
  assert.ok(out.includes('<span class=no-break>产品培训专员</span>，<wbr>上岗。'))
  const r = auditHtml('<h2><span class=no-break>超长不可拆短语内容超过十四字会触发警告</span></h2>')
  assert.ok(r.issues.some((i) => i.rule === 'overlong-no-break'))
})

// ---------------------------------------------------------------------------
// insertWbr details
// ---------------------------------------------------------------------------

test('insertWbr adds wbr after CJK punctuation', () => {
  const out = insertWbr('<h2>选一个模块，做培训材料。</h2>')
  assert.equal(out, '<h2>选一个模块，<wbr>做培训材料。</h2>')
})

test('insertWbr does not touch code/pre/script content', () => {
  const html = '<p>第一步，开始。</p><pre>a，b；c。</pre><script>const s = "甲，乙";</script>'
  const out = insertWbr(html)
  assert.ok(out.includes('<pre>a，b；c。</pre>'))
  assert.ok(out.includes('<script>const s = "甲，乙";</script>'))
  assert.ok(out.includes('<p>第一步，<wbr>开始。</p>'))
})

test('insertWbr handles punctuation at the end of an inline tag (v0.1.1)', () => {
  const out = insertWbr('<h2><strong>第一步，</strong>第二步</h2>')
  assert.equal(out, '<h2><strong>第一步，<wbr></strong>第二步</h2>')
})

test('insertWbr does not insert when only closing tags follow', () => {
  assert.equal(insertWbr('<h2>自由。</h2>'), '<h2>自由。</h2>')
  assert.equal(insertWbr('<h2><strong>自由。</strong></h2>'), '<h2><strong>自由。</strong></h2>')
})

test('insertWbr skips existing breaks', () => {
  assert.equal(insertWbr('<h2>第一步，<wbr>第二步。</h2>'), '<h2>第一步，<wbr>第二步。</h2>')
  assert.equal(insertWbr('<h2>第一步，<br>第二步。</h2>'), '<h2>第一步，<br>第二步。</h2>')
})

test('insertWbr skips punctuation followed by closing quote', () => {
  const out = insertWbr('<p>他说：“出发”，然后离开。</p>')
  assert.ok(out.includes('他说：<wbr>“出发”，<wbr>然后离开。'))
})

test('guide example sentence fixes to the expected shape', () => {
  const out = insertWbr('<h2>WB 二期作业：选一个致趣模块，做培训材料。</h2>')
  assert.equal(out, '<h2>WB 二期作业：<wbr>选一个致趣模块，<wbr>做培训材料。</h2>')
})

// ---------------------------------------------------------------------------
// Numbers / dates / versions / mixed scripts (must not be split)
// ---------------------------------------------------------------------------

test('numbers, percents, dates and version numbers are never split', () => {
  const out = insertWbr('<p>版本 v1.2.3 于 2026-08-17 发布，占比 50.5%，价格 ¥99.00。</p>')
  assert.ok(!out.includes('v1.2.3<wbr>'))
  assert.ok(!out.includes('2026-08-17<wbr>'))
  assert.ok(!out.includes('50.5%<wbr>'))
  assert.ok(!out.includes('99.00<wbr>'))
  assert.ok(out.includes('发布，<wbr>占比'))
})

test('mixed CJK and English words are kept intact', () => {
  const out = insertWbr('<p>使用 AI 生成 Git 提交信息，然后运行 web UI。</p>')
  assert.ok(!out.includes('AI<wbr>'))
  assert.ok(!out.includes('Git<wbr>'))
  assert.ok(!out.includes('web UI<wbr>'))
  assert.ok(out.includes('信息，<wbr>然后'))
})

test('paired quotes and brackets are not split', () => {
  const out = insertWbr('<p>他说“出发”，然后写《指南》的（说明）。</p>')
  assert.ok(!out.includes('“<wbr>出发'))
  assert.ok(!out.includes('《<wbr>指南'))
  assert.ok(!out.includes('（<wbr>说明'))
})

test('ellipsis and dash are kept whole', () => {
  const out = insertWbr('<p>等等……然后继续——就这样。</p>')
  assert.ok(out.includes('等等……然后'))
  assert.ok(!out.includes('…<wbr>'))
  assert.ok(!out.includes('—<wbr>'))
})

test('emoji and variation selectors do not break the scanner', () => {
  const out = insertWbr('<p>👍🏽 很棒，继续努力。🎉</p>')
  assert.ok(out.includes('很棒，<wbr>继续'))
})

test('unicode combining characters do not break the scanner', () => {
  const out = insertWbr('<p>e\u0301t\u00e9 咖啡，很好喝。</p>')
  assert.ok(out.includes('咖啡，<wbr>很好喝。'))
})

// ---------------------------------------------------------------------------
// Protected phrases + config
// ---------------------------------------------------------------------------

test('protected phrases get no wbr inside, but can follow after punctuation', () => {
  const config = { protectedPhrases: ['产品培训专员', 'cordis.yml'] }
  const out = insertWbr('<p>产品培训专员，先读 cordis.yml，再开始。</p>', { config })
  assert.ok(out.includes('产品培训专员，<wbr>先读'))
  assert.ok(!out.includes('专员<wbr>'))
  assert.ok(!out.includes('cordis.yml<wbr>'))
})

test('protected phrase containing punctuation blocks that position', () => {
  const config = { protectedPhrases: ['产品，培训专员'] }
  const out = insertWbr('<p>他说“产品，培训专员”很重要。</p>', { config })
  assert.ok(!out.includes('产品，<wbr>培训'))
  assert.ok(out.includes('很重要。</p>'))
})

test('audit flags a protected phrase split by <br>', () => {
  const config = { protectedPhrases: ['产品培训专员'] }
  const r = auditHtml('<h2>产品培训<br>专员，上岗。</h2>', { config })
  assert.ok(r.issues.some((i) => i.rule === 'protected-phrase-split' && i.severity === 'error'))
})

test('configurable breakAfter set is honored', () => {
  const config = { breakAfter: '；' }
  const out = insertWbr('<p>第一步；第二步，第三步。</p>', { config })
  assert.equal(out, '<p>第一步；<wbr>第二步，第三步。</p>')
})

test('configurable minCjkLength changes no-breakpoint threshold', () => {
  const longish = '这段中文文案没有换行点只有十五个字。' // exactly 17 CJK chars
  assert.equal(longish.replace(/[^一-龥]/g, '').length, 17)
  const defaultR = auditHtml('<p>' + longish + '</p>')
  assert.ok(defaultR.issues.some((i) => i.rule === 'no-breakpoint'))
  const relaxedR = auditHtml('<p>' + longish + '</p>', { config: { minCjkLength: 20 } })
  assert.ok(!relaxedR.issues.some((i) => i.rule === 'no-breakpoint'))
})

test('configurable minLastLineCjk changes short-line warning', () => {
  const r = auditHtml('<h2>三种扩展，<br>自由。</h2>', { config: { minLastLineCjk: 3 } })
  // 自由。 = 2 CJK chars ≤ 3 → warn
  assert.ok(r.issues.some((i) => i.rule === 'orphan-line' && i.severity === 'warn'))
})

// ---------------------------------------------------------------------------
// Fix-mode report + re-audit support
// ---------------------------------------------------------------------------

test('fix mode returns fixedHtml and counts insertions', () => {
  const r = auditHtml('<p>读产品手册，提取事实，输出文档。</p>', { mode: 'fix' })
  assert.ok(r.fixedHtml.includes('手册，<wbr>提取'))
  assert.ok(r.fixedHtml.includes('事实，<wbr>输出'))
  assert.ok(r.stats.insertedWbr > 0)
  assert.ok(r.issues.some((i) => i.rule === 'fix-applied'))
})

test('long copy without any breakpoint warns', () => {
  const longText = '这是一段比较长的中文演示文案，用来验证没有任何换行点的时候是否会给出提示。'
  const r = auditHtml(`<p>${longText}</p>`)
  assert.ok(r.issues.some((i) => i.rule === 'no-breakpoint' && i.severity === 'warn'))
})

test('overlong no-break span warns', () => {
  const longPhrase = '超级无敌长的产品名称和岗位名称组合在一起'
  const r = auditHtml(`<h2><span class="no-break">${longPhrase}</span></h2>`)
  assert.ok(r.issues.some((i) => i.rule === 'overlong-no-break' && i.severity === 'warn'))
})

// ---------------------------------------------------------------------------
// Unicode LineBreakTest representative cases (full official suite lands in v0.2.0)
// ---------------------------------------------------------------------------

test('UAX#14 representative: no break opportunity between two Han chars', () => {
  // Official LineBreakTest data: ÷ 中 × 文 ÷  (Han × Han = no break)
  const out = insertWbr('<p>中文编程，很好。</p>')
  assert.ok(!out.includes('中<wbr>文'))
  assert.ok(out.includes('编程，<wbr>很好。'))
})

test('UAX#14 representative: break opportunity after 、', () => {
  const out = insertWbr('<p>苹果、香蕉和梨。</p>')
  assert.ok(out.includes('苹果、<wbr>香蕉'))
})
