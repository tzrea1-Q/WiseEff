# 管理阶段 runtime LOGIN 来源

[English](runtimeRoleSource.README.md)

`openRuntimeRoleSource` 观察 handoff 固定 API、worker `DATABASE_URL` 实际选择的 LOGIN，以及 API 配置时独立的 `CATALOG_GOVERNANCE_DATABASE_URL`。它返回不透明句柄；`observeRuntimeRoles` 只接受本模块签发的句柄，并复核仍存活的资源。不返回连接、密码、环境文件内容、startup pin 或批准。

控制根提供固定 `HandoffPlan`、受控的预期摘要，以及同目录真实 `HostOperationLock`。新增 handoff FD 租借核对四个原私有文件的 device/inode、当前路径、所有者、0600、单链接和内容摘要，保持原 FD 直到关闭。它不替代 `verifyStoppedHandoff`、capture、当前 mapping、报告验证或任何阶段判定。仅构造限定 plan 的夹具不证明完整 handoff producer 已执行。

管理凭据只取自固定管理文件。模块使用该受限管理 LOGIN 自己建立连接，执行既有 `assertBindingManagementLogin`，比对实际 socket、Docker PostgreSQL 发布端口，并查询 system/database 身份。每个 runtime 凭据使用独立只读会话，通过独立管理连接观察随机 session advisory lock，把该会话绑定到实际数据库。身份前置检查复用正式 runtime 规则；原应用 startup 仍要求 Catalog 存在和既有真实 startup adapter。管理、bootstrap、治理凭据均不能冒充应用 LOGIN。

支持当前实测 loopback 发布端口，或既有 `observeLegacySourceEndpoint` 能证明的已停止源 resolver profile。这只证明管理阶段的端点关系。未知候选 DNS/config profile 拒绝；观察旧停止容器的 resolver 不证明未来候选容器 DNS 或成功启动。不回落 ambient 数据库，不接受端点证明回调或角色名输入，不加 grant/schema。

| 威胁 | 必须满足的边界 |
| --- | --- |
| 伪造锁、句柄或变更 plan | 连接、观察之前拒绝 |
| 配置被替换、链接、修改或不再私有 | 原 FD 和当前路径必须仍符合全部固定事实 |
| 不同目标存在同名角色 | 实际发布端口、socket、物理身份和随机 session lock 必须一致 |
| bootstrap/管理凭据作为应用连接 | 既有 runtime 身份检查及实际 OID 区分拒绝 |
| 漏掉可选治理连接 | 已配置的 API 治理连接必须单独认证、标明 purpose |
| 权限或配置变更、断连、关闭 | 每次不透明句柄观察重新验证，不复用缓存成功 |

所有打开的 pool、FD 都由本模块拥有，失败时关闭；显式 close 共享且幂等。宿主锁 owner 必须等待 close 完成再释放锁。会话保持只读，不启动服务、不执行 DDL/DML。

Checkout 在同步 pool 回调中登记实际 client 及持续 error/end 监听，然后才 resolve 初始化等待。两个永久 EventEmitter 反例在回调刚返回时立即发出 error/end；旧 await checkout 两项都失败。修复后九项 source 加原十项 runtime 兼容共 19/19，包含真实缺数据库 API 子进程。这两个 checkout 用例显式替代 client/daemon，不算实际 PG 连接证据。严格 targeted types 通过。

下一实际调用者是管理阶段 P13 owner：它可持有该句柄，为 V13 提供真实 runtime 根集合，替代调用者角色名，并避免将 verifier/bootstrap 当成 runtime。本模块尚未接该 owner/gate。既有 V13 的 `postgres`/current-user 排除仍是待接线的明确缺口。配置中的数据库登录也不等于全部旧写入者、后台任务、trigger、overlay 或其他 P13 surface 清单。本模块不签发 P13 完成或 startup authority。

验证：初始纯 Red 收集五项失败，原因是新 FD 租借、身份入口尚不存在。强制 `runtime-role-source-pg16` 路由使用专属 `vitest.runtime-role-source.config.ts`，收集前要求既有父 owned PG receipt，零用例拒绝。真实集成夹具使用迁移后的隔离 PG16、不同 LOGIN 密码、真实私有文件和真实宿主锁；不创建 Docker 资源、不编造有效 P12/报告。限定 handoff 夹具不算完整根正向。setup hook 为实际迁移设置 60 秒预算；单项保持 Vitest 默认预算。

父首次真实运行 `176d233a4` 收集七项，二过五失败，统一被 `RESOLUTION-UNSAFE` 挡住；两个宽泛角色拒绝断言接受了错误的前置拒绝。这是实现和测试缺陷，不是继承环境失败。真实管理 LOGIN 查询确认锁定驱动把 PostgreSQL `name[]`（OID 1003）返回成字符串，而 `text[]`（OID 1009）返回数组。诊断仅输出类型、OID 和 `pg_catalog` 首项布尔。查询现显式转为 `text[]`，数组与首 schema 判断不变。

test-only `8c00cd59a` 补精确 manager/governance 错误码及真实不安全 search_path 反例：八项收集，一过七失败，exit 1，清理已核验。修复 `9ee5581d95` 八项全过，10.48 秒、exit 0、清理已核验；隔离 `postgres:16-alpine` linux/arm64 镜像为 `sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。保留私有日志 `/tmp/upg824-runtime-role-parser-red.log`（SHA256 `bdbd289a105053a339928ba98a17478670780f690dd6683df79a8fa142574929`）及 `/tmp/upg824-runtime-role-parser-green.log`（`59389ea534ff2735d443f96cc163a5716a7d6cc08f1d44c17440b3720296ccaa`）。同代码还通过 19/19 纯与兼容测试、严格 targeted types。这只证明配置 LOGIN 来源组件，不是完整 handoff、P13 gate 接线或合法生产启动。
