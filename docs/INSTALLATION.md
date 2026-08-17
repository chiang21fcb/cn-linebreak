# DSH 安装验证（Installation Verification）

`cn-linebreak` 作为标准 DSH 插件包（`dsh.bundle`）在本机完成了真实安装验证，
记录如下，供 awesome-dsh-plugin 投稿前自查。

## 验证环境

- DSH 源码：`C:\Users\蒋宇翔\orca\projects\001\deepseek-harness`
- pnpm 11.7.0，Node 22
- DSH_HOME：`C:\Users\蒋宇翔\.dsh`

## 步骤与结果

### 1. 安装到测试 profile

```bash
pnpm -C <dsh-checkout> dsh plugin --profile cnlb-test add E:/dsh/cn-linebreak
```

结果：profile 初始化成功，依赖写入：

```json
{
  "dependencies": { "cn-linebreak": "link:E:/dsh/cn-linebreak" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "cn-linebreak"] } }
}
```

### 2. 组合配置挂载

```bash
pnpm -C <dsh-checkout> dsh --profile cnlb-test --dump-config
```

结果：输出中出现独立层 `# == cn-linebreak` 与行 `- id: cn-linebreak / name: cn-linebreak/plugin`。

### 3. 插件模块与工具执行

`test/plugin.test.mjs`（仓库内，`npm test` 自动运行）验证：

- 模块导出 cordis 契约 `name` / `inject: ['tools']` / `apply`；
- `apply(ctx)` 注册 `cn_linebreak_audit` 工具（参数 `html` 必填、`mode` 枚举 audit/fix）；
- 工具 `execute` 可真实完成审查与 `<wbr>` 修复；插件 `config.engine` 流入引擎；
- `render` 输出可读文本报告。

### 4. Profile 启动

`dsh --profile cnlb-test` 启动 60s+ 无任何插件加载错误（若 `plugin.mjs` import 失败会立即崩溃）。
挂起原因：新建 profile 未配置模型 provider，agent 循环等待输入——与插件无关。

## 结论

标准插件包可安装、可挂载、可执行。投稿前的剩余门槛仅为：

1. 仓库创建满 24 小时（2026-08-18 18:42 本地时间之后）；
2. 提交数 ≥ 10；
3. （推荐）发布 npm 或为 GitHub Release 附预构建 tarball，见 `.github/workflows/release.yml`。
