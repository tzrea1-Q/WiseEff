# 贡献指南

> English: [English](../../../CONTRIBUTING.md)

WiseEff 的变更应保持产品可用、可测试、可审计。先读智能体入口，再按任务需要查阅索引和相关章节，不把文档目录作为强制通读清单。

## 使用方式

- 普通开发遵循[开发工作流](../agents/development-workflow.md)，运行环境和验证命令查阅对应开发者文档。
- 本页和英文版是相互链接的独立文档；不要在同一篇文档里混写中文和英文正文。
- 命令、路径、环境变量、API 路径、角色名、状态名和脚本名称保持英文原样，避免复制时出错。
- 修改相关功能时，请同时更新英文版和中文版；若文档与源码或测试冲突，在同一变更中修正。

## 运行与安全边界

首次运行 M1 seed 前执行 `npm run dtc:bootstrap` 与 `npm run dtc:check -- --required`。`db:seed:m1` 会先真实编译三份项目 DTS，再写入参数库、项目值与结构化数据。

需要已发布 Catalog 的新建本地或演示数据库，应使用 `npm run db:seed:all`，而不是分别执行四个 seed 命令。它在 M0 与 M1 之间安装 Catalog；单独执行 M1 只会同步已发布的 Catalog。默认种子发布为 `crel_vendor_catalog_3`（版本 `1.2.1`），提供中文显示名与说明，并保留原有 Acme 和 vendor 1/2 发布。临时语义 Binding 辅助函数在该精确种子上安装 `crel_acceptance_bindings_1`（版本 `1.3.0`），从已编译种子派生前驱 pin 和下一发布序号；重放仍须经过安装器校验。`schemas/dts/catalog-release/vendor-catalog-1.yaml` 固定原始编译源，避免重写历史 digest 和修订。

种子展示内容写在 `schemas/dts/vendor/wiseeff/*.yaml` 的属性 `displayName` 与 `documentation` 字段中。`displayName` 可选，缺省时仍使用原属性键；非法名称由 Catalog 内容或发布 schema 拒绝。使用 `npx tsx scripts/enrich-vendor-property-docs.ts` 刷新 `catalog.json`，再执行 `npm run catalog:compile-vendor -- --localized --out /tmp/vendor-catalog-zh.json` 编译。中文后继发布只改变展示内容，不改变属性键、主体、值 schema、单位、匹配规则、Binding 或 Project value。保留的退役 Acme 样例，其中文展示内容在编译器的种子内容中定义，历史夹具不变。已接管或运行中的 Catalog 仍须通过正常的 typed ChangeSet 与受审发布路径改名，不得重新 seed 或直接修改数据库行。

真实小泽本地配置使用原子的 `XIAOZE_LLM_API_BASE_URL` / `XIAOZE_LLM_MODEL` / `XIAOZE_LLM_API_KEY` 三键组；旧别名仅在三键全部缺席时作为迁移输入，设置向导与模板只写规范键。规范组任一键存在时，空值也是显式配置，不能回退旧别名。

生产发布失败关闭依赖完整工具链：`npm run dts:toolchain:check`。参数语义身份切换仅在维护窗口执行，见 `docs/runbooks/parameter-identity-cutover.md`；`--apply` 失败后禁止部分继续。

保留演示和测试所用模拟运行时。生产业务必须使用 API、服务端授权和校验、事务写入与审计。本地跳过或模拟通过不能支持目标环境、试点或发布就绪声明。

## 计划与文档

跨会话、多团队、架构变更、高风险发布或明确契约要求的工作使用 `docs/exec-plans/active/` 持久计划；其他有界工作可使用任务或 PR 摘要。既有计划门禁不变，除 `development-roadmap.md` 外的活动实施计划继续包含文档影响矩阵与文档更新门，并在完成前运行 `npm run docs:check`。

仓库技能按任务需要使用，外部技能包不是前置条件，见[技能与客户端配置](../agents/skill-maintenance.md)。

## 验证

编辑期间运行定向测试，交接前按受影响范围扩大验证；TypeScript、路由、Vite、共享类型变更保留 `npm run build`。文档变更仍运行 `npm run docs:check` 与 `git diff --check`。

### 本地 Vitest 影响选择

`test:impact` 只列出测试，不执行测试，也不启动 API、浏览器或测试数据库：

