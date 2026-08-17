#!/usr/bin/env node
'use strict'

/**
 * cn-linebreak CLI
 *
 *   cn-linebreak <file.html>         审查一个 HTML 文件
 *   cn-linebreak --fix <file.html>   审查并把修复后的 HTML 打印到 stdout
 *   cn-linebreak --json <file.html>  输出完整 JSON 报告
 *   cat page.html | cn-linebreak     从 stdin 读取
 */

const fs = require('fs')
const path = require('path')
const { auditHtml } = require('../src/engine')

const args = process.argv.slice(2)

function usage() {
  console.error(
    '用法: cn-linebreak [--fix] [--json] <file.html>\n' +
    '      cat page.html | cn-linebreak [--fix] [--json]\n' +
    '选项:\n' +
    '  --fix   审查并在 stdout 输出修复后的 HTML\n' +
    '  --json  输出完整 JSON 报告（含 issues/css/stats）'
  )
  process.exit(2)
}

function main() {
  let fix = false
  let json = false
  let file = null

  for (const a of args) {
    if (a === '--fix') fix = true
    else if (a === '--json') json = true
    else if (a.startsWith('-')) usage()
    else if (file === null) file = a
    else usage()
  }

  const html = file === null
    ? fs.readFileSync(0, 'utf8')
    : fs.readFileSync(path.resolve(file), 'utf8')

  const report = auditHtml(html, { mode: fix ? 'fix' : 'audit' })

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    return
  }

  if (fix) {
    process.stdout.write(report.fixedHtml)
    return
  }

  const label = report.ok ? '✓' : '✗'
  console.log(`${label} ${report.summary}`)
  console.log(`  元素 ${report.stats.elements} 个（含中文 ${report.stats.cjkElements} 个），` +
    `<wbr> ${report.stats.wbrs} 个，<br> ${report.stats.breaks} 个`)
  console.log('')
  if (report.issues.length === 0) {
    console.log('  无问题。')
    return
  }
  for (const issue of report.issues) {
    const sev = issue.severity === 'error' ? '错误' : issue.severity === 'warn' ? '警告' : '提示'
    console.log(`  [${sev}] ${issue.where} ${issue.message}`)
    if (issue.suggestion) console.log(`        建议: ${issue.suggestion}`)
  }
}

main()
