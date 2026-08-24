# 紧凑应用页脚实施计划

> English: [English](../../../exec-plans/completed/2026-08-24-compact-application-footer.md)

**状态：** 已于 2026-08-24 完成。实现与本地验证均已完成；由于 GitHub Actions 额度不可用，合入采用所有者批准的本地 CI 例外。

## 目标

在每个普通登录后页面底部增加一个低强调度页脚，让用户能够识别产品版权主体和构建版本、打开现有产品反馈对话框，并在部署已配置时访问外部联系方式。首页保留现有大型多栏页脚，只在其底部增加相同的紧凑信息与操作行。

页脚属于页面收尾内容，不属于常驻应用框架：它随页面滚动，不采用固定或粘性定位，也不得遮挡小泽、Toast、对话框或页面操作。

## 已锁定的产品决策

- 营销首页保留现有 `TemplateFooter`，只增加一行紧凑信息与操作，不再渲染第二个完整应用页脚。
- 所有由应用壳渲染的普通登录后路由统一显示共享应用页脚。权限拒绝和 `NoEntryPage` 仍在应用壳内，因此自动覆盖。
- 本地版权主体默认为 `雷泽（WiseEff）`；生产或自托管构建可以覆盖为真实公司法定名称。当前 Organization 显示名绝不能充当版权所有者。
- 首版显示 `© {当前年份} {版权主体}`、`版本 v{版本号}`、`问题反馈` 和可选的 `联系我们`。
- `问题反馈` 打开现有 `FeedbackDialog`，并携带当前路径和页面标题。该入口不改名为“联系我们”，因为表单只接收产品反馈分类，不承接一般咨询。
- 仅在配置合法外部联系地址时显示“联系我们”。显示文案固定；`https:` 在新标签页打开并带 `noopener noreferrer`，`mailto:` 交给系统邮件客户端。
- 联系地址为空或非法时不显示链接。开发环境输出只包含配置键名的简短警告；生产环境不向用户暴露配置细节。
- 桌面端左侧显示版权与版本，右侧显示操作；窄屏自然换成两行并保持左对齐。组件不用卡片，使用 token 化顶部细分隔线、弱化文字和低强调链接。
- 本次不增加隐私政策、服务条款、备案页面、社交链接、统计、运行时管理页面、后端配置 API 或数据库字段。

## 路由边界

### 纳入

- `/`：保留首页大型页脚，并增加其紧凑信息与操作行。
- `main#main-content` 内渲染的所有普通登录后路由，包括深链、权限拒绝以及两个有意保留的 `NoEntryPage` 路由。
- 浏览器代表样本为 `/parameter-home`、`/parameters` 和 `/feedback-admin`；其余普通路由由应用壳参数化自动化证明。

### 排除

- 登录/注册页、认证启动骨架、服务不可达页和根级 `ErrorBoundary` 回退页；这些界面都在普通应用壳之前提前返回。
- `/parameter-admin/projects/:projectId/configuration`；该全高工作台拥有 `overflow: hidden` 布局，不得因页脚损失工作高度。
- `/downloads/*`；它是静态下载交接，不是 SPA 渲染页面。

不得复制配置工作台的 pathname 正则。应导出或新增一个共享路由分类器，让 `ParameterAdminNextPage` 与应用壳页脚判定共同使用。

## 构建期配置契约

沿用现有 Vite 构建期配置模式。所有值都是公开展示元数据，不是 secret。

| 环境变量 | 默认值 | 规则 |
| --- | --- | --- |
| `VITE_WISEEFF_FOOTER_COPYRIGHT_OWNER` | `雷泽（WiseEff）` | 去除首尾空白；空值回退默认值。生产运维在真实法定主体明确后应覆盖。 |
| `VITE_WISEEFF_APP_VERSION` | 根 `package.json` 的 `version` | 可选发布标签覆盖；展示时确保只有一个前导 `v`。 |
| `VITE_WISEEFF_CONTACT_HREF` | 空 | 只接受绝对 `https:` 与 `mailto:`；空值或非法值不显示链接。 |

新增一个小型纯解析器及单元测试，统一处理去空白、版本前缀、协议验证和仅开发环境警告。三个键必须加入 `ImportMetaEnv`、本地与自托管示例、自托管 Docker 构建参数和环境、Compose 构建参数，以及中英文环境变量文档。自托管文档必须明确：修改 `VITE_*` 后需要重新构建前端镜像。

## 架构与预期文件

