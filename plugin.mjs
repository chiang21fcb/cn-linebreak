// cn-linebreak DSH plugin entry (ESM bundle module).
//
// This module is referenced by cordis.patch.yml as `name: cn-linebreak/plugin`.
// It registers the `cn_linebreak_audit` tool into the DSH tools registry so the
// agent model can audit / fix Chinese line-breaking in HTML per
// 《中文网页文案断行修复指南》.
//
// Zero runtime dependencies: the engine is plain CommonJS imported below, and
// the tool is registered as a raw ToolDefinition (no dsh-tools dependency).

import { auditHtml, normalizeConfig } from './src/engine.js'

export const name = 'cn-linebreak'

export const inject = ['tools']

const EMPTY_CSS = {
  hasStyle: false,
  keepAll: false,
  keepAllCoverage: 'none',
  keepAllWithOverflowWrap: false,
  lineBreakStrict: false,
  overflowWrapNormal: false,
  textWrapPretty: false,
  nowrapBroad: false,
  keepAllRules: 0,
  nowrapRules: 0,
  cssLength: 0,
}

const EMPTY_STATS = { elements: 0, cjkElements: 0, wbrs: 0, breaks: 0, insertedWbr: 0 }

export function apply(ctx, config) {
  const engineConfig = normalizeConfig(config && config.engine ? config.engine : config)

  ctx.tools.register({
    name: 'cn_linebreak_audit',
    description:
      '按《中文网页文案断行修复指南》审查并修复 HTML 的中文断行问题：孤字行、词组被拆、标点占行首/行尾、缺少 word-break: keep-all、全局 white-space: nowrap、过长 .no-break、长文案零换行点、保护词被拆等。mode=fix 时返回自动在中文标点后插入 <wbr> 的修复版 HTML。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        html: {
          type: 'string',
          description: '要审查的 HTML 片段或完整文档；含 <style> 时同时检查全局断行 CSS。',
        },
        mode: {
          type: 'string',
          enum: ['audit', 'fix'],
          description: 'audit=只报告问题；fix=报告问题并返回插入 <wbr> 的修复版 HTML。',
        },
      },
      required: ['html'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'summary', 'issues', 'css', 'stats', 'fixedHtml'],
        properties: {
          ok: { type: 'boolean' },
          summary: { type: 'string' },
          fixedHtml: { type: 'string' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['severity', 'rule', 'where', 'message', 'suggestion'],
              properties: {
                severity: { type: 'string' },
                rule: { type: 'string' },
                where: { type: 'string' },
                message: { type: 'string' },
                suggestion: { type: 'string' },
              },
            },
          },
          css: {
            type: 'object',
            additionalProperties: false,
            required: [
              'hasStyle', 'keepAll', 'keepAllCoverage', 'keepAllWithOverflowWrap', 'lineBreakStrict',
              'overflowWrapNormal', 'textWrapPretty', 'nowrapBroad',
              'keepAllRules', 'nowrapRules', 'cssLength',
            ],
            properties: {
              hasStyle: { type: 'boolean' },
              keepAll: { type: 'boolean' },
              keepAllCoverage: { type: 'string', enum: ['trusted', 'partial', 'none'] },
              keepAllWithOverflowWrap: { type: 'boolean' },
              lineBreakStrict: { type: 'boolean' },
              overflowWrapNormal: { type: 'boolean' },
              textWrapPretty: { type: 'boolean' },
              nowrapBroad: { type: 'boolean' },
              keepAllRules: { type: 'number' },
              nowrapRules: { type: 'number' },
              cssLength: { type: 'number' },
            },
          },
          stats: {
            type: 'object',
            additionalProperties: false,
            required: ['elements', 'cjkElements', 'wbrs', 'breaks', 'insertedWbr'],
            properties: {
              elements: { type: 'number' },
              cjkElements: { type: 'number' },
              wbrs: { type: 'number' },
              breaks: { type: 'number' },
              insertedWbr: { type: 'number' },
            },
          },
          insertions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['char', 'context'],
              properties: {
                char: { type: 'string' },
                context: { type: 'string' },
              },
            },
          },
        },
      },
      render(args, value) {
        const sevLabel = { error: '🔴 错误', warn: '🟡 警告', info: '🔵 提示' }
        const lines = []
        lines.push((value.ok ? '✅ ' : '❌ ') + value.summary)
        lines.push('')
        for (const issue of value.issues) {
          lines.push((sevLabel[issue.severity] || issue.severity) + ' [' + issue.rule + '] ' + issue.where)
          lines.push('    ' + issue.message)
          if (issue.suggestion) lines.push('    ↳ ' + issue.suggestion)
        }
        if (value.fixedHtml) {
          lines.push('')
          lines.push('修复后的 HTML：')
          lines.push('```html')
          lines.push(value.fixedHtml)
          lines.push('```')
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        const mode = args.mode === 'fix' ? 'fix' : 'audit'
        return auditHtml(args.html, { mode, config: engineConfig })
      } catch (error) {
        return {
          ok: false,
          summary: '引擎执行出错：' + (error && error.message ? error.message : String(error)),
          issues: [],
          css: EMPTY_CSS,
          stats: EMPTY_STATS,
          fixedHtml: '',
        }
      }
    },
  })
}
