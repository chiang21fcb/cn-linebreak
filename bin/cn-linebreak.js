#!/usr/bin/env node
'use strict'

/**
 * cn-linebreak CLI (v0.1.1)
 *
 *   cn-linebreak [options] <file.html>    审查一个 HTML 文件
 *   cat page.html | cn-linebreak [options]  从 stdin 读取
 *
 * Options:
 *   --diff            在 --fix 模式下额外输出每处 <wbr> 插入位置与上下文（stderr）
 *   --fix             审查并在 stdout 输出修复后的 HTML；审查摘要走 stderr
 *   --json            输出完整 JSON 报告（含 issues/css/stats/fixedHtml）
 *   --output <file>   把结果写入文件（--fix 写修复后 HTML；否则写报告），stdout 保持干净
 *   --strict          警告也视为失败（影响退出码）
 *   --config <file>   读取 JSON 配置（protectedPhrases / breakAfter / …）
 *   --help            显示帮助
 *   --version         显示版本
 *
 * Exit codes:
 *   0  未发现阻断问题
 *   1  发现审查错误（--strict 时警告也算）
 *   2  参数错误
 *   3  文件读取/解析失败
 */

const fs = require('fs')
const path = require('path')
const { auditHtml, normalizeConfig } = require('../src/engine')

function version() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function usage() {
  console.error(
    'cn-linebreak v' + version() + ' — 中文网页文案断行审查与修复工具\n' +
    '\n' +
    '用法: cn-linebreak [options] <file.html>\n' +
    '      cat page.html | cn-linebreak [options]\n' +
    '\n' +
    '选项:\n' +
    '  --diff             在 --fix 模式下额外输出每处 <wbr> 插入位置与上下文\n' +
    '  --fix              审查并输出修复后的 HTML 到 stdout（摘要走 stderr）\n' +
    '  --json             输出完整 JSON 报告\n' +
    '  --output <file>    把结果写入文件（--fix 写修复后 HTML；否则写报告）\n' +
    '  --strict           警告也计入失败（退出码 1）\n' +
    '  --config <file>    读取 JSON 配置文件\n' +
    '  --help             显示本帮助\n' +
    '  --version          显示版本号\n' +
    '\n' +
    '退出码: 0=通过 1=发现错误 2=参数错误 3=读取/解析失败'
  )
}

function parseArgs(args) {
  const opts = { fix: false, json: false, strict: false, config: null, output: null, diff: false, file: null }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--fix') opts.fix = true
    else if (a === '--diff') opts.diff = true
    else if (a === '--json') opts.json = true
    else if (a === '--strict') opts.strict = true
    else if (a === '--help' || a === '-h') { opts.help = true }
    else if (a === '--version' || a === '-v') { opts.version = true }
    else if (a === '--config') {
      const v = args[i + 1]
      if (!v || v.startsWith('--')) return { error: '--config 需要一个文件路径' }
      opts.config = v
      i += 1
    } else if (a === '--output' || a === '-o') {
      const v = args[i + 1]
      if (!v || v.startsWith('--')) return { error: '--output 需要一个文件路径' }
      opts.output = v
      i += 1
    } else if (a.startsWith('-') && a !== '-') {
      return { error: '未知选项: ' + a }
    } else if (opts.file === null) {
      opts.file = a
    } else {
      return { error: '只能指定一个输入文件' }
    }
  }
  return opts
}