| 文件 | 计划职责 |
| --- | --- |
| `src/config/appFooterConfig.ts` | 纯构建期页脚配置解析器和 package 版本回退。 |
| `src/config/appFooterConfig.test.ts` | 默认值、去空白、版本覆盖/前缀、`https:`、`mailto:`、空值、非法协议和告警测试。 |
| `src/components/common/AppFooter.tsx` | 接收 `onFeedback` 的共享页脚内容：应用壳内渲染语义化 `<footer>`，嵌入首页现有页脚时渲染非 landmark 信息容器。 |
| `src/components/common/AppFooter.test.tsx` | 文案、当前年份、可选联系链接、安全外链属性、邮件链接、反馈回调和无障碍名称。 |
| `src/App.tsx` | 把 `FeedbackDialog` 所有权从 `Sidebar` 提升到 `AppShell`；向 Sidebar 与 AppFooter 传入同一个打开回调；在普通页面末尾加入页脚；排除全高工作台。 |
| `src/App.test.tsx`、`src/App.skipLink.test.tsx` | 应用壳位置、路由切换、当前页上下文、纳入/排除路由、首页不重复和 landmark 保持。 |
| `src/ParameterAdminNextPage.tsx` 与共享路由 helper/test | 消除重复的配置工作台 pathname 判定。 |
| `src/linear-template/LinearTemplateHome.tsx` | 在现有大型页脚内部渲染共享首页信息行变体。 |
| `src/styles.css`、`src/linear-template/linear-template.css` | 仅使用 token 的紧凑布局、链接交互状态、换行、分隔线和首页集成。 |
| `src/vite-env.d.ts` | 声明三个公开构建变量。 |
| `.env.example`、`ops/self-hosted/.env.example` | 记录安全默认值和可选覆盖。 |
| `ops/self-hosted/Dockerfile`、`ops/self-hosted/compose.yaml` | 将构建期值传入 Vite 构建。 |

提升对话框状态是必要改动：当前 `Sidebar` 自己持有 `feedbackOpen` 并挂载 `FeedbackDialog`。如果不提升，页脚无法复用同一个带当前页上下文的交互，只能重复对话框状态。改造后 `AppShell` 是唯一对话框所有者，Sidebar 只保留触发器。

## 实施任务

### 任务 1：先登记验收所有权

1. 在中英文浏览器验收覆盖图增加 `SHELL-FOOTER-001`。
2. 在 `e2e/acceptance/operationMatrix.ts` 增加操作定义，并通过仓库命令生成/更新中英文操作矩阵，不手改生成行。
3. 需求定义为：全部纳入路由只有一个页面收尾页脚；首页不重复；反馈携带当前页上下文；已配置外部联系遵循批准的协议行为；排除的全屏/过渡界面保持不变。
4. 实际反馈提交的 UI、API、数据库、审计和截图证据继续归 `PFB-SUBMIT-001`；`SHELL-FOOTER-001` 只负责应用壳存在性和入口行为。

### 任务 2：先以测试驱动实现配置解析器

1. 先为默认值、package 版本、覆盖规范化、允许协议、拒绝协议和告警行为编写失败测试。
2. 实现纯解析器与 `ImportMetaEnv` 声明。
3. 补齐本地/自托管构建变量传递与示例。浏览器代码不得读取服务端运行时环境变量。

### 任务 3：构建共享页脚与反馈触发 seam

1. 先写组件测试，再实现组件。
2. 在应用壳中渲染 `<footer aria-label="页脚信息">`；首页变体必须在现有 `<footer>` 内渲染非 landmark 容器，禁止嵌套 footer landmark。“问题反馈”使用 button，只有合法外部联系才使用 anchor。
3. 把 `FeedbackDialog` 状态和渲染提升到 `AppShell`，保留脏状态确认、repository 注入、路由路径和页面标题。
4. Sidebar 与页脚使用同一回调，确保全应用只有一个对话框实例。

### 任务 4：集成路由与首页边界

1. 在普通页面滚动容器内、`PageRouter` 之后追加紧凑页脚；不得把它做成 `.main-content` 下方的固定 sibling。
2. 使用共享路由分类器在配置工作台隐藏页脚。
3. 在现有 `TemplateFooter` 内增加非 landmark 首页信息行，并断言 footer landmark 与元数据都只出现一次。
4. 验证路由切换后的滚动重置不变，SkipLink 仍指向同一个 `main` landmark。

### 任务 5：完成 token 化样式和响应式行为

