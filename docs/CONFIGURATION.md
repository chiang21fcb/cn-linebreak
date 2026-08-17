# 配置说明（Configuration）

CLI 通过 `--config <file>` 读取 JSON 配置；DSH 插件通过 profile 中 `cn-linebreak` 行的
`config.engine` 传入同一结构。

## 完整示例

```json
{
  "locale": "zh-CN",
  "selectors": [
    "h1",
    "h2",
    "p",
    ".card-body",
    ".step-body",
    "th",
    "td"
  ],
  "protectedPhrases": [
    "产品培训专员",
    "cordis.yml",
    "MEMORY.md"
  ],
  "breakAfter": "，。；：、",
  "minCjkLength": 16,
  "minLastLineCjk": 2,
  "strictWarnings": false
}
```

## 字段说明

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `locale` | string | `zh-CN` | 保留字段（未来按地区差异微调禁则字符集） |
| `selectors` | string[] | `[]` | 保留字段（未来限定审查目标元素） |
| `protectedPhrases` | string[] | `[]` | 保护词典：`<wbr>` 不落在这些词内部；词被 `<br>` 拆开时报错 |
| `breakAfter` | string | `，。；：、` | 修复模式在哪些标点后插入 `<wbr>`（按字符） |
| `minCjkLength` | number | `16` | 触发"零换行点"警告的最小汉字数 |
| `minLastLineCjk` | number | `2` | 短行警告阈值：末行汉字数 ≤ 该值且以句号结尾 → 警告 |
| `strictWarnings` | boolean | `false` | 警告计入失败（等同 CLI `--strict`） |

## 命令行覆盖

`--strict` 会覆盖配置中的 `strictWarnings` 为 `true`。其他字段仅在未显式传入时使用默认值。

## 保护词典说明

保护词按**原始 HTML 字符串**做子串匹配（词内不含标签时最可靠）；词被标签包裹时请改用
`.no-break` 容器。例如 `"产品培训专员"` 会阻止在词内插入 `<wbr>`，但如果源码是
`<b>产品培训专员</b>`，子串匹配不命中——此时用 `<span class="no-break">` 保护。
