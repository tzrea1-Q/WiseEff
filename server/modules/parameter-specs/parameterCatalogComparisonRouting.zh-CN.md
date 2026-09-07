# CGH 比较接入正式 Catalog 读取入口

[English](parameterCatalogComparisonRouting.md)

新 PG 用例归正式 API 组合根所有：
`parameter-catalog-api/cghReadProjection.integration.test.ts`。安装 fixture 和权限反向 SQL
遵循既有 production composition 测试的归属。未封定草稿曾放在 CGH consumer 目录，
触发一项 Kernel 私有 fixture 导入及两项 canonical raw-access 扫描；随后按真实组合根
职责归属该测试，SQL 原文及全部拒绝断言保持。CGH 生产模块路径未改变，只用公开接口。
扫描始终启用，没有新增 allowance 或修改 trusted inventory。

CGH provider 现在通过公开的 `registerParameterCatalogApi` 在私有 `createRouter`
实例注册正式组合，并发出 definitions、组织 registrations、组织 review items 三个固定
GET。不再自造 `SELECT 1` readiness、未注册投影、零 usage 或空 governance 查询端口。
实际 pointer／Kernel、registration、usage 查询及失败语义由正式组合负责。

任何库存查询前，必须确认 database 实际登记的 root pool 与传入 pool 相同；拒绝 facade、
事务句柄和不同 pool。异步工作前复制请求字段。注册强制
`requireSeparateGovernancePool: true`，不提供 `governanceDb`，不引入管理凭据或命令池回落。

canonical 查询失败不是零库存。provider 抛出 `CghComparisonQueryError`，保留既有
`PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE`、实际 HTTP code 和固定操作标签，不复制
响应 body 或数据库私有诊断。失败采集不生成 contribution／通过报告；未知抛错仍失败，
不改成 absent 或 value。成功可查询观察仍沿用 v1 格式和禁止推测去向的分类规则。

## 威胁与回归

| 风险 | 永久回归 |
| --- | --- |
| 错误 pool、facade、await 期间调用者替换请求 | 查询前拒绝，或继续使用已固定的真实 root |
| canonical 未就绪被当成 fresh 零库存 | 正式 router 实读 pointer 并拒绝，即使完整旧库存确为零 |
| 查询池意外获得治理写入 | 强制独立命令池、不提供治理 DB、Review GET 不激活惰性写入器 |
| definitions 使用假空 registration／usage | 正式投影查询；受限 reader 缺域权限时保持 unavailable |
| 安全修复丢失合法等价与 checksum 检查 | 36 项分类保留所有 family、实际 provider／aggregate／generator 和 CGH 序列化、顺序及阶段检查 |
| 拒绝后丢失旧源验证 | 测试专用完整旧源枚举、Review 全量分页、稳定 ID／计数／摘要及状态；其余十类贡献保留完整检查 |

专用纯路由测试使用真实签发 root 对象和正式生产 router。分类测试仅 mock CGH 的公开
GET 传输与领域 I/O，用来验证分类，不构成认证、数据库或 runtime 准入证据。新 PG 测试
使用既有 owned PG16 receipt／身份夹具、真实 compiler／installer 链和实际受限 LOGIN。
正向只证明 Catalog document；definitions 缺权限与 Review 拒绝分别记录。父协调者负责将
该文件纳入强制 owned lane 并执行；夹具拒绝 ambient DB、默认本地端口及未验证 Docker。

## 尚未闭合的工作

固定依赖中的正式 Review list/get 在读取时惰性 `INSERT`，GET 不是物理只读证明。
无命令池时正式组合拒绝 Review。本次保留该保护；仅读取已持久化 Review 的投影需由
所属领域独立实现，不复用惰性写入器、不追加 grant。

既有合成 `inventoryAuth`、仅首组织、definition item-count、分页和完整语义比较仍不属于
本分片。Policy usage 的固定零不关闭 #815。document 可读不等于 D01 比较成功、runtime
获批、P12/P13 或 populated 升级完成；本次不提供生产访问或发布批准。

文档影响为本中英文对及父协调者的比较证据记录。已有依赖与实现提交分开固定，不修改
migration、权限清单、parser、allowance、trusted baseline 或共享生产组合。
