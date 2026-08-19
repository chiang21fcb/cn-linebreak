# Changelog

All notable changes to cn-linebreak are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/), versions follow
[SemVer](https://semver.org/lang/zh-CN/).

## [0.2.0] - 2026-08-17

### 新增（优化方案 Phase A）

- **breakAfter 默认值增加 ！？**（句末标点后亦可换行）（A3）
- **insertWbr：行内标签末尾标点的 `<wbr>` 改插在闭合链之后**，标记更干净
  （`<strong>第一步，</strong>第二步` → `<strong>第一步，</strong><wbr>第二步`）（A4）
- **新增 `--diff` / `insertions`**：列出每处 `<wbr>` 插入点上下文，便于人工复核（A5）
- **buildProtectedSpans 不再匹配标签属性内部**（A8）
- **README 加英文摘要**（A6）
- **补充测试**（行内闭合链、A5 insertions、保护词标签属性过滤、不匹配闭合标签、
  `！？` 默认断点等）（A7）
- **发布到 npm**（A1）

### 工程

- CLI：`--output <file>` / `-o`（`--fix` 写修复后 HTML 到文件，audit 写报告到文件）
- 测试：DSH 插件模块级测试（`test/plugin.test.mjs`，59 例）、
  UAX #14 `LineBreakTest` 代表性夹具（`test/fixtures/linebreak-test.txt`）
- 工程：GitHub Release 工作流（tag 自动打包 + 附 tarball）、`cn-linebreak.config.example.json`
- 文档：`docs/INSTALLATION.md`（真实 DSH profile 安装验证记录）
- README：CI / Release / License 徽章、英文摘要

## [0.1.1] - 2026-08-17

### 新增（v0.1.1：修正公开使用体验）

- CLI：`--help`、`--version`、`--strict`、`--config <file>`、`-`（stdin 别名）
- CLI 退出码约定：`0`=通过，`1`=发现错误（`--strict` 含警告），`2`=参数错误，`3`=读取/解析失败
- `--fix` 模式下 stdout 只输出修复后 HTML，审查摘要与"修复后复审"结果输出到 stderr
- 引擎：完整 HTML void elements（`area/base/br/col/embed/hr/img/input/link/meta/param/source/track/wbr`）
- 引擎：`.no-break` 与 `script/style/pre/…` 跳过区域按节点深度维护，支持同名标签嵌套与无引号 class
- 引擎：行内标签末尾的标点仍视为换行点（`<strong>第一步，</strong>第二步` 会插入 `<wbr>`）
- 引擎：CSS 选择器覆盖分析——`keep-all` 分为 `trusted/partial/none`；`.no-break` 作用域的 `nowrap` 不再误报为全局
- 引擎：CLReq / GB-T 15834 行首闭式标点、行尾开式标点禁则
- 引擎：保护词典（`protectedPhrases`）——插入 `<wbr>` 时跳过命中位置；审查时检测保护词被 `<br>` 拆开
- 引擎：可配置 `breakAfter`、`minCjkLength`、`minLastLineCjk`
- 测试：54 个用例（引擎 43 + CLI 11），覆盖路线图 §11 清单
- 工程：GitHub Actions CI（Node 18/20/22）、CHANGELOG、CONTRIBUTING、examples/
- DSH：标准插件包（`dsh.bundle` + `cordis.patch.yml` + `cn-linebreak/plugin` 入口）

### 修正

- README 能力边界：不再声称静态引擎能识别"浏览器渲染后的孤字行/词组被拆"，改为"检查显式断行错误及高风险写法"
- 修复 `node --test test/` 在 Windows 下的目录参数问题（改 `node --test`）

## [0.1.0] - 2026-08-17

- 首个公开版本：HTML 静态断行审查、CSS 断行保护检查、显式 `<br>` 孤字行检查、行首标点检查、
  长文案缺换行点检查、`.no-break` 过长检查、自动插入 `<wbr>`、CLI + CommonJS API + 测试
- 收录《中文网页文案断行修复指南》为 `docs/GUIDE.md`
