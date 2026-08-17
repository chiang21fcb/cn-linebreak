'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { auditHtml, insertWbr } = require('../src/engine')

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

test('good document passes audit with zero errors', () => {
  const r = auditHtml(GOOD_HTML, { mode: 'audit' })
  assert.equal(r.ok, true, r.summary)
  assert.equal(r.css.keepAll, true)
  assert.equal(r.css.lineBreakStrict, true)
  assert.equal(r.issues.filter((i) => i.severity === 'error').length, 0)
})

test('missing keep-all is an error', () => {
  const r = auditHtml('<style>p { color: red }</style><p>一段中文文案。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'missing-keep-all' && i.severity === 'error'))
  assert.equal(r.ok, false)
})

test('missing style block warns', () => {
  const r = auditHtml('<p>一段中文文案。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'missing-css-guard' && i.severity === 'warn'))
})

test('orphan line of one char + 。 is an error', () => {
  const r = auditHtml('<h2>三种扩展，<br>子。</h2>')
  assert.ok(r.issues.some((i) => i.rule === 'orphan-line' && i.severity === 'error' && i.where === '<h2>'))
})

test('short line of two chars + 。 warns', () => {
  const r = auditHtml('<h2>三种扩展，<br>自由。</h2>')
  assert.ok(r.issues.some((i) => i.rule === 'orphan-line' && i.severity === 'warn'))
})

test('punctuation at line start is an error', () => {
  const r = auditHtml('<p>读完产品手册<br>，再写总结。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'line-start-punctuation' && i.severity === 'error'))
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

test('broad white-space: nowrap is an error', () => {
  const r = auditHtml('<style>* { white-space: nowrap }</style><p>中文文案。</p>')
  assert.ok(r.issues.some((i) => i.rule === 'broad-nowrap' && i.severity === 'error'))
})

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

test('insertWbr skips .no-break spans', () => {
  const html = '<h2><span class="no-break">产品培训专员</span>，上岗。</h2>'
  const out = insertWbr(html)
  assert.ok(out.includes('<span class="no-break">产品培训专员</span>，<wbr>上岗。'))
  assert.ok(!out.includes('专员，<wbr>'))
})

test('insertWbr does not insert before closing tag or existing breaks', () => {
  assert.equal(insertWbr('<h2>自由。</h2>'), '<h2>自由。</h2>')
  assert.equal(insertWbr('<h2>第一步，<wbr>第二步。</h2>'), '<h2>第一步，<wbr>第二步。</h2>')
  assert.equal(insertWbr('<h2>第一步，<br>第二步。</h2>'), '<h2>第一步，<br>第二步。</h2>')
})

test('insertWbr skips punctuation followed by closing quote', () => {
  const out = insertWbr('<p>他说：“出发”，然后离开。</p>')
  // 冒号后可插；引号后的逗号也可插；句末句号在闭合标签前不插
  assert.ok(out.includes('他说：<wbr>“出发”，<wbr>然后离开。'))
})

test('fix mode returns fixedHtml and counts insertions', () => {
  const r = auditHtml('<p>读产品手册，提取事实，输出文档。</p>', { mode: 'fix' })
  assert.ok(r.fixedHtml.includes('手册，<wbr>提取'))
  assert.ok(r.fixedHtml.includes('事实，<wbr>输出'))
  assert.ok(r.stats.insertedWbr > 0)
  assert.ok(r.issues.some((i) => i.rule === 'fix-applied'))
})

test('guide example sentence fixes to the expected shape', () => {
  const out = insertWbr('<h2>WB 二期作业：选一个致趣模块，做培训材料。</h2>')
  assert.equal(out, '<h2>WB 二期作业：<wbr>选一个致趣模块，<wbr>做培训材料。</h2>')
})