1. 只使用现有颜色、字体、间距、边框、动效和焦点 token；不得新增裸颜色、字号、阴影或 z-index。
2. 为 button 和可选链接定义 rest、hover、active 与 focus-visible 状态。
3. 在全部必需视口证明无水平溢出，且不与小泽或 Toast 浮层冲突。

### 任务 6：更新持久文档并验证

1. 更新中英文前端、环境变量、产品功能规格、验收覆盖图和操作矩阵文档。
2. 执行下方聚焦测试、UI 门禁、构建、文档检查和浏览器走查。
3. 在本计划记录精确结果与截图路径后，才可移入 `completed/`。

## 验证计划

### 聚焦与仓库检查

```bash
npm test -- src/config/appFooterConfig.test.ts src/components/common/AppFooter.test.tsx src/App.test.tsx src/App.skipLink.test.tsx
npm run ui:check
npm run build
npm run docs:check
```

按照 `docs/developer/verification-matrix.md` 执行负责 `e2e/acceptance/shell-navigation.acceptance.spec.ts` 和操作证据生成的验收命令。扩展该 spec，在普通路由矩阵断言 `SHELL-FOOTER-001`，首页则断言首页变体而不是重复应用页脚。

### 真实浏览器走查

使用 API mode 与 `playwright-cli`。以下路由必须执行 snapshot 与 screenshot，并保存到 `work/ui-checks/compact-application-footer/`：

- `/`：大型页脚保留，紧凑信息行只出现一次。
- `/parameter-home`：短内容与自然收尾位置。
- `/parameters`：长内容、滚动到页脚、携带当前页上下文的反馈对话框。
- `/feedback-admin`：Admin 页面布局。
- `/parameter-admin/projects/:projectId/configuration`：明确证明紧凑页脚不存在且工作台高度不变。

在 `1440x900`、`768x1024`、`390x844` 检查键盘焦点、反馈打开/关闭、已配置 `https:` 与 `mailto:`、空联系配置隐藏、控制台零错误、相关网络行为、无重叠和无水平溢出。外部跳转只检查行为，不向外部主体发送消息或提交数据。

## 成功标准

- 每个纳入页面恰好有一个页面收尾页脚，所有排除界面保持不变。
- 首页保留大型页脚，并只显示一次共享信息与操作。
- 版权所有者、版本覆盖和联系地址均可在构建期配置；本地无额外设置也能使用默认值。
- 未覆盖时展示根 package 版本，且永不出现 `vv...`。
- 非法联系配置失败关闭，不渲染坏链接。
- Sidebar 与页脚打开同一个反馈对话框，且当前页上下文准确。
- 所有样式遵循设计系统，并通过三视口视觉与无障碍检查。
- 不引入后端、数据库、认证、安全或运行时配置 API 改动。

## UI 交互自动化复核

- 新需求/操作：`SHELL-FOOTER-001`，由 `e2e/acceptance/shell-navigation.acceptance.spec.ts` 和 shell 操作矩阵负责。
- 保留既有操作：`PFB-SUBMIT-001` 继续证明反馈提交；本计划不得重复其 API/DB/审计流程。
- 保留既有 shell 诊断：`SHELL-DIAG-001` 继续拦截浏览器、页面和请求错误。
- 证据生成影响：更新 `e2e/acceptance/operationMatrix.ts`，并通过标准 `acceptance:browser` / `acceptance:evidence` 流程保留操作证据。

## 文档影响矩阵

| 范围 | 状态 | 证据 / 计划动作 |
| --- | --- | --- |
| 仓库地图与 Agent 指引 | Review | `AGENTS.md`、`ARCHITECTURE.md`；预计不变，因为没有新增子系统或路由模型。 |
| 计划与技术债 | Update | 本计划、中英文计划索引；只有实施延期了已接受需求时才新增技术债。 |
| 产品规格 | Update | `docs/product-specs/prototype-functional-spec.md` 及中文版：补充第二个当前页反馈入口与页脚边界。 |
| 架构与领域模型 | No change | `docs/design-docs/full-stack-architecture.md`、`docs/design-docs/domain-model.md`、`CONTEXT.md`；纯展示应用壳改动不产生领域术语或架构决策。 |
| API 契约 | No change | `docs/design-docs/api-contract.md`、OpenAPI 与 DTO；没有服务端接口改动。 |
| 安全与治理 | Review | `docs/SECURITY.md`；预计不变。联系协议校验与安全外链属性写入前端文档和测试。 |
| 可靠性与 runbook | Review | `docs/runbooks/self-hosted-runtime.md` 及中文版；仅在环境变量文档不足以说明构建期/重建边界时更新。 |
| 质量与测试 | Update | 中英文浏览器验收覆盖图和生成操作矩阵；复核 `docs/developer/verification-matrix.md`，只有需要新命令时才更新。 |
| 前端与设计 | Update | `docs/FRONTEND.md`、`docs/zh-CN/frontend.md`；记录共享页脚、提升后的反馈对话框所有权、路由例外和配置解析器。复核 UI 设计系统；预计不改 token scale。 |
| 环境变量 | Update | `.env.example`、`ops/self-hosted/.env.example`、中英文环境变量文档；通过 Dockerfile/Compose 传递构建参数。 |
| 生成物 | Review | 只涉及生成的操作覆盖/证据；预计不改 schema 或 OpenAPI artifact。 |
| References | No change | `docs/references/`；没有外部协议或产品参考变化。 |

