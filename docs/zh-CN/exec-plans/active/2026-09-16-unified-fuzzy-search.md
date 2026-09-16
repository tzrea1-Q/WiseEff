# 统一 SearchField 与模糊搜索

> English: [English](../../../exec-plans/active/2026-09-16-unified-fuzzy-search.md)

## 目标

用两层解耦的公共能力，替换各页面重复的搜索框标记和 `toLowerCase().includes(...)` 过滤：

1. `SearchField`：项目里唯一的搜索输入外观。
2. 仓库自研、与领域类型无关的模糊搜索内核，外加明确的 Search Profile。

不要把业务过滤写进输入组件。不要把服务端检索或原文查找错误替换成“只搜当前页”的本地 fuzzy。

## Git 与 PR

- Scratch 分支：从最新 `origin/main`（`a730c827b`）拉出 `feat/unified-fuzzy-search`
- 风险等级：R2（界面流程 + 领域搜索行为）
- 停止边界：定向 Vitest、`npm run typecheck`、`npm run build`、`npm run lint`、`npm run ui:check`、`npm run docs:check`，以及 playwright-cli 浏览器验收。实现代理不得开 GitHub PR。
- 证据：搜索内核单测、SearchField 组件测试、迁移页测试、1440×900 / 768×1024 / 390×844 浏览器检查

## 公共缝

| 层 | 位置 | 职责 |
| --- | --- | --- |
| UI 原语 | `src/components/common/SearchField.tsx` | 值、外观、清除、ARIA、键盘透传 |
| 搜索内核 | `src/lib/search/` | 规范化、匹配、打分、过滤、树祖先保留 |
| Profile | `src/lib/search/profiles.ts` | 各业务类型的字段与权重 |
| 页面 | 现有消费者 | ColumnFilter、排序、分页、服务端、原文查找 |

不引入 Fuse.js 或其他搜索库。本地列表规模是数百到数千行；工程标识符标点和中文子串比编辑距离更重要；确定性内核更便宜、可测。

## 架构

```text
SearchField  ── 仅 UI ──► 父组件状态 (value / onValueChange)
                                │
                                ├─ 本地结构化 ──► searchItems(items, query, profile)
                                ├─ 树            ──► filterTree / filterHierarchicalList
                                ├─ 服务端 / 仓库 ──► 现有 q / repository.search / 提交
                                └─ 原文查找      ──► 现有子串 + 下一项/上一项
```

每个查询词对每个字段值的匹配优先级：

1. 精确（规范化或压缩标识符）
2. 字段前缀
3. 分词前缀（按空白和 `_-/:@.` 切开）
4. 子串
5. 压缩标识符子串（`currentlimit` 命中 `current_limit`，词长 ≥ 3）
6. 有序子序列，仅标识符，词长 ≥ 4

查询词（按空白切开）之间是 AND，可以落在不同字段。字段之间是 OR。空查询返回全部且保持原顺序。同分保留原下标。默认 `rank: false`，尊重页面排序；排序按分数是可选的。

第一版不做拼音，不做 Levenshtein。

## 检查点

| CP | 范围 |
| --- | --- |
| CP-S0 | Inventory + 本计划 |
| CP-S1 | SearchField + 搜索内核 + 纯函数/组件测试 |
| CP-S2 | 试点：ParametersTable / ParametersPage、DebuggingPage、NodeDebuggingPage、ParameterSpecLibrary、SpecReviewQueue |
| CP-S3 | 其余本地结构化搜索（见英文页矩阵） |
| CP-S4 | 服务端/仓库与原文查找：Catalog、Audit、Knowledge、日志正文、DTS 源码查找、工作台统一搜索、知识库参数引用检索 |
| CP-S5 | 删除无消费者的搜索框 CSS 和页面级 includes 助手 |

完整 migration matrix、数据缺口、UX 与验证命令见英文页。`ParameterSpecSummary` 列表没有 description；本轮不 N+1，也不改 listSpecs 契约。活的 Catalog 页已在服务端检索 description / documentation。

## 文档影响矩阵

| 区域 | 动作 | 路径 |
| --- | --- | --- |
| 仓库地图 | 更新 | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md` |
| 计划文档 | 更新 | `docs/PLANS.md`、`docs/zh-CN/PLANS.md`、本计划 |
| 设计系统 | 更新 | `docs/design-docs/ui-design-system.md`、`docs/zh-CN/design-docs/ui-design-system.md` |
| 产品规格 | 不变 | 搜索是交互原语，不是新工作流 |
| 架构 | 不变 | 无新运行时端口 |
| 质量 / 测试 | CP-S5 核验 verification-matrix | |
| 安全 / 生成物 | 不变 | |

## 文档更新门禁

上表所有“更新”行必须在本次变更中完成。完成前运行 `npm run docs:check`。