```bash
npm run test:impact -- src/DebuggingPage.tsx
npm run --silent test:impact -- --base origin/main --json > /tmp/vitest-impact.json
```

传入仓库相对路径的变更文件，**或** `--base <commit>`。基线提交与当前工作树比较，包含已提交、已暂存、未暂存和未跟踪变更；重命名包含新旧路径。可运行的测试套件、静态门禁和浏览器命令写入 stderr，JSON（`changedPaths`、`fullFallback`、`reasons`、`suites`、`gates`、`browser`、`commands`）写入 stdout；`--json` 不再额外列出命令。通过管道读取 JSON 时使用 npm 的 `--silent`。

选择器复用 frontend、server、scripts、Bridge 配置下 Vitest 的传递依赖关联测试发现能力。普通 scripts 文件只选择关联测试，不扩大到整套 scripts 测试；ops 和 packages 变更还会选中完整所属测试套件。局部组件或功能 CSS 变更选中全部 frontend 和 scripts 测试，避免遗漏读取文件的样式守卫。共享外壳/UI 基础组件、全局样式、明确列出的 CI/回执/分片/种子契约/运行时测试工具文件、配置、缺失/删除或未映射代码，以及依赖发现失败，均回退到四套完整测试。

`docs/` 下或仓库根目录的 Markdown 只选择 `docs:check`，不加载 Vitest；运行手册 Markdown 还选择 `docs:runbook-commands:check`，复用现有运行手册命令校验器。OpenAPI/DTO schema 变更选择 `contract:check`，前端 CSS/TSX 选择 `ui:check`，工作流/CI 脚本选择 `acceptance:ci`。门禁实现文件变更还会在关联测试之外选中对应门禁：归属由 package 脚本命令、工具代码的相对导入，以及同一命名空间或共享这些工具模块的生成器推导。生成的 OpenAPI 工件只选择契约门禁。门禁名称在 `gates` 中去重，其可运行命令追加到 `commands`。

只有 `suites` 和 `gates` 同时为空才算空选择；仅选择文档门禁是有效结果。空变更和必需完整测试套件清单缺失仍会报错。执行输出命令前检查 `fullFallback` 并遵守任务验证预算；该本地工具不替代 PR CI、浏览器验收或任何现有门禁。

浏览器选择复用质量路由注册表旁的 `e2e/quality/route-ownership.ts`。`browser` 独立输出 `fullFallback`、`reasons`、`qualityRoutes`、`qualityGrep`、`acceptanceSpecs` 和 `commands`；即使 Vitest 找到关联测试，浏览器归属未知时仍回退到完整浏览器覆盖。质量 grep 保留预热、未标明路由的交互检查，以及提到任一选中路由的跨路由测试。验收 spec 根据已有操作矩阵中的访问路由，加上静态导航证据选择，不按文件名选择。发现过程解析路由字面量、运行时 URL 模板、导入的常量、实际调用辅助函数的参数/默认值，以及 `src/appConfig.ts` 中可见的导航标签；未调用的辅助函数不贡献路由。只有真正无法解析的导航才保守保留，并须列入 `scripts/browser-navigation.ts` 的 `unresolvedBrowserNavigation` 清单并注明原因（当前为空，最多五个 spec）。新增无法解析的导航、失效条目或缺少原因时直接报错，避免静默扩大选择。独立路由变更不必运行没有导航的纯 API spec。例如 `/logs` 变更会选中知识蒸馏和使用运行时 URL 的 log904 关联参数流程。共享变更和 Vitest 发现失败选择完整浏览器覆盖；仅文档/生成 OpenAPI 变更不输出浏览器命令。浏览器清单为空或代码选择为空时直接报错，不输出虚假的空操作成功。这些输出只提供可运行的建议选择，不修改 CI 门禁，也不执行 Playwright。

### Codex 定向浏览器运行器（D3）

本地 Unix-domain IPC 仅允许使用当前用户规范化临时目录中的 `tsx-<effective UID>` 子目录。子进程的 `TMPDIR` 固定为该规范化临时目录，使 tsx socket 路径与沙箱规则一致；非回环 IP 网络继续被拒绝。

