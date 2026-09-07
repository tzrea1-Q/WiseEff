# 应用产物选择的持久保存

English: [English](applicationArtifactCustody.README.md)。

依赖 `a557e6886`。本 owner 将实际应用构建绑定到已初始化的 host journal，不初始化
run、不推断 cutover plan、不发行 release、不重建 P13、不授予 startup 权限。产物
生产先于 handoff；根稍后创建 handoff 时将返回的源码/镜像事实与实际候选比对。
旧 source 身份仍由既有根负责。

## R3 实现边界

| 威胁 | 必需行为 / 永久反例 |
| --- | --- |
| 调用者 JSON 冒充构建来源 | 仅 owner 实际调用 builder 与 pins 投影后保留；原始文件检查 lease 仅只读，不是 issued artifact。 |
| 错 run 或锁 | 必需既有 settled journal、直接父目录 issued host lock、原 canonical 私有目录及全记录 CAS。 |
| 构建/receipt/journal 持久化期间进程退出 | 实际构建前 pending；receipt fsync 后才 committed；pending/unknown 不得成功 reopen 或自动重建。 |
| await 期间源码或包变化 | 持全部 source/config/package/OCI FD 及两个目录身份；边界检查和读前后复核原命名身份与 hash。 |
| 伪造/部分 receipt 或父目录被换 | 仅从同 run committed event 选择精确原 receipt；私有普通单链接文件与原目录/文件身份必须匹配。 |
| tag 可变或借用身份 | 固定并重读实际物理 Git tag object/commit，禁 replacement objects；首次构建效果前记录 producer code SHA/tree 与 source。 |
| 误报全链完成 | 仅返回 artifact pins/source/image 事实，不虚构 runtime generation、旧 writer 完整库存或批准。 |

信任边界沿用可信同 UID 私有 custodian 和 host journal。这是实际 producer 输出的
持久化，不新增签名 authority；能替换全部私有状态的恶意 custodian 不在既有防护
承诺中。开发夹具不能报告为获批构建或完整 controller。真实重启验收须由独立进程
重开同一产物，不再构建。

## 根接口与证据

`produceApplicationArtifactSelection({journal, lock, build, releaseTag})` 实际
调用既有 builder。`build` 沿用其输入，但 `outputParent` 固定为原 journal 目录。
构建前固定物理 source commit/tag 和干净 controller SHA/tree，实际 controller
文件须与 Git blob 一致。支持直接 loose tag 和直接 packed tag，拒绝 symbolic
tag；持原 tag FD 穿过最后宿主锁 await，此后不再启动 Git 子进程。build-network
配置必须是同 owner 的私有文件。

原 request/receipt 文件身份（device/inode、纳秒时间、owner、mode、size）与字节
摘要共同进入 journal CAS；替换文件即使字节相同也不能重开。custody 在 receipt
之前对每个必需材料显式 fsync，包括 Buildx metadata。原始文件检查器仍只读，
不能发行 build handle。每次同步 mkdir、写入与 commit 前均有实际宿主边界检查。

`reopenApplicationArtifactSelection({journal, lock})` 返回相同的
`selection.observe()` 接口，不重新构建。每次 observe 自行持有并在返回前释放全部
FD，selection 没有 `close()` 义务；原始检查 lease 则须单独 `close()`。journal
初始化和正式 `upgrade.sh` 入口仍由根负责。

50 个聚焦测试包括 24 个 artifact/native Git/tar/raw-FD 用例和 26 个宿主持久化
用例。后者使用真实私有文件、native Git 和 issued OS lock，但 build/OCI owner
明确使用替身。实际 holder 在写 request 前的 Git 窗口被杀，随后不写 request，
也不构建；实际材料 FD 的 fsync 故障禁止 committed。这些不算真实应用构建验收。
同字节 receipt 替换和 native symbolic tag 各先使新增反例失败，再修复通过。
最初缺模块运行是收集失败，不计行为 Red。严格聚焦类型和原 trusted boundary
单独核验。后续 `73f12a24e` 已通过正式 init／prepare 及独立进程inspect同一真实包。
`3cee9f235` 的永久终端验收实际构建同一源码、独立读回并拒绝错误输入／材料变化。
最后的负测run故意不可复用，此前成功包单独保留。精确执行身份与hash见现有存量升级证据。

```sh
node_modules/.bin/vitest run --config vitest.scripts.config.ts ops/self-hosted/scripts/parameter-catalog-upgrade/applicationArtifact.test.ts ops/self-hosted/scripts/parameter-catalog-upgrade/applicationArtifactCustody.test.ts
```
