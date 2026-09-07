# 恢复点与切换前证据适配器

> English: [English](recoveryVerification.README.md)

`createControlledBoundaryEvidenceExecution` 将既有的
`PCAT-RP-RECOVERY-POINT` 与 `PCAT-WRITER-PRE-SWITCH-FENCE` 接到 S11-RP 包检查及
controller 的实时停写边界。这是 self-hosted controller 所有的调用适配器，不改变
gate registry、manifest、恢复 token、权限或批准语义。

管理组合根提供实际 journal／run／target、已签发的宿主锁、既有源身份观察器及停写
边界实现。适配器从真实 journal 读取已提交 capture，打开所记录的目录 inode，调用
`verifyRecoveryPackage` 检查全部包内容，再核对源、停写边界、锁和 journal。
checksum 相等不等于来源可信；必须匹配同一 run 受保护的 capture 记录。

每个 factory 只服务一次 pre-activation attempt。计划变化、重复 gate 执行、缺失
capture、包篡改、过期或丢失边界、目录替换和目标漂移不能生成可用于 assembly 的证据。
读取证据时重新核验输入，不回退到缓存的通过结果。证据绑定完整 pins、purpose、
lineage 和 subject；实际身份必须由源 producer 独立观察，测试 port 不代表部署停写。

适配器只检查，不采集、不恢复、不批准、不启动消费者、不切换代理，也尚不实现
post-retirement 验证。完整报告仍由既有领域服务 prepare／run／assemble，经真实且
彼此独立的 principal 批准后才可用于 P12。没有接受调用者 passed 字段的 CLI。

本文件测试使用真实私有包文件和宿主操作锁，源字节与停写 port 明确为单测夹具。
这些结果不是 PostgreSQL dump 恢复或完整三服务／P12 验收；父协调者仍需组合真实
源与停写 producer 取得该层证据。

文档影响为本双文件、既有升级计划／证据及终端手册。父协调者独占此适配器与测试；
storage 检查／执行、activation SQL、report core 与 migration 保持各自所有权。
此 R3 增量封存前仍须独立 Standards／Spec 审查。