`test:browser:codex` 是 #1179 的本地运行器，不替代 CI 或协调者验收。必须在独立 linked worktree 的根目录、`codex/<task>` 分支运行，并显式导出 `WISEEFF_RUNTIME_LANE` 与指向 localhost PostgreSQL 的 `DATABASE_URL`。lane ID 不得与其他工作树或浏览器会话重复。运行前通过既有浏览器环境准备流程创建并播种派生的 `<database>_lane_<N>` 数据库；运行器不创建、迁移、重置或播种数据库。PostgreSQL URL 的查询参数覆盖和已属于其他 lane 的数据库会被拒绝。

```bash
export WISEEFF_RUNTIME_LANE=7
npm run test:browser:codex -- src/features/log-analysis/LogsPage.tsx
npm run test:browser:codex -- --check test-results/lanes/7/codex-browser-evidence.json
```

也可用 `--base <commit>` 替代变更路径；与 `test:impact` 一样包含已提交、暂存、未暂存和未跟踪变更。运行器复用该选择器的实现，记录实际浏览器选择与命令，只执行 quality grep 和精确 acceptance spec 路径，并保留既有 warmup 依赖。非 Linux 主机排除 `visual` quality 项目及包含截图/快照基线断言的 spec 文件，在 `skipped` 中逐项记录原因 `platform: Linux-only baselines`；Linux 选择不作此排除（CI 渲染仍为权威基准）。未知或共享变更保留选择器的完整浏览器回退；任务预算禁止这类运行时，应交给协调者，而不是手动缩小选择。quality 与 acceptance 在同一 lane 顺序运行，复用既有独立数据库、端口、对象存储和输出路径，并拒绝复用服务器。受控运行时描述符、外部传入的跳过运行时设置、quality 项目分区覆盖、替代 snapshot 根目录和工作树外对象存储均被拒绝。在启动任何运行时之前，所选 acceptance 测试必须具有非空白的 `AUTH_TOKEN_ISSUER` 与 `AUTH_TOKEN_HMAC_SECRET`。运行器加载工作树 `.env`，显式环境变量优先，随后验证并固定 lane 所有权。加载内容包括 smoke authorization/provider 设置，而非仅 issuer/secret，以匹配普通 Playwright 的认证 provider 选择。子进程的 dotenv 输入仍固定为 `/dev/null`；拒绝 `.env.local` 对数据库、绑定端口/主机、对象存储或 lane 端点的覆盖。缺少认证配置时非零退出，回执记录 `status: "blocked: missing <names>"`、仅含名称的 `missingConfig` 和空 `runs`；不会将秘密值复制到回执中。

每个 suite 开始前，运行器验证两个 lane TCP 端口均可在回环地址独占绑定；不会终止或复用既有监听者。API/前端服务器由运行器在独立、受沙箱约束的进程组中启动，复用 Playwright 共享 web-server 环境构建器。启动 quality 服务器前，运行器先完成 quality harness 使用的同一 `seed:browser` 契约，随后让其 Playwright 子进程跳过重复 quality seeding；显式的 `WISEEFF_QUALITY_SKIP_SEED=true` 保留既有预先 seed／只读行为。这确保认证探针运行时开发身份已存在。即使父进程导出 `AUTH_MODE=development`，acceptance 仍保留既有 production 认证设置。前端就绪还要求 `/src/main.tsx` 转换成功，不能仅依据 HTML shell 返回 HTTP 200；转换失败会在认证或浏览器测试之前阻止启动。服务器就绪后，必须直接访问 API 及经前端代理访问 `/api/v1/me` 均得到 HTTP 200，才启动测试。探针遵循同一构建器产生的有效服务器环境：development 仅使用 `x-wiseeff-user` 身份请求头，quality 身份取自服务器共享的 `developmentAuthContext`，acceptance 身份取自其 cast helper，不再假设两者相同；production quality 使用前端配置的 authorization，acceptance 则使用与浏览器登录 helper 相同的 bearer/HMAC 签名器。探针不会为 quality 自行生成替代 token。回执的 `authProbes` 记录每次已尝试探针的 suite、有效 `mode`（`development` 或 `production`）、`mechanism`（`development-header` 或 `bearer`）和最终 `httpStatus`（连接失败时为 null），不记录请求头或 token 值。移除代理环境变量并设置 `NO_PROXY=*`，避免继承代理影响回环检查。仅运行器内部拥有的 Playwright 子进程获得跳过 web-server 标志。每个 suite 都等待逆序进程组终止（TERM，必要时 KILL，并验证已消失），才启动下一个 suite；suite 之间及最后一次清理后再次检查端口。SIGINT/SIGTERM 同样进入清理。端口冲突、探针/启动失败、中断或清理失败均非零退出，记录 `blocked: <reason>` 及脱敏 `block`，按情况包含 suite、冲突端口或 HTTP 状态；回执仅保留已尝试的运行。清理失败时不启动下一个 suite。就绪检查和原生运行时行为仍须协调者验证。

