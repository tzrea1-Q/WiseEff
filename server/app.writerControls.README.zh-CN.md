# 应用 HTTP 写入口控制

English: [English](app.writerControls.README.md).

`buildWiseEffRouter` 记录现有应用组合根实际执行的注册调用。
`observeCatalogHttpWriterControls(router)` 通过私有 WeakMap 只接受原路由实例，
不接收调用者路由清单、handler 回调、批准布尔值、数据库 URL 或产物身份。

旧入口 owner 为现有 `legacyWriteRouteManifest` 直接注册固定 410 handler。
原退役注册过滤仍保留；其他 handler，包括合法新业务写和有界旧读，保持原行为。
投影包含退役入口的 ID、方法、路径，以及实际完整注册顺序与控制分类的摘要。
其他注册项只标记为本 HTTP 退役范围之外，不能据此认定它们是安全 writer。

观察拒绝复制的路由、被替换的派发或注册方法，以及构造完成后的追加注册。
每个退役模式必须实际存在；任何与它相交而未使用固定拒绝 handler 的注册均拒绝。
相交判断沿用路由的斜线分段、精确方法及冒号参数语法。该路由没有 catch-all，
星号是字面字符。即使竞争 handler 当前优先级更低，也保守拒绝。观察全程同步，
不会执行未知 handler 或访问数据库。返回记录为独立副本。

这只是 HTTP 子范围的 owner 观察，不是可独立导入的授权凭证。后续 P13 owner
必须从实际应用 owner 重新取得观察，并与经核验的候选产物、目标及数据库、身份等
其他必要控制绑定。本模块不生成产物摘要、全 writer 库存、P13 checkpoint、运行代次
或启动批准。数据库拒写不能代替冻结的用户可见 410；这份路由子清单也不能证明
数据库触发器、规则、Agent 或任务安全。

## 验证

公共测试面是实际 `buildWiseEffRouter` 返回值及其观察。首次固定 Red 为
`23309920b`（基线 `73f12a24e`），收集 42 项，41 通过，仅缺失 owner 接口失败。
原 38 项真实 HTTP 退役检查保持。后续 49 项覆盖复制路由、追加注册、替换派发及
返回副本隔离。提前注册的静态路径、异名参数及双斜线竞争夹具确实可被真实路由派发，
但观察会在调用未知 handler 前拒绝。这些注册夹具明确使用测试替身，不改生产注册。
星号用例验证真实字面匹配。既有测试在外部数据库池连接前截断，并要求退役请求查询和
checkout 均为零。本组不执行 PostgreSQL 或启动验证。

聚焦执行使用临时 Node 配置，仅收集 `server/app.catalogRetirement.test.ts`，
单 worker、空收集非零，无 global setup 或 setup files，并使用 `env -i`。
不能改用会准备数据库的通用 server 配置。严格定向 TypeScript 检查单独执行；
完整构建与 Hosted 验收由父任务在集成时负责。
