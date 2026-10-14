# L2 验收失败修复：#1173

> English: [English](../../developer/acceptance-l2-1173.md)

## 证据边界

协调者提供的 main 运行位于 `c66b0f304`，于 2026-10-14 02:23 UTC 启动，四个非 HDC 分片均失败。材料包括 `l2-main/failures.txt` 及 `job-115647168807.log`、`job-115647168810.log`、`job-115647168859.log`、`job-115647168889.log`。这些日志列出了失败项，但没有各断言的完整定位器和堆栈；它们证明 CI 确实失败，不能单独证明完整根因。

修复工作树基于 `1e8923061189793280a50e1a007d25068b916c80`。另外的协调者日志（`ui-p2/a-pfinal-all.log`、`a-p4merged.log`、`acc-main.log`、`acc-final.log`）来自较早的本地集成工作树。其中的具体错误可以辅助诊断，但不是当前候选版本的验收证据。下表区分源码中可确认的不兼容与历史环境前置条件。所有浏览器修复仍需真实运行复核。

## 各 spec 的诊断与修复

| 失败 spec／流程 | 证据与原因 | 修复／仍需真实运行证明的内容 |
| --- | --- | --- |
| `visual.quality.spec.ts`：`/feedback-admin` | Gate0 仅执行 `db:migrate`、`db:seed:all`，随后设置 `WISEEFF_QUALITY_SKIP_SEED=true`。共享浏览器种子还执行创建已提交反馈的 `seed:quality:admin-lists`；Gate0 遗漏了这一有数据列表的夹具。 | 在数据库标记及 API／前端启动前补充管理列表种子。协调者需确认反馈数据位于同一个自有数据库，并比较既有 Linux 视觉基线，不重新生成基线掩盖失败。 |
| `canonical-dts-reload.acceptance.spec.ts` | CI 记录可见性失败。`DtsParameterWorkbenchTable` 的参数单元格包含显示名称、属性键及草稿徽标，精确匹配 `iin_max` 或 `iin_max 草稿` 的单元格名称不能表达这一复合单元格。旧本地运行更早就因 Catalog 数据库通道不满足要求而停止。 | 定位真实绑定行及其 binding 专属草稿徽标。保留候选绑定身份、刷新持久化、审核前官方值不变、审核后 `<6>` 的断言。协调者需确认 CI 原始失败行，并完成受控设备晋升／审核流程。 |
| `issue902-canonical-initialization.acceptance.spec.ts` | 旧本地日志期待 `/parameter-review?project=issue902-target$`，实际 URL 还含 `legacyRequest`、`view`、`type`。`ReviewInbox` 的动作名称为 `提交详情`，不再是 `初始化详情`。CI 报告点击超时。 | 单独验证路径与精确项目查询参数，允许收件箱状态参数；按 `review.id` 定位准确初始化请求行后打开详情。保留真实预览、提交、批准及继承值检查。协调者需完成 JSON 初始化流程。 |
| `parameter-topology.acceptance.spec.ts`：治理／拓扑流程 | 旧本地堆栈指向第 756 行，等待名为 `DTS 源码` 的 **button**。`DtsParameterWorkbench` 使用 `variant="tabs"` 的 `ViewSwitch`，两种模式的角色都是 `tab`。CI 报告点击超时。 | 使用准确命名的 tab 切换源码／参数列表。保留拓扑、模块树、源码查看器、身份映射、验证／发布断言。协调者需在固定 DTS 工具链下运行完整流程。 |
| `catalog-publication.acceptance.spec.ts`：授权操作员 | CI 报告可见性失败。spec 同步调用 `isVisible()` 探测阻断提示，但 `CatalogOrganizationSurface` 异步加载发布策略。匹配文本仍为 `尚未完成接管`，当前提示已是 `参数目录正在接管中`。 | 读取真实发布状态，按 `authoringAllowed` 选择流程；阻断时要求真实 blocker 并等待当前提示。既有健康状态下的草稿／预览／发布路径不变。协调者需记录实际执行的策略分支；策略阻断结果**不能**证明发布成功。 |
| `parameter-catalog-definitions.acceptance.spec.ts`：生命周期／编辑器 | CI 记录可见性失败。spec 已读取真实发布状态，却始终查找 `编辑`；当有效 `authoringAllowed=false` 时，`CatalogPage` 有意提供 `查看` 与只读弹窗。 | 根据服务端有效权限选择准确动作名称。保留发布权限对应的生命周期断言，以及可编辑表单／表单不存在的断言。协调者需验证允许编辑和受阻只读两种状态。 |
| `parameter-catalog-governance.acceptance.spec.ts`：治理流程 | CI 记录可见性失败。共享 `openDefinitionEditor` 同样无条件查找 `编辑` 动作及弹窗。这是可确认的源码不匹配；仍需当前 CI 堆栈确认所记录失败是否发生于此行。 | 在共享 helper 中统一遵从服务端有效编写权限。保留登记、放置、审核队列、表单权限检查。协调者需执行完整流程并取得原始失败定位器。 |
| `parameter-catalog.acceptance.spec.ts`：发现 | `acc-main.log`、`a-pfinal-all.log` 显示旧本地夹具拒绝了非 55438 端口的 PostgreSQL 通道。此项列在本地失败中，不在提供的最新 CI 失败清单中。 | 当前 `catalogAcceptanceEnvironment` 已支持已验证 Gate0 描述符或准确的专用手动通道。不放宽所有权、端口或数据库检查。协调者需以当前自有描述符重新执行发现流程。 |
| `parameter-catalog-negative.acceptance.spec.ts`：适配器一致性 | 旧本地堆栈在 `startCatalogScenarioRuntime` 因缺少专用 Catalog 通道而停止；当前场景使用一次性嵌套运行时及所有权验证。 | 不做推测性适配器修改。协调者需在当前自有运行时完成 API／mock 权限一致性及负面用例，保留真实负面响应断言。 |
| `project-configuration-workbench.acceptance.spec.ts`：canonical 就绪状态 | `a-p4merged.log` 记录 `canCreateBaseline=false`；同次基线失败明确指出缺少完整 `dtc`、`fdtoverlay`、`dt-validate`。服务端有意以硬验证错误阻止就绪。 | 不强制就绪为绿、不移除 blocker。协调者需读取当前运行时的就绪响应，确认同一进程的所有固定二进制，并验证待审 canonical 提交确实阻止就绪直至审核。就绪失败本身仍需完整 blocker 响应确认归因。 |
| `project-configuration-workbench.acceptance.spec.ts`：基线 | 旧本地日志记录 HTTP 409 及 `hard-validation-error:<toolchain>:DTS toolchain incomplete`，spec 期待 HTTP 201。这明确证明该历史运行缺少前置条件。 | 保留成功断言及服务端门禁。协调者需配置并验证固定工具链，然后创建、比较、发布、恢复基线。配置后仍存在的当前失败需要单独进行产品诊断。 |
| `debugging-simulator.acceptance.spec.ts`：两条在线流程 | 协调者在全新种子数据库上运行，两条流程均等待 `调试会话摘要` 超时（513/625 行）：spec 访问 `/node-debugging`，不是渲染 `SessionSummaryCard` 的参数调试页面。当前工作树中，`NodeDebuggingPage` 通过 `useTopBarActions` 提供真实目标及 `.live-dot`；`App` 将其渲染在名为 `节点调试平台页面操作` 的 toolbar 中。Bridge 上下文中的连接标记表示主机，不是选中的设备。提供的 `runs/1173/sim-context.md` 和 `sim.png` 在实现者文件系统中不可用。 | 共享断言改为要求该语义 toolbar 可见、包含 `已连接：Aurora Simulator 1`，且恰有一个在线指示。当前树已渲染该指示，无需恢复产品 UI。协调者需重跑写入／回滚和只读流程；断开连接仍必须失败。 |
| `knowledge-canonical-definition.acceptance.spec.ts` | `a-pfinal-all.log` 明确在 `Set TEST_DATABASE_URL to a dedicated PostgreSQL` 处停止，尚未执行 Definition 引用流程。当前 Gate0 环境已设置该变量。 | 保留夹具的数据库要求。协调者需执行当前自有运行时的 Definition 引用、仅发布态反向链接、弃用及旧历史流程；历史前置条件失败不能证明浏览器功能正常。 |
| `xiaoze-canonical-action.acceptance.spec.ts` | `acc-final.log` 在 `Issue 905 requires the dedicated Catalog PostgreSQL lane on port 55438` 处停止，早于 canonical Agent 流程。当前 Gate0 支持已验证描述符。 | 保留所有权、人类审批及产品审核。协调者需使用当前描述符运行 JSON 搜索、编辑后批准、刷新、产品审核、取消；不引入 Agent 写入捷径。 |