function loadConfig(file) {
  if (!file) return {}
  try {
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw)
  } catch (error) {
    const err = new Error('无法读取配置文件 ' + file + ': ' + (error && error.message ? error.message : String(error)))
    err.code = 'CONFIG'
    throw err
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.error) {
    console.error('错误: ' + opts.error)
    usage()
    process.exit(2)
  }
  if (opts.help) {
    usage()
    process.exit(0)
  }
  if (opts.version) {
    console.log('cn-linebreak v' + version())
    process.exit(0)
  }

  let config
  try {
    config = normalizeConfig(loadConfig(opts.config))
  } catch (error) {
    console.error('错误: ' + error.message)
    process.exit(3)
  }
  if (opts.strict) config.strictWarnings = true

  // Read input (`-` means stdin)
  let html
  try {
    html = (opts.file === null || opts.file === '-')
      ? fs.readFileSync(0, 'utf8')
      : fs.readFileSync(path.resolve(opts.file), 'utf8')
  } catch (error) {
    console.error('错误: 无法读取输入: ' + (error && error.message ? error.message : String(error)))
    process.exit(3)
  }

  // Audit (and optionally fix)
  let report
  try {
    report = auditHtml(html, { mode: opts.fix ? 'fix' : 'audit', config })
  } catch (error) {
    console.error('错误: 解析失败: ' + (error && error.message ? error.message : String(error)))
    process.exit(3)
  }

  if (opts.fix) {
    // fix 模式：输出修复后 HTML（--output 写文件，否则写 stdout）；复审摘要走 stderr
    let after
    try {
      after = auditHtml(report.fixedHtml, { mode: 'audit', config })
    } catch {
      after = report
    }
    if (opts.output) {
      try {
        fs.writeFileSync(opts.output, report.fixedHtml)
        process.stderr.write('已写入 ' + opts.output + '\n')
      } catch (error) {
        console.error('错误: 无法写入 ' + opts.output + ': ' + (error && error.message ? error.message : String(error)))
        process.exit(3)
      }
    } else {
      process.stdout.write(report.fixedHtml)
    }
    printSummary(report, after, process.stderr)
    if (opts.diff && report.insertions && report.insertions.length > 0) {
      process.stderr.write('\n  插入了 ' + report.insertions.length + ' 处 <wbr>：\n')
      for (const ins of report.insertions) {
        process.stderr.write('    at "' + ins.context + '"\n')
      }
    }
    process.exitCode = exitCodeFor(after, config.strictWarnings)
    return
  }

  // audit 模式：报告写入 --output 文件（JSON 或文本），否则输出到 stdout
  if (opts.output) {
    const content = opts.json
      ? JSON.stringify(report, null, 2) + '\n'
      : renderTextReport(report, null)
    try {
      fs.writeFileSync(opts.output, content)
      process.stderr.write('已写入 ' + opts.output + '\n')
    } catch (error) {
      console.error('错误: 无法写入 ' + opts.output + ': ' + (error && error.message ? error.message : String(error)))
      process.exit(3)
    }
  } else if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    printSummary(report, null, process.stdout)
  }
  process.exitCode = exitCodeFor(report, config.strictWarnings)
}

function renderTextReport(report, after) {
  const chunks = []
  printSummary(report, after, { write(s) { chunks.push(s) } })
  return chunks.join('')
}

function exitCodeFor(report, strict) {
  const hasError = report.issues.some((i) => i.severity === 'error')
  const hasWarn = report.issues.some((i) => i.severity === 'warn')
  if (hasError) return 1
  if (strict && hasWarn) return 1
  return 0
}

function printSummary(report, after, stream) {
  const label = report.ok ? '✓' : '✗'
  stream.write(label + ' ' + report.summary + '\n')
  stream.write('  元素 ' + report.stats.elements + ' 个（含中文 ' + report.stats.cjkElements + ' 个），' +
    '<wbr> ' + report.stats.wbrs + ' 个，<br> ' + report.stats.breaks + ' 个\n')
  if (after) {
    stream.write('  —— 修复后复审: ' + (after.ok ? '✓ 通过' : '✗ ' + after.summary) + '\n')
  }
  stream.write('\n')
  if (report.issues.length === 0) {
    stream.write('  无问题。\n')
    return
  }
  for (const issue of report.issues) {
    const sev = issue.severity === 'error' ? '错误' : issue.severity === 'warn' ? '警告' : '提示'
    stream.write('  [' + sev + '] ' + issue.where + ' ' + issue.message + '\n')
    if (issue.suggestion) stream.write('        建议: ' + issue.suggestion + '\n')
  }
}

main()
