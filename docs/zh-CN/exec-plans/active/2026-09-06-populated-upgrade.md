# 存量 self-hosted 升级兼容修复

> English: [English](../../../exec-plans/active/2026-09-06-populated-upgrade.md)

## 范围与状态

PREFLIGHT，风险 R3。源部署始终为 `82344044b436a8dafecefbb85dfd724cecb05e3f`；重新 fetch 的开发基线为 `origin/main@1c9fa56e3eaca6e7984f35a097876772a6e4025d`，与用户提供的 main 无差异。源计数和镜像身份仅为用户提供的历史观察。本地独立干净工作树使用 `codex/populated-upgrade-scratch`。本轮止于审阅候选／PR，不合并、不关闭历史单、不批准发布、不访问生产。

## 文件所有权与依赖

| 包 | 所有者与范围 | 依赖与成功条件 |
| --- | --- | --- |
| A | 父协调者：双语计划、证据、操作手册 | 实现前冻结威胁矩阵，独立 Spec 挑战 |
| B | 父协调者：reconcile CLI、升级 shell、交接工具与测试 | 真实旧调用失败关闭；诊断不作为发布批准 |
| C | 父协调者：verifier/controller 接线 | B、角色与恢复合同；保留 unavailable 边界 |
| D | 身份／恢复 lane，先只读审计运行根与角色 | 编辑前明确交接；真实受限登录验证 |
| E | 身份／恢复 lane，先只读审计恢复模块 | 隔离三存储证据，不充当目标证据 |
| F | 构建 lane：build-network 专用工具与测试 | 复用现有策略，合成证书与企业 CA 分开 |
| G | 父协调者：预演、文档、完整文件交付包 | A-F；真实备份和生产批准为外部依赖 |

升级 shell、Compose、运行时组合根、migration、生成文档和 fingerprint 各由父协调者单一写入。保留其他工作树。共享 schema 开发 WIP 为 2；不重叠的构建工作可并行。固定候选后并行 Standards／Spec 审查；集成就绪后运行一次最终 Hosted，不反复跑广域测试。

## 威胁矩阵

| 威胁 | 必需观察／责任 |
| --- | --- |
| 缺参数、absent、未批准、blocked、未知参数 | 真实 CLI 非零 typed 拒绝，B |
| 旧升级器调用新检查 | 不因诊断成功恢复流量，B |
| 跨候选／目标／release／mapping／source、旧 purpose／attempt | 复用 verifier 精确核验，B/C |
| 预激活批准借用于运行或公开发布、伪造批准 | 各动作独立拒绝，C |
| apply/resume/recover-candidate/no-op 绕过 | 所有可达放流路径有门禁；旧服务恢复分开，B |
| 缺阶段、乱序、并发、未知提交结果 | journal／锁拒绝，不重置或猜测，C |
| 假 fresh、部分迁移成功、checksum 漂移 | 完整库存识别；历史 SQL 不变；重试证据，G |
| 超级用户、继承／DEFINER 提权 | 真实受限登录正向与反向 PG，D |
| 错数据库／主机／Compose／卷／桶／Redis、部分恢复 | 保持隔离，仅显式绑定恢复，E |
| 写入／投递／公开流量之后指针回退 | 持久拒绝，E |
| 不可信／过期／错误证书、insecure 就绪 | 拒绝；受信合成链成功且无秘密泄漏，F |
| 值／历史／受保护引用丢失、未知 Policy 被算零 | 全量分类与独立 oracle，不用计数相等替代，G |
| pgvector lane 被当成源数据库镜像兼容 | 单独扩展兼容证据，G |

## 测试层次与停止边界

先 Red 后 focused Green；真实子进程退出码、PG 迁移／角色、隔离 Compose 顺序、合成存量语义、build／contract／boundary／selfhost／docs。可见改动按 playwright-cli 三种视口验证。各次执行记录精确 SHA/tree、命令、退出码和收集／通过／失败／跳过，setup 失败不算零用例通过。A 合成、B 授权真实备份副本、C 生产分别记录。

尚无授权真实备份、企业 CA 或生产窗口批准。#815 仍需权威关联或明确批准 unavailable 合同。冻结阶段若 unavailable，记录缺失集成，不伪造实现或批准；继续独立工作。

## 文档影响矩阵

| 改动 | 英文 | 中文 | 门禁 |
| --- | --- | --- | --- |
| 范围／威胁／证据 | 英文计划 | 本计划 | docs:check |
| 升级／诊断／交接 | upgrade.md | upgrade.zh-CN.md | CLI 回归与 docs |
| 运维步骤 | 新存量升级 runbook | 中文终端手册 | 仅引用真实测试入口；缺失步骤明确标记 |
| 构建信任 | 现有构建文档按需更新 | 对应伴随文件 | 证书反例 |

## 文档更新门禁

双语同批更新，生成器更新生成产物。完成前运行 `npm run docs:check`；独立交付和限制记录完成前计划保持 active，代码完成不推出生产就绪。
