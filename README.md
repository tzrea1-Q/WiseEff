# WiseEff

WiseEff（智效）是一个本地运行的前端原型项目，用于演示 AI 辅助的企业业务效率平台。当前项目基于 Vite、React、TypeScript 构建，采用单页应用形态，通过 mock 数据和交互状态展示参数管理、日志分析、参数调试等业务场景。

## 环境要求

- Node.js 22 LTS，或其它满足 Vite 7 要求的 Node.js 版本
- npm 11，或兼容的 npm 版本

Vite 7 要求 Node.js `^20.19.0 || >=22.12.0`。仓库中提供了 `.nvmrc`，推荐新开发机器使用 Node 22。

## 快速启动

```bash
npm ci
npm run dev
```

开发服务绑定到 `127.0.0.1`。启动后 Vite 会在终端输出实际访问地址，通常是：

```text
http://127.0.0.1:5173/
```

## 常用命令

```bash
npm run dev
```

启动本地 Vite 开发服务。

```bash
npm test
```

运行一次 Vitest 测试套件。

```bash
npm run build
```

执行 TypeScript 项目检查，并将生产构建产物输出到 `dist/`。

```bash
npm run preview
```

在执行 `npm run build` 后，本地预览生产构建结果。

## 项目结构

```text
src/
  App.tsx                         原型主界面和交互逻辑
  styles.css                      应用样式
  mockData.ts                     mock 业务数据
  appConfig.ts                    导航和应用配置
  powerManagementConfig.ts        电源管理配置辅助逻辑
  config/power-management.json    可编辑的原型配置数据
  test/setup.ts                   Vitest DOM 测试初始化

PRD.md                            产品需求和原型范围说明
stitch_ai_driven_business_synergy_platform/
                                  设计参考导出文件和页面截图
```

### 项目参数管理后台（/parameter-admin）

管理员专用工作台：

- **参数库治理**：搜索、风险 / 模块 / 覆盖多维过滤、按模块分组折叠、URL 可分享。
- **“孤儿参数”视角**：列出未被任何项目使用的参数，便于清理。
- **共享定义表单**：`RiskPicker` 色标、`推荐值 ⓘ 对所有项目生效` 提示、范围 min/max 拆分、参数名 snake_case + 重名校验。
- **项目值矩阵**：单位就近 suffix、越界红边、偏差百分比色标、**只读 `updatedAt`** 自动更新。
- **脏态徽章 + 导出 ▾**：`[● N 处未导出]` 按需出现；导出时弹 diff 摘要对话框；`beforeunload` 守护意外关标签页。
- **删除二次确认 + 10s Undo Toast**：统一 `UndoableToast` 通道。
- **Agent 联动**：`扫描孤儿参数` / `生成清理建议` 已接通；`预审导入风险` / `汇总本周审计` 占位（等 m2 审计抽屉与导入向导）。
- **数据契约新增**：`User[]` 8 人、`AuditEvent.kind` 13 档、`UndoEntry` 单条栈、`Role.capabilities` 四档能力。

## 新机器配置流程

1. 克隆本仓库。
2. 使用 Node 22，或安装满足 Vite 7 要求的 Node.js 版本。
3. 在仓库根目录执行 `npm ci`。
4. 执行 `npm test` 和 `npm run build` 验证环境。
5. 执行 `npm run dev`，打开终端输出的本地访问地址。

当前原型不依赖外部 API key、后端服务或数据库。

产品化边界规划见 docs/productization-api-contract.md。该文档描述后续接入后端、数据库、设备网关和真实 Agent 时的前端契约方向。

## 仓库规范

`node_modules/`、`dist/`、本地开发日志、Codex/Superpowers 临时状态、视觉 QA 截图等生成内容不会提交到 Git。请提交源码、配置、测试、产品/设计文档和 lockfile。
