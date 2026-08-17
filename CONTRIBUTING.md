# Contributing

感谢对 `cn-linebreak` 的关注！本项目遵循《[中文网页文案断行修复指南](docs/GUIDE.md)》与
《[更新建议与规则路线图](docs/RULES.md)》。欢迎 Issue、PR 与插件收录。

## 开发环境

- Node.js ≥ 18（CI 覆盖 18 / 20 / 22）
- 零依赖：引擎与 CLI 不引入任何运行时依赖

## 本地开发

```bash
npm test                 # 运行全部测试（node --test）
node bin/cn-linebreak.js demo.html   # 手动试用
npm pack --dry-run       # 检查发布内容
```

## 提交规范

- 保持零依赖与 CommonJS（`plugin.mjs` 是唯一的 ESM 文件，作为 DSH 插件入口）。
- 引擎改动必须同时满足：
  - 新增/修改行为有对应测试；
  - 修复 HTML 扫描相关改动需覆盖：void elements、`.no-break` 嵌套、行内标签末尾标点、
    `script/style/pre/code` 内容不被触碰、HTML 注释、大写标签、不完整 HTML；
  - 规则类改动需在 issue 或 PR 描述中注明规则来源（CLReq / GB-T 15834 / UAX #14 / 项目词典）。
- 语义化提交信息（feat / fix / docs / test / chore …）。

## DSH 插件包注意事项

- `dsh.bundle` 指向 `cordis.patch.yml`，插件模块为 `plugin.mjs`（`cn-linebreak/plugin`）。
- **同步规则**：`src/engine.js` 是唯一引擎来源；DSH 动态会话插件（`cordis_define`）与
  `plugin.mjs` 都以内联/引用方式使用它。修改引擎后，若仓库内的动态插件有内联副本，需同步更新。
- 提交到 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 前，
  仓库需满足：声明 `dsh.bundle`、≥1 天且 ≥10 commits、带 `dsh-plugin` topic。

## 路线图

见 [docs/RULES.md](docs/RULES.md) §13：v0.1.1（公开体验）→ v0.2.0（规则配置化）→
v0.3.0（候选评分）→ v0.4.0（真实渲染审查）。优先做确定性高、成本低的部分，保持默认零依赖。