当前执行后端**仅支持 macOS**：通过原生 `/usr/bin/sandbox-exec` 将 Playwright、Chromium、API/前端服务器及其子进程的 IP 网络限制为回环。profile 显式允许 Node/esbuild 子进程 IPC 所需的 AF_UNIX socket 创建，但具名 Unix socket 的 bind/connect 仍限于用户临时目录中的 tsx IPC 路径。执行/fork、文件访问和 Mach lookup 已继承 `allow default`，不额外授予宽泛权限。其他平台或原生沙箱不可用/被拒绝时失败关闭，不提供无限制回退、浏览器下载、shell 命令输入、git 写入、push 或 PR 操作。D3 中用户批准的 Codex 沙箱绕过，只适用于协调者在相同边界内启动的独立任务会话；运行器本身不会启用绕过。协调者接受该后端前，必须真实验证原生网络限制和 Chromium 启动。本票的普通沙箱实现者不启动它。

版本 1 回执位于 `test-results/lanes/<N>/codex-browser-evidence.json`。包含 `worktree`（根目录、分支、HEAD、dirty 标记）、不含凭据的 `lane`（数据库名称、URL 和产物根目录）、`network`、`selection.changedPaths`、完整的 `selection.browser`、时间戳、总体 `status`、已执行测试标签中的 `themes`，以及按 quality、acceptance 排序的两个 `runs`。每次运行记录退出码、耗时毫秒数、JSON 报告路径、报告错误数量和测试列表；每个测试记录文件/标题/项目、标题标注的路由/主题、预期状态、原生结果、总耗时，以及每次尝试的状态/重试序号/耗时/产物路径。未标注路由保持 `[]`，未标注主题保持 `null`；这些是报告标签，不证明浏览器实际访问了哪些页面。内联附件引用原始 JSON 报告，不重复保存字节。原始 JSON、HTML 报告、截图和 trace 保留在既有 lane 目录，继续遵守既有产物脱敏和共享要求。

导出的 `codexBrowserEvidenceSchema` 与 `--check <receipt>` 验证机器可读格式，并核对结果与状态。非零/中断启动、损坏或缺失报告、unexpected/flaky 结果、漏收所选 acceptance spec、未执行非 warmup 测试、整次运行全部跳过，均不能通过。启动前删除旧 JSON 结果，输出符号链接不能逃逸工作树；lane 本地锁拒绝同一工作树内并发启动运行器。强制终止后可能残留 `.codex-browser-lock`；协调者必须确认相关进程均已停止，才可移除该空目录。初始回执的 `spotCheck` 为 `null`；协调者真实检查后改为 `{ "reviewer": "<姓名>", "checkedAt": "<ISO 时间>", "outcome": "passed|failed", "notes": "<变更、路由/主题、已检查截图/交互>" }`，并重新运行 `--check`。待检查状态会明确输出；格式合法但运行失败或抽查失败时仍以非零退出。真实变更演示、协调者抽查记录、Playwright quality/acceptance、`ui:check` 和截图均须由真实运行时提供，不能用单元测试代替。

### 测试数据库隔离

本地 quality 与 acceptance Playwright 配置支持 `WISEEFF_RUNTIME_LANE=<N>`（1–10000 的整数，不允许前导零）。提供 PostgreSQL `DATABASE_URL` 后，描述符选择 `<database>_lane_<N>`、API 端口 `20000 + 2*N`、前端端口 `20001 + 2*N`、`<OBJECT_STORE_ROOT>/lane-<N>`（默认 `.wiseeff-object-store/lane-<N>`），以及 `test-results/lanes/<N>/<quality|acceptance>` 和 `playwright-report/lanes/<N>/<quality|acceptance>`。这些设置会传递给浏览器 worker；嵌套 fixture 使用 `WISEEFF_TEST_DATABASE_PREFIX=pw_lane_<N>`。启动 Playwright 前，使用既有运行时准备流程创建并播种各 lane 数据库；描述符不会创建或重置数据库。并行运行必须使用不同 ID，quality 与 acceptance 同时运行也不例外；对象存储保持 local 模式。lane 不复用既有服务器，也不能与受控 Gate0 描述符或标志同时使用；既有受控运行时隔离保持不变。未选择 lane 时，现有默认值和覆盖变量不变。