## 回归与验证归属

新增配置回归测试在现有子进程／数据库边界记录种子命令，要求数据库就绪前完成管理列表种子。测试先于实现编写。默认 Vitest 配置排除了 `scripts/`，首次命令未收集到测试；随后使用 scripts 配置的定向运行在 `Gate0 owner process-start identity could not be captured before provisioning` 处停止，未到达新增种子断言。因此种子回归的红／绿结果仍为**未确认**，不是通过。保留原始门禁，没有绕过沙箱。

没有删除或放宽 spec、基线图、审批检查、超时、所有权限制、服务端授权规则。协调者负责完整 Vitest、构建、全仓库 lint、`ui:check`、中英文文档／契约／边界检查、Playwright 质量／验收，以及 1440×900 截图。本补丁不修改生产 UI，也没有有意改变视觉基线。

## 后续与关闭条件

1. 获取提供的 main SHA 对应的浏览器／视觉断言级产物，将各诊断与真实失败行逐项对应。无法由本补丁解释的失败继续按独立缺陷处理，不能标记为“仅环境问题”。
2. 若操作员 spec 需要证明真实发布成功，单独跟踪已启用／已接管发布夹具 ticket：配置真实发布者、已接管基线、仓库及 worker，要求健康发布状态，证明草稿 → 预览 → 激活。不能用权限／策略覆盖替代夹具，不能把现有受阻分支计为发布成功。`catalog-publication-delivery.acceptance.spec.ts` 是现有隔离真实交付验证边界。
3. 在协调者管理的当前运行时执行上述流程；修复剩余产品或夹具缺陷，不跳过 spec、不放宽期待结果。
4. 通过协调者授权的工作流集成，并取得 **main 上连续两次全量 L2 通过**。本地静态／测试结果不能替代该要求；证据取得前 #1173 保持未关闭。
