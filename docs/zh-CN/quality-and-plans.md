# 质量门禁与计划治理

WiseEff 的交付规则是：没有新鲜验证证据，不宣称完成。详细英文来源见 [QUALITY_SCORE.md](../QUALITY_SCORE.md)、[PLANS.md](../PLANS.md) 和 [testing-strategy.md](../design-docs/testing-strategy.md)。

## 常用验证命令

安装依赖：

```bash
npm ci
```

前端和后端单元/服务测试：

```bash
npm test
npm run test:server
npm run test:all
```

构建：

```bash
npm run build
```

文档治理：

```bash
npm run docs:check
```

OpenAPI 合同：

```bash
npm run contract:check
```

API-mode E2E：

```bash
npm run test:e2e
```

阶段门禁：

```bash
npm run test:m1
npm run test:m2
npm run test:m3
npm run test:m3-5
npm run test:m4
npm run smoke:m5
npm run test:m5
```

## 环境污染注意事项

如果 `.env` 中设置了：

```text
VITE_WISEEFF_RUNTIME_MODE=api
```

前端组件单测可能会意外进入 API mode。跑前端单测时可以临时覆盖：

```bash
VITE_WISEEFF_RUNTIME_MODE=mock npm test
```

PowerShell 示例：

```powershell
$env:VITE_WISEEFF_RUNTIME_MODE="mock"; npm test
```

## 计划文件规则

执行计划是仓库的一等文档：

- active 计划放在 `docs/exec-plans/active/`。
- completed 计划放在 `docs/exec-plans/completed/`。
- 技术债放在 `docs/exec-plans/tech-debt-tracker.md`。

每个 active plan，除了 `development-roadmap.md`，都必须包含：

- `## Documentation Impact Matrix`
- `## Documentation Update Gate`

`npm run docs:check` 会检查这两个 section。

## 文档更新规则

当变更影响开发者需要理解的内容时，文档必须随代码一起更新。典型范围：

- 架构和模块边界。
- runtime mode 和环境变量。
- API 合同。
- 安全和权限。
- 审计和可靠性。
- 测试门禁和验收口径。
- 计划治理。

中文开发者文档也进入治理范围。后续如果改动上述内容，应该同步更新 `docs/zh-CN/` 中对应页面，或者在计划/PR 中说明为什么无需更新中文文档。

## 完成口径

不要把以下事项说成已完成：

- 没有运行过的测试。
- 仅本地 skip 的 smoke。
- 未跑过的 HDC device-lab。
- 未跑过的 backup/restore。
- 未跑过的 rollback rehearsal。
- 未验证的 live provider 行为。

可以如实说：

- 哪些命令通过。
- 哪些命令失败。
- 哪些 gate blocked。
- 哪些依赖需要用户或外部环境提供。