例如，导出基础 `DATABASE_URL` 后运行 `WISEEFF_RUNTIME_LANE=1 npx playwright test --config playwright.quality.config.ts`，另一个工作树可使用相同基础 URL 和 lane 2。`WISEEFF_QUALITY_LANE` 仍独立选择 quality 项目。lane 的输出与报告目录优先于共享目录覆盖变量。直接运行 `npm run dev` 时遵循 `WISEEFF_FRONTEND_PORT`（默认 5173）与 `VITE_WISEEFF_API_BASE_URL`（默认 `http://127.0.0.1:8787`）；`npm run dev:api` 继续遵循 `PORT`（默认 8787）。Vite 的 API 与下载代理均使用选定的 API URL。

lane 模式下，前端子进程的 `VITE_WISEEFF_API_BASE_URL` 使用自身 Vite 源站，使浏览器 API 与下载请求保持同源。`WISEEFF_DEV_API_PROXY_URL` 为 Vite 的 `/api` 与 `/downloads` 代理指定独立 API 上游。Node 侧浏览器 fixture 与播种工具仍使用直连 API URL。这样无需扩大 API 对 lane 端口的 CORS 权限，授权请求头也保持不变；非 lane 启动行为不变。手动启动 lane 前端时，同样需要区分浏览器基础 URL 与代理上游 URL。

设置 `WISEEFF_TEST_DATABASE_PREFIX` 后，一次性切换后浏览器测试使用 `<prefix>_disposable_…`；未设置时保留 `wiseeff_acceptance_disposable_…`。手动运行可用 `WISEEFF_ACCEPTANCE_NESTED_API_PORT` 和 `WISEEFF_ACCEPTANCE_NESTED_FRONTEND_PORT` 固定嵌套 API/前端监听端口（1–65535 范围内的不同整数），canonical DTS reload 测试也遵循这两个覆盖变量。复用手动运行的端口时，设置 `WISEEFF_ACCEPTANCE_NO_START_RUNTIME=true`，使用 `--no-deps` 仅运行嵌套测试，不要同时在这些端口启动父运行时。受控设备的回环 socket 仍由测试独占并使用临时端口。CI 不设置端口覆盖，继续使用自动分配的隔离端口。

PostgreSQL 测试工具（`server/testing/testDatabase.ts`）依次使用非空的 `TEST_DATABASE_URL`、`DATABASE_URL`，最后回退到本地 Compose 默认连接。同一集群上的并行工作树应在启动各自测试进程前设置不同的 `WISEEFF_TEST_DATABASE_PREFIX`。前缀会去除首尾空白；未设置或为空时默认 `wiseeff`。有效格式为 `^[a-z][a-z0-9_]{0,15}$`：1–16 个字符，以小写 ASCII 字母开头，后续仅允许小写 ASCII 字母、数字或下划线。无效前缀会在数据库准备前报错。

该前缀用于迁移模板（`<prefix>_test_tpl_…`）、临时模板构建（`<prefix>_test_tplbuild_…`）与 worker/临时数据库（`<prefix>_test_wk_…`）。提供该变量时，托管实例测试使用 `<prefix>_m…`；未设置时保留 `wiseeffm…`。旧模板和孤立 worker 清理仅匹配所选模板/worker 前缀，下划线按字面匹配；worker 收尾清理还匹配当前运行标识。使用工作树独占的前缀（例如 `review_fixes`），避免一次清理选中其他工作树的测试数据库。该设置不改变连接 URL、不授予权限，也不取消共享集群角色目录锁。

WiseEff 以 PC 为主，可见修改默认验证受影响页面和状态的 `1440x900` 视口，不要求三设备走查。具体布局风险才补充较窄 PC 窗口；平板和手机按需启用。真实浏览器证据及专门验收边界见[界面质量检查清单](../developer/ui-quality-checklist.md)。

## 同类中文文档

- [智能体指南](AGENTS.md)
- [仓库说明](README.md)
- [架构地图](ARCHITECTURE.md)
- [文档索引](../README.md)
- [前端开发](../frontend.md)
- [执行计划](../PLANS.md)
- [质量标准](../QUALITY_SCORE.md)
