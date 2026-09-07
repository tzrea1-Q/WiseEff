# 管理阶段 runtime LOGIN 来源

[English](runtimeRoleSource.README.md)

`openRuntimeRoleSource` 观察 handoff 固定 API、worker `DATABASE_URL` 实际选择的 LOGIN，以及 API 配置时独立的 `CATALOG_GOVERNANCE_DATABASE_URL`。它返回不透明句柄；`observeRuntimeRoles` 只接受本模块签发的句柄，并复核仍存活的资源。不返回连接、密码、环境文件内容、startup pin 或批准。

控制根提供固定 `HandoffPlan`、受控的预期摘要，以及同目录真实 `HostOperationLock`。新增 handoff FD 租借核对四个原私有文件的 device/inode、当前路径、所有者、0600、单链接和内容摘要，保持原 FD 直到关闭。它不替代 `verifyStoppedHandoff`、capture、当前 mapping、报告验证或任何阶段判定。仅构造限定 plan 的夹具不证明完整 handoff producer 已执行。

管理凭据只取自固定管理文件。模块自己建立受限管理 LOGIN，执行既有 `assertBindingManagementLogin`，比对实际 socket、Docker PostgreSQL 发布端口，并查询 system/database 身份。每个 runtime 凭据使用独立只读会话，通过独立管理连接观察随机 session advisory lock，把该会话绑定到实际数据库。身份前置检查复用正式 runtime 规则；原应用 startup 仍要求 Catalog 存在和既有真实 startup adapter。管理、bootstrap、治理凭据均不能冒充应用 LOGIN。

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

下一实际调用者是管理阶段 P13 owner：它可持有该句柄，为 V13 提供真实 runtime 根集合，替代调用者角色名，并避免将 verifier/bootstrap 当成 runtime。本模块尚未接该 owner/gate。既有 V13 的 `postgres`/current-user 排除仍是待接线的明确缺口。配置中的数据库登录也不等于全部旧写入者、后台任务、trigger、overlay 或其他 P13 surface 清单。本模块不签发 P13 完成或 startup authority。

验证：初始纯 Red 收集五项失败，原因是新 FD 租借、身份入口尚不存在。focused Green 和严格类型检查按具体候选记录。专属 `vitest.runtime-role-source.config.ts` 在收集前要求既有父 owned PG receipt，零用例拒绝。真实集成夹具使用迁移后的隔离 PG16、不同 LOGIN 密码、真实私有文件和真实宿主锁；不创建 Docker 资源、不编造有效 P12/报告。限定 handoff 夹具不算完整根正向。新 setup hook 为实际迁移设置 60 秒预算；单项保持 Vitest 默认预算。实际 PG 执行及强制父 runner 路由仍待父串行安排、接线。
