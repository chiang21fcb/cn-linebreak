'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const BIN = path.join(__dirname, '..', 'bin', 'cn-linebreak.js')

function run(args, input) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    input: input === undefined ? '' : input,
    encoding: 'utf8',
  })
  return { code: res.status, stdout: res.stdout, stderr: res.stderr }
}

function tmpFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnlb-'))
  const file = path.join(dir, name)
  fs.writeFileSync(file, content, 'utf8')
  return file
}

test('--version prints version and exits 0', () => {
  const { code, stdout } = run(['--version'])
  assert.equal(code, 0)
  assert.match(stdout, /^cn-linebreak v\d+\.\d+\.\d+/)
})

test('--help prints usage and exits 0', () => {
  const { code, stderr } = run(['--help'])
  assert.equal(code, 0)
  assert.match(stderr, /用法/)
})

test('unknown flag exits 2', () => {
  const { code, stderr } = run(['--nope'])
  assert.equal(code, 2)
  assert.match(stderr, /未知选项/)
})

test('missing input file exits 3', () => {
  const { code, stderr } = run(['./definitely-missing.html'])
  assert.equal(code, 3)
  assert.match(stderr, /无法读取输入/)
})

test('audit with errors exits 1', () => {
  const file = tmpFile('bad.html', '<style>p { color: red }</style><h2>三种扩展，<br>子。</h2>')
  const { code, stdout } = run([file])
  assert.equal(code, 1)
  assert.match(stdout, /孤字行/)
})

test('clean audit exits 0', () => {
  const file = tmpFile('good.html',
    '<style>:where(h1, h2, p) { line-break: strict; word-break: keep-all; }</style>' +
    '<h2>三种扩展，<br>三种自由。</h2>')
  const { code } = run([file])
  assert.equal(code, 0)
})

test('--strict turns warnings into exit 1', () => {
  const file = tmpFile('warn.html', '<p>这是一段比较长的中文演示文案，用来验证没有任何换行点的时候是否会给出提示。</p>')
  const relaxed = run([file])
  assert.equal(relaxed.code, 0)
  const strict = run(['--strict', file])
  assert.equal(strict.code, 1)
})

test('--fix writes HTML to stdout and summary to stderr', () => {
  const file = tmpFile('fix.html', '<p>读产品手册，提取事实，输出文档。</p>')
  const { code, stdout, stderr } = run(['--fix', file])
  assert.equal(code, 0)
  assert.ok(stdout.includes('手册，<wbr>提取'))
  assert.ok(!stdout.includes('修复'))
  assert.match(stderr, /修复后复审/)
})

test('--json outputs a parseable report', () => {
  const file = tmpFile('j.html', '<p>一段中文文案。</p>')
  const { code, stdout } = run(['--json', file])
  assert.equal(code, 0)
  const report = JSON.parse(stdout)
  assert.equal(typeof report.ok, 'boolean')
  assert.ok(Array.isArray(report.issues))
  assert.ok(report.stats.elements >= 1)
})

test('stdin input behaves like a file', () => {
  const { code, stdout } = run([], '<style>:where(p) { word-break: keep-all }</style><p>读产品手册，提取事实。</p>')
  assert.equal(code, 0)
  const { code: badCode } = run([], '<h2>三种扩展，<br>子。</h2>')
  assert.equal(badCode, 1)
})

test('--config loads protected phrases and config options', () => {
  const cfg = tmpFile('cn-linebreak.config.json',
    JSON.stringify({ protectedPhrases: ['产品培训专员'], minCjkLength: 20 }))
  const html = '<p>产品培训专员，上岗。</p>'
  const { code, stdout } = run(['--config', cfg, '--fix'], html)
  assert.equal(code, 0)
  assert.ok(stdout.includes('产品培训专员，<wbr>上岗。'))
  assert.ok(!stdout.includes('专员<wbr>'))
})

test('- is accepted as stdin alias', () => {
  const { code, stdout } = run(['-'], '<p>读产品手册，提取事实。</p>')
  assert.equal(code, 0)
  assert.match(stdout, /元素/)
})

test('--output writes the result to a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnlb-out-'))
  const inFile = path.join(dir, 'in.html')
  const outFile = path.join(dir, 'fixed.html')
  fs.writeFileSync(inFile, '<p>读产品手册，提取事实，输出文档。</p>', 'utf8')
  const { code, stdout, stderr } = run(['--fix', '--output', outFile, inFile])
  assert.equal(code, 0)
  assert.equal(stdout, '') // fix 模式 + --output：stdout 保持干净
  assert.match(stderr, /已写入/)
  const written = fs.readFileSync(outFile, 'utf8')
  assert.ok(written.includes('手册，<wbr>提取'))
})

test('--output in audit mode writes a text report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnlb-out2-'))
  const inFile = path.join(dir, 'in.html')
  const outFile = path.join(dir, 'report.txt')
  fs.writeFileSync(inFile, '<p>一段中文文案。</p>', 'utf8')
  const { code } = run(['--output', outFile, inFile])
  assert.equal(code, 0)
  const report = fs.readFileSync(outFile, 'utf8')
  assert.match(report, /元素/)
})

test('unreadable --config exits 3', () => {
  const { code } = run(['--config', './no-such-config.json', '-'])
  assert.equal(code, 3)
})