## 文档更新门禁

- [x] 每个 `Update` 行均完成需要的中英文配套修改。
- [x] 所有 `Review` 行均已在实现树复核。`AGENTS.md`、`ARCHITECTURE.md`、`docs/SECURITY.md`、自托管 runtime runbook、验证矩阵、UI 设计系统以及生成的 schema/OpenAPI 均无需修改，因为本切片未新增子系统、API、secret、运行时配置服务、token scale 或数据模型。
- [x] 环境示例、中英文链接与生成操作矩阵保持当前后，`npm run docs:check` 通过。
- [x] 没有延期任何已接受需求，无需新增技术债条目。
- [x] 下方已记录精确验证与浏览器证据，可以归档。

## 完成证据

- 聚焦 Vitest：5 个文件、157 项通过。完整 `npm run test:all`：前端 3041、脚本 830（5 skipped）、Bridge 138、服务端 2735（8 skipped）全部通过。
- 静态/本地 CI 检查通过：`npm run lint`（0 error；299 个既有 warning）、`npm run ui:check`、`npm run build`、`npm run docs:check`、`npm run contract:check`、`npm run logs:eval`（16/16 与 meta 4/4）、`npm run selfhost:check`、`npm run acceptance:operations`、`npm run acceptance:coverage`、`npm run acceptance:ci`、`npm run acceptance:quality`。
- 在隔离 API mode runtime 与可丢弃数据库上通过浏览器门禁：`npm run acceptance:quality-run` 97/97、`npm run acceptance:smoke` 4/4。完整 shell-navigation 命令 27/27：26/26 个 shell case（完整普通路由矩阵、两个 `NoEntryPage`、首页、工作台排除与权限拒绝）加 runtime warmup 1/1。聚焦操作证据校验通过，`SHELL-FOOTER-001` 与 `SHELL-DIAG-001` 均有记录。
- `playwright-cli` 在 `1440x900`、`768x1024`、`390x844` 覆盖 `/`、`/parameter-home`、`/parameters`、`/feedback-admin` 和 `/parameter-admin/projects/aurora/configuration`。每个路由/视口均在 `work/ui-checks/compact-application-footer/` 保存 snapshot 与 screenshot；未发现水平溢出、遮挡或 console error，相关 API 请求均为 200。两条 CopilotKit license warning 为既有非错误告警。
- 页脚反馈入口打开唯一对话框，并正确显示 `/parameter-home` 与当前标题。另行构建验证了默认隐藏联系方式、安全 `https:`（`target="_blank"`、`noopener noreferrer`）和 `mailto:`，未对外提交。代表证据：`parameter-home-footer-1440x900.png`、`parameter-home-feedback-1440x900.png`。
- 首轮完整质量门发现本地演示种子不完整；补跑规定的开发态 M0 seed 后，受影响交互视觉组 6/6、完整门禁 97/97 通过。smoke 首轮缺少匹配 HMAC 变量，已废弃并用正确隔离配置复跑通过。早期聚焦 shell 运行修正了纯测试浏览器假设（嵌套 footer role 映射、两个同名关闭按钮、证据归属与角色 fixture），最终聚合结果 27/27 通过。

## Git 与 PR 工作流

实现从最新 `main` 创建 `feat/compact-application-footer`。实现型子智能体只能在该 feature branch 编辑、测试和提交，不得创建或合并 PR。父智能体/会话所有者负责复核 Standards 与 Spec、运行或抽查最终验证、创建 PR、在必需检查通过后合并，并同步本地 `main`。
