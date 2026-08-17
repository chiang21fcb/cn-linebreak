'use strict'

// UAX #14 LineBreakTest 代表性夹具测试（官方格式子集）。
// 解析 test/fixtures/linebreak-test.txt 中 `÷` / `×` 标记的对，
// 验证 insertWbr 不会在「禁止换行」对之间插入 <wbr>，会在「允许换行」的
// 中文标点之后插入 <wbr>。

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { insertWbr } = require('../src/engine')

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'linebreak-test.txt'), 'utf8')

function parsePairs() {
  const pairs = []
  for (const line of fixture.split('\n')) {
    const trimmed = line.split('#')[0].trim()
    if (!trimmed) continue
    const tokens = trimmed.split(/\s+/)
    let prev = null
    let prevKind = null // 'break' | 'nobreak'
    for (const tok of tokens) {
      if (tok === '÷') {
        prevKind = 'break'
        continue
      }
      if (tok === '×') {
        prevKind = 'nobreak'
        continue
      }
      if (tok === '÷') continue
      if (prev !== null && prevKind !== null) {
        pairs.push({ left: prev, right: tok, kind: prevKind })
      }
      prev = tok
    }
  }
  return pairs
}

test('fixture parses to a non-empty set of pairs', () => {
  const pairs = parsePairs()
  assert.ok(pairs.length > 0)
})

test('no <wbr> is inserted between UAX#14 no-break pairs', () => {
  const pairs = parsePairs().filter((p) => p.kind === 'nobreak')
  assert.ok(pairs.length > 0)
  for (const { left, right } of pairs) {
    const html = `<p>前${left}${right}后</p>`
    const out = insertWbr(html)
    assert.ok(
      !out.includes(`${left}<wbr>${right}`),
      `应在 ${left}×${right} 之间禁止换行，却插入了 <wbr>: ${out}`,
    )
  }
})

test('<wbr> is inserted after break-allowed CJK punctuation', () => {
  const pairs = parsePairs().filter((p) => p.kind === 'break' && /[，。]/.test(p.left))
  assert.ok(pairs.length > 0)
  for (const { left, right } of pairs) {
    const html = `<p>前${left}${right}后</p>`
    const out = insertWbr(html)
    assert.ok(
      out.includes(`${left}<wbr>${right}`),
      `应在 ${left}÷${right} 之间提供换行机会: ${out}`,
    )
  }
})
