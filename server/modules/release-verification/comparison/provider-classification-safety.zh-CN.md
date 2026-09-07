# 不推断去向的 provider 分类

[English](provider-classification-safety.md)

既有 P11 合同要求声明差异必须有不可变计划中的完整规则和逐身份实际 mapping 证据。
DTO 不同、旧路由退休、typed block 或报告不存在都不能提供这种证据。

此前十一个正式比较 provider 根据 D ID 或 fallback 构造 R1/R2/R9，有时以共享
mapping-head ID 冒充 Definition/Archive ID。本修复删除这些推断：

- 两侧 value 经既有规范键排序相等：`exact-equivalent`，无声明差异证据。
- 任一侧 query-failure，包括未知 failure code：`unqueryable/protected-reference-missing`，
  保留原观察，不造去向。
- 其余情况：`unexplained-difference`，无声明差异证据。

PRJ、DBG 与其余九类一致返回已有的 typed 阻塞结果，使完整库存和 checksum 可检查。
正式 `generateComparisonReport` 仍拒绝所有 unexplained/unqueryable；provider/aggregate
Promise 成功返回不是验证成功。PRJ/DBG 的实际消费者是正式 provider registry 和 aggregate，
发布集成仍须经过原 report generator 与适用批准门禁。本分片不改 verifier、parser、codec、
gate ID、grant、migration、已批准规则或冻结的声明差异格式。

## 范围与威胁矩阵

| 边界 | 永久回归 |
| --- | --- |
| CGH/TOP/PRJ/FIL/AGT/LOG/DBG/DTS/KNW/MOD/OPS 造去向 | 正式 `provide*` 入口接收不等的合成领域/数据库观察，各例为 unexplained 且 evidence 为 null |
| 未知查询状态变成 R 分类 | HTTP 503 和未知 PRJ query-failure code 阻塞，其他类覆盖真实 query-failure 包装 |
| 合法等价误被禁止 | PRJ 包含 null 和 revision-selection 的等价字段、CGH 等价旧路由结果继续 exact |
| contribution 返回被当成 passed | 实际十一 provider aggregate 保留 unexplained，实际 report generator 拒绝 |
| 库存失败冒充空源 | 每个 provider 传播明确库存错误 |

`providerClassificationSafety.test.ts` 仅 mock 既有 I/O/领域读端口，没有摘取私有 classifier、
替换 provider 或提供 passed 报告。这是纯分类回归，不是认证 PostgreSQL、转换、P12/P13、
应用启动或完整升级证据。普通 server suite 会收集该测试；开发时可用临时无数据库 config
独立执行，避免启动共享数据库。

既有十一组真实 PG provider tests 保留库存、排序、独立 pre/post 采集、checksum 和唯一性
检查。DBG 原本要求未绑定合成夹具永不 unexplained 的错误断言，改为明确禁止伪造 declared
及 evidence 必须 null；不改成 skip 或 passed 发布报告。

十一类真实 PG 集成测试同样先完整采集 populated 的两个阶段，保留每个 family 的库存
计数、checksum、case 顺序和引用覆盖；不再假定这个夹具能够生成通过报告。
CGH 当前正式 comparison readiness 端口执行 `SELECT 1` 后返回 `not-ready`，
实际 Catalog read handler 因而在加载 Kernel snapshot 前返回 HTTP 503。原观察为
`query-failure`、code `503`、detail `catalog-read-list-definitions`。
未修改的 parser 用 `PCAT-CMP-UNQUERYABLE-PROTECTED-REFERENCE` 拒绝它；测试同时核对
原始观察、直接 aggregate 和 live aggregate 入口的拒绝，不改错误码来换取解析成功，
也不生成通过报告。

共享的 checksum 锁定 populated 夹具没有 Review task。本集成测试只在自己的独立数据库
通过既有 Review repository 补入一条 open 和一条 dismissed 的旧 schema task，均关联
实际合成 organization、project 和 config revision。两个阶段都必须清点两条 D06 身份，
并保留各自状态及 source evidence。原来的九行 report gate 允许零 case；现在明确补齐
九类实际比较夹具覆盖，不修改共享 seed、历史计数、源夹具 checksum 或 Review 批准流程。

该 readiness 端口仍需实际受控的 readiness producer，这是内部集成缺口，与生产备份
是否提供、逐身份证据格式及 S6 决策分别记录。不能把数据库探针成功直接改为 ready。

本分片只修安全分类。合法声明差异及 populated 正向闭环仍依赖独立记录的逐身份证据格式
和 producer 工作，不能由全部拒绝或 fresh/query-failure 组件测试关闭。#815 不变。

文档影响仅本中英文对；父协调者负责主计划/证据、独立审查和最终集成验证。
