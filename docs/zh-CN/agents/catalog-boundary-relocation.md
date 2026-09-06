# Catalog 边界记录的精确重定位

> English: [English](../../agents/catalog-boundary-relocation.md)

本项 #820／PR #821 修复保留 S0-ID 清单及其防替换身份。用户在获知精确 23 对失败后要求修复 CI，独立 Standards／Spec 就绪审查认可该限定实现授权；它不授权合并、Policy 契约变更、目标机操作或生产发布。历史未批准方案保持原样。

`e156215197f56f25cfb058ebde14c8506543646f` 的夹具修复使 `server/modules/parameter-specs/propertyKeyCutover.integration.test.ts` 中 23 个不变片段移动 216 个 UTF-8 字节和五行。周边源码确有变化，不能据此批准任意 SQL 等价替换。原 fixture 在 `9b3ba7df7e21f5589684bc92c872da593ad4c246` 上仍有 3519 条；当前 allowance 为 3513 条，保留此前六条删除。原 fixture 和 allowance 分片均不改写。

独立的[精确记录](../../../scripts/fixtures/parameter-catalog-allowlist/property-key-cutover-relocation.json)绑定完整旧 blob `dd0168f369b615f45eeb1e5539557fb63967e1dd`、目标 blob `1854772393388a8778b27594d2789b8635bfa3de`、原 fixture 摘要，以及每对完整旧新记录和原始片段摘要。完整记录的字节摘要在独立封存前审查后固化到验证器中。编辑 JSON 本身不能批准另一映射。

checker 先完成原有 fixture 完整性、显式基线祖先及 allowance 防增长检查，再核验全部映射、两份完整文件 blob、精确位置、原始字节一致性和不变权限元数据。旧 ID 必须仍在原清单及当前 allowance 中；目标必须是实际扫描发现；两边都不得重复使用，已绑定或未使用的映射拒绝。全部检查成功后才将这 23 个目标 ID 映射到原身份。报告保留历史身份记录，并在 `relocations` 中单独给出当前位置。

这是单份精确记录，不是通用位移或搜索规则。记录缺失／篡改、源码变化（包括未提交和后续改动）、映射缺项或跨文件替换均拒绝。其他扫描发现继续进入原比较逻辑；新增债务仍无 allowance，删除的债务不能由该入口恢复。后续合法修改需删除已迁移债务或另行完成明确身份审查；不得重新生成清单、按 SQL 等价推断、填充源码、换基线或停用检查。

验证命令为 `npm run test:scripts -- scripts/parameter-catalog-allowlist/exactRelocation.test.ts scripts/check-parameter-catalog-boundaries.test.ts`，以及 `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 35cbfb18e0504d6ccf16d2fc18c72a0d2da80391`。现有 inventory 断言保持不变，增加映射唯一性断言。实际命令、审查 SHA 和 Hosted checkout 证据记录在[交付计划](../exec-plans/active/2026-09-05-catalog-r2-delivery.md)中，文档本身不是 CI 证据。
