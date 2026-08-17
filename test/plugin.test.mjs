import test from 'node:test'
import assert from 'node:assert/strict'

// Load the DSH bundle plugin module (ESM entry referenced by cordis.patch.yml
// as `cn-linebreak/plugin`), then run its apply() against a minimal fake ctx
// to prove the tool registers and actually executes end-to-end.
const plugin = await import('../plugin.mjs')

function makeFakeCtx() {
  const captured = []
  return {
    captured,
    tools: {
      register(def) {
        captured.push(def)
        return () => {}
      },
    },
  }
}

test('plugin module exports the cordis contract', () => {
  assert.equal(plugin.name, 'cn-linebreak')
  assert.deepEqual(plugin.inject, ['tools'])
  assert.equal(typeof plugin.apply, 'function')
})

test('apply() registers the cn_linebreak_audit tool', () => {
  const ctx = makeFakeCtx()
  plugin.apply(ctx, {})
  assert.equal(ctx.captured.length, 1)
  const tool = ctx.captured[0]
  assert.equal(tool.name, 'cn_linebreak_audit')
  assert.equal(typeof tool.execute, 'function')
  assert.ok(tool.parameters.required.includes('html'))
  assert.deepEqual(tool.parameters.properties.mode.enum, ['audit', 'fix'])
  assert.equal(typeof tool.output.render, 'function')
  assert.equal(typeof tool.output.schema, 'object')
})

test('registered tool audits and fixes HTML end-to-end', async () => {
  const ctx = makeFakeCtx()
  plugin.apply(ctx, {})
  const tool = ctx.captured[0]

  const audit = await tool.execute({ html: '<p>读产品手册，提取事实，输出文档。</p>', mode: 'audit' })
  assert.equal(audit.ok, true)
  assert.ok(Array.isArray(audit.issues))
  assert.ok(audit.stats.elements >= 1)
  assert.equal(audit.fixedHtml, '')

  const fix = await tool.execute({ html: '<p>读产品手册，提取事实，输出文档。</p>', mode: 'fix' })
  assert.ok(fix.fixedHtml.includes('手册，<wbr>提取'))
  assert.ok(fix.fixedHtml.includes('事实，<wbr>输出'))
  assert.ok(fix.stats.insertedWbr >= 2)
})

test('plugin config flows into the engine', async () => {
  const ctx = makeFakeCtx()
  plugin.apply(ctx, { engine: { protectedPhrases: ['产品培训专员'] } })
  const tool = ctx.captured[0]
  const fix = await tool.execute({ html: '<p>产品培训专员，上岗。</p>', mode: 'fix' })
  assert.ok(fix.fixedHtml.includes('产品培训专员，<wbr>上岗。'))
  assert.ok(!fix.fixedHtml.includes('专员<wbr>'))
})

test('render produces a readable text report', () => {
  const ctx = makeFakeCtx()
  plugin.apply(ctx, {})
  const tool = ctx.captured[0]
  const blocks = tool.output.render({}, {
    ok: false,
    summary: '发现 1 个错误。',
    issues: [{ severity: 'error', rule: 'orphan-line', where: '<h2>', message: '孤字行。', suggestion: '调整。' }],
    fixedHtml: '',
  })
  assert.ok(blocks[0].type === 'text')
  assert.ok(blocks[0].text.includes('孤字行'))
})
