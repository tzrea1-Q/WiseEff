# Catalog 边界记录的精确重定位

> English: [English](../../agents/catalog-boundary-relocation.md)

## D-A：自然修复knowledge审计测试

用户独立批准自然修复 `009ce086a3050ce555806394463bb8d179c70fbb` 直接产生的三对
身份重定位。测试在移除前观察add，并在两种合法时间戳并列顺序下核对完整审计内容；
不改变生产审计行为，也不借用下文23对授权。

独立 `knowledge-audit-relocation.json` 绑定文件
`server/modules/knowledge/parameterReferences.test.ts`、完整旧blob
`79c7bdf5cd4535d5d340e546a0037080ebae8c9b`、新blob
`e019e246ea36a9ced4a70b572bc4c03d22eaad0b` 及三段未变切片。
365／384／423行移到376／395／434行，均为+1017 UTF-8字节、+11行。
记录SHA256为 `3b10d26e362a35676d0f6d352e43d1085aca41769507ac331f222fc8fe539e1a`。
封定前由父与独立审查者核验完整blob、原始切片hash、权限元数据和唯一配对。

既有验证器仅接受两个封闭、固定的记录：原23对和本次3对。原fixture／allowance数量及
trusted base不变。第四对、未来blob、切片／权限变化、重复映射或缺失扫描结果均拒绝，
记录不能自行批准自身。这不是通用位移规则，也不授权通过保持布局规避扫描。

## 之前23对授权

本项 #820／PR #821 修复保留 S0-ID 清单及其防替换身份。用户在获知精确 23 对失败后要求修复 CI，独立 Standards／Spec 就绪审查认可该限定实现授权；它不授权合并、Policy 契约变更、目标机操作或生产发布。历史未批准方案保持原样。

`e156215197f56f25cfb058ebde14c8506543646f` 的夹具修复使 `server/modules/parameter-specs/propertyKeyCutover.integration.test.ts` 中 23 个不变片段移动 216 个 UTF-8 字节和五行。周边源码确有变化，不能据此批准任意 SQL 等价替换。原 fixture 在 `9b3ba7df7e21f5589684bc92c872da593ad4c246` 上仍有 3519 条；当前 allowance 为 3513 条，保留此前六条删除。原 fixture 和 allowance 分片均不改写。

独立的[精确记录](../../../scripts/fixtures/parameter-catalog-allowlist/property-key-cutover-relocation.json)绑定完整旧 blob `dd0168f369b615f45eeb1e5539557fb63967e1dd`、目标 blob `1854772393388a8778b27594d2789b8635bfa3de`、原 fixture 摘要，以及每对完整旧新记录和原始片段摘要。完整记录的字节摘要在独立封存前审查后固化到验证器中。编辑 JSON 本身不能批准另一映射。

checker 先完成原有 fixture 完整性、显式基线祖先及 allowance 防增长检查，再核验全部映射、两份完整文件 blob、精确位置、原始字节一致性和不变权限元数据。旧 ID 必须仍在原清单及当前 allowance 中；目标必须是实际扫描发现；两边都不得重复使用，已绑定或未使用的映射拒绝。全部检查成功后才将这 23 个目标 ID 映射到原身份。报告保留历史身份记录，并在 `relocations` 中单独给出当前位置。

这是单份精确记录，不是通用位移或搜索规则。记录缺失／篡改、源码变化（包括未提交和后续改动）、映射缺项或跨文件替换均拒绝。其他扫描发现继续进入原比较逻辑；新增债务仍无 allowance，删除的债务不能由该入口恢复。后续合法修改需删除已迁移债务或另行完成明确身份审查；不得重新生成清单、按 SQL 等价推断、填充源码、换基线或停用检查。

验证命令为 `npm run test:scripts -- scripts/parameter-catalog-allowlist/exactRelocation.test.ts scripts/check-parameter-catalog-boundaries.test.ts`，以及 `npm run parameter-catalog-boundaries:check -- --trusted-base-sha 35cbfb18e0504d6ccf16d2fc18c72a0d2da80391`。现有 inventory 断言保持不变，增加映射唯一性断言。实际命令、审查 SHA 和 Hosted checkout 证据记录在[交付计划](../exec-plans/active/2026-09-05-catalog-r2-delivery.md)中，文档本身不是 CI 证据。
