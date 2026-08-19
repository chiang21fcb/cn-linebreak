# cn-linebreak

[![CI](https://github.com/chiang21fcb/cn-linebreak/actions/workflows/ci.yml/badge.svg)](https://github.com/chiang21fcb/cn-linebreak/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/chiang21fcb/cn-linebreak)](https://github.com/chiang21fcb/cn-linebreak/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

中文网页文案断行审查与修复工具。把《[中文网页文案断行修复指南](docs/GUIDE.md)》中的规则变成可执行检查：

- **审查**：检查**显式断行错误及高风险写法**——由 `<br>` 形成的孤字行、"一个字+标点"单独成行、行首/行尾出现禁则标点、缺少 `word-break: keep-all`、覆盖文本元素的全局 `white-space: nowrap`、过长 `.no-break`、长文案零换行点、保护词被换行拆开等。
- **修复**：在 `，。；：、` 等自然停顿处自动插入 `<wbr>`（跳过 `script/style/pre/code/textarea/title` 与 `.no-break` 保护区域、保护词典命中位置），产出修复版 HTML 供人工复核。
- **DSH 插件**：同一个包也是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 标准插件包（`dsh.bundle`），安装后代理可直接调用 `cn_linebreak_audit` 工具。

> **能力边界**：本工具是**静态**审查器，只能看到 HTML 中已明确存在的 `<br>`/`<wbr>` 和文本/CSS 结构。它不能知道浏览器按真实字号、容器宽度渲染后的实际换行结果——"识别真实渲染后的孤字行"与"识别浏览器自动切开的词组"属于路线图 v0.4.0 的渲染模式能力，详见 [docs/RULES.md](docs/RULES.md)。

> 核心原则（摘自指南）：中文断行不应由浏览器按单字随机决定；应先划分语义单元，再明确"可断、必断、不可断"三类边界。`<wbr>` = 可断，`<br>` = 必断，`.no-break` = 不可断。

## Overview (English)

cn-linebreak is a static HTML auditor for Chinese line-breaking. It checks
explicit-`<br>` orphan lines, `word-break: keep-all` CSS coverage, CJK
line-start/line-end punctuation rules (CLReq / GB-T 15834), protected-phrase
splits, and long copy with no break points. In `--fix` mode it inserts `<wbr>`
at natural punctuation boundaries for human review. The same package is a
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin
exposing a `cn_linebreak_audit` tool.

*Static-only: it cannot see the browser's rendered line boxes. Detecting real
rendered orphan lines is roadmap v0.4.*

零依赖，纯 JavaScript（CommonJS + 一个 ESM 插件入口），Node ≥ 18。

## 快速开始

```bash
# 审查一个文件
npx cn-linebreak page.html

# 审查并输出修复版 HTML（stdout），摘要走 stderr
npx cn-linebreak --fix page.html > page.fixed.html

# 完整 JSON 报告
npx cn-linebreak --json page.html

# 从 stdin 读取
cat page.html | npx cn-linebreak
```

尚未发布到 npm 时，可用 git 直装：

```bash
npx github:chiang21fcb/cn-linebreak page.html
```

## CLI

```
cn-linebreak [options] [<file.html> | -]
cat page.html | cn-linebreak [options]
```

| 选项 | 作用 |
| --- | --- |
| `--fix` | 审查并把修复后 HTML 输出到 stdout；审查摘要与修复后复审结果输出到 stderr（不污染重定向） |
| `--json` | 输出完整 JSON 报告（`ok` / `summary` / `issues` / `css` / `stats` / `fixedHtml`） |
| `--output <file>` | 把结果写入文件（`--fix` 写修复后 HTML；否则写报告），stdout 保持干净 |
| `--strict` | 警告也视为失败（影响退出码） |
| `--config <file>` | 读取 JSON 配置（见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)） |
| `--help` / `--version` | 帮助 / 版本 |

退出码：`0`=通过，`1`=发现错误（`--strict` 时含警告），`2`=参数错误，`3`=读取/解析失败。

## API

```js
const { auditHtml } = require('cn-linebreak')

const report = auditHtml('<p>读产品手册，提取事实，输出文档。</p>', { mode: 'fix' })

console.log(report.ok)        // false（有错误时）
console.log(report.summary)   // 一句话结论
console.log(report.issues)    // [{ severity, rule, where, message, suggestion }]
console.log(report.fixedHtml) // 修复版 HTML（仅 mode: 'fix' 时）
```

低层函数：`insertWbr(html, { config })`、`auditCss(html)`、`collectElements(html)`、`normalizeConfig(config)`、`buildProtectedSpans(html, phrases)`。

## 在 DeepSeek Harness (DSH) 中使用

本包声明了 `dsh.bundle`，是一个标准 DSH 插件包：

```bash
dsh plugin --profile <name> add cn-linebreak          # 从 npm
# 或从源码/GitHub：
dsh plugin --profile <name> add github:chiang21fcb/cn-linebreak
```

安装后插件注册工具 **`cn_linebreak_audit`**（参数 `html` + `mode: audit|fix`），代理可直接调用。可选的插件配置（通过 profile 的 `cordis.patch.yml` 覆盖 `cn-linebreak` 行的 `config.engine`）：

```yaml
- id: cn-linebreak
  name: cn-linebreak/plugin
  config:
    engine:
      protectedPhrases: ["产品培训专员", "cordis.yml"]
      minCjkLength: 16
```

## 检查规则清单

| 规则 | 严重度 | 说明 |
| --- | --- | --- |
| `missing-keep-all` | 错误 | `<style>` 中没有任何 `word-break: keep-all` |
| `keep-all-partial` | 警告 | 有 keep-all，但其选择器未覆盖 `h1/h2/p` 等文本元素 |
| `broad-nowrap` | 错误 | `white-space: nowrap` 覆盖文本元素（`.no-break` 作用域不算） |
| `orphan-line` | 错误/警告 | `<br>` 产生的整行只有一两个字 + 句号（孤字行） |
| `line-start-punctuation` | 错误 | 行首出现闭式标点（CLReq/GB-T 15834 禁则） |
| `line-end-punctuation` | 错误 | 行尾出现开式标点（CLReq/GB-T 15834 禁则） |
| `protected-phrase-split` | 错误 | 配置的保护词被 `<br>` 拆开 |
| `missing-css-guard` | 警告 | 页面没有 `<style>` 全局断行保护 |
| `missing-line-break-strict` | 警告 | 缺少 `line-break: strict` |
| `no-breakpoint` | 警告 | 较长中文文案（默认 ≥16 汉字）没有任何 `<wbr>`/`<br>` 换行点 |
| `overlong-no-break` | 警告 | `.no-break` 内内容过长（>14 汉字） |
| `leading-punctuation` | 警告 | 元素文本以标点开头（可能是上一处断行挤下来的） |
| `text-wrap-only` | 提示 | 仅依赖 `text-wrap: pretty/balance`，浏览器兼容性不稳定 |
| `fix-applied` | 提示 | 修复模式下插入了多少处 `<wbr>` |

## 为什么不用纯 CSS 解决

`text-wrap: pretty`、`text-wrap: balance`、`word-break: auto-phrase` 都可以辅助排版，但不同浏览器、版本和字号下结果不稳定。对于演示稿、落地页、数据大屏这类对断句节奏要求高的页面，应由文案作者明确指定换行点——这正是本工具帮你标注的。

## 局限与人工复核

- 静态检查无法感知真实渲染宽度；"孤字"等布局问题只能通过显式 `<br>` 可靠识别，其余为启发式提示。
- `--fix` 只做保守的机械插入：任何语义边界（产品名、专有名词、引号内完整名称）都需要人工复查；可通过 `--config` 的保护词典减少误插。
- 规则来源与演进路线见 [docs/SOURCES.md](docs/SOURCES.md)、[docs/RULES.md](docs/RULES.md)；配置项说明见 [docs/CONFIGURATION.md](docs/CONFIGURATION.md)。

## 开发

```bash
npm test          # node --test（54 个用例）
npm pack --dry-run
```

## License

MIT © chiang21fcb
