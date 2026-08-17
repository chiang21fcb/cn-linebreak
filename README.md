# cn-linebreak

中文网页文案断行审查与修复工具。把《[中文网页文案断行修复指南](docs/GUIDE.md)》中的规则变成可执行检查：

- **审查**：给定 HTML，自动发现孤字行、"一个字+标点"单独成行、标点占行首、缺少 `word-break: keep-all`、全局 `white-space: nowrap`、过长 `.no-break`、长文案零换行点等问题。
- **修复**：在 `，。；：、` 等自然停顿处自动插入 `<wbr>`（跳过 `script/style/pre/code` 与 `.no-break` 保护区域），产出修复版 HTML 供人工复核。

> 核心原则（摘自指南）：中文断行不应由浏览器按单字随机决定；应先划分语义单元，再明确"可断、必断、不可断"三类边界。`<wbr>` = 可断，`<br>` = 必断，`.no-break` = 不可断。

零依赖，纯 JavaScript（CommonJS），Node ≥ 18。

## 快速开始

```bash
# 审查一个文件
npx cn-linebreak page.html

# 审查并输出修复版 HTML（stdout）
npx cn-linebreak --fix page.html > page.fixed.html

# 完整 JSON 报告
npx cn-linebreak --json page.html

# 从 stdin 读取
cat page.html | npx cn-linebreak
```

## CLI

```
cn-linebreak [--fix] [--json] <file.html>
cat page.html | cn-linebreak [--fix] [--json]
```

| 选项 | 作用 |
| --- | --- |
| `--fix` | 审查并在 stdout 输出自动插入 `<wbr>` 后的 HTML |
| `--json` | 输出完整 JSON 报告（`ok` / `summary` / `issues` / `css` / `stats`） |

## API

```js
const { auditHtml } = require('cn-linebreak')

const report = auditHtml('<p>读产品手册，提取事实，输出文档。</p>', { mode: 'fix' })

console.log(report.ok)        // false（有错误时）
console.log(report.summary)   // 一句话结论
console.log(report.issues)    // [{ severity, rule, where, message, suggestion }]
console.log(report.fixedHtml) // 修复版 HTML（仅 mode: 'fix' 时）
```

低层函数也可单独使用：

- `insertWbr(html)` — 仅在标点后插入 `<wbr>`，不改其他内容
- `auditCss(html)` — 检查 `<style>` 中的 keep-all / line-break: strict / nowrap
- `collectElements(html)` — 收集可审查的文本元素及按 `<br>` 切分的行

## 检查规则清单

| 规则 | 严重度 | 说明 |
| --- | --- | --- |
| `missing-keep-all` | 错误 | `<style>` 中缺少 `word-break: keep-all` |
| `broad-nowrap` | 错误 | 全局选择器（`*`/`html`/`body`…）上使用 `white-space: nowrap` |
| `orphan-line` | 错误/警告 | `<br>` 产生的整行只有一个汉字 + 句号（孤字行） |
| `line-start-punctuation` | 错误 | 某行以 `，。；：、！？` 开头 |
| `missing-css-guard` | 警告 | 页面没有 `<style>` 全局断行保护 |
| `missing-line-break-strict` | 警告 | 缺少 `line-break: strict` |
| `no-breakpoint` | 警告 | 较长中文文案（≥16 汉字）没有任何 `<wbr>`/`<br>` 换行点 |
| `overlong-no-break` | 警告 | `.no-break` 内内容过长（>14 汉字），窄屏可能溢出 |
| `leading-punctuation` | 警告 | 元素文本以标点开头（可能是上一处断行挤下来的） |
| `text-wrap-only` | 提示 | 仅依赖 `text-wrap: pretty/balance`，浏览器兼容性不稳定 |
| `fix-applied` | 提示 | 修复模式下插入了多少处 `<wbr>` |

## 为什么不用纯 CSS 解决

`text-wrap: pretty`、`text-wrap: balance`、`word-break: auto-phrase` 都可以辅助排版，但不同浏览器、版本和字号下结果不稳定。对于演示稿、落地页、数据大屏这类对断句节奏要求高的页面，应由文案作者明确指定换行点——这正是本工具帮你标注的。

## 局限与人工复核

- 静态检查无法感知真实渲染宽度，"孤字"等布局问题只能通过 `<br>` 显式断行来可靠识别；其余为启发式提示。
- `--fix` 只做保守的机械插入：任何语义边界（产品名、专有名词、引号内完整名称）都需要人工复查。
- 详见 [docs/GUIDE.md](docs/GUIDE.md) 中的完整验收清单。

## 开发

```bash
npm test          # node --test
```

## License

MIT © chiang21fcb
