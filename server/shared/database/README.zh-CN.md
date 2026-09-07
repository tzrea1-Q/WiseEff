# 数据库根连接与借出核验

English: [English](README.md).

`createPostgresDatabase` 拥有 PostgreSQL pool，返回带真实品牌标记的
`RootDatabase`。根事务负责 BEGIN/COMMIT，嵌套事务使用 savepoint。
`createDatabase` 与 `createSavepointDatabase` 包装单个 session，不能接收 pool。
Catalog Kernel 继续通过 `getRootPostgresPool` 取得实际根 pool，并拥有自身只读事务。

可选构造参数 `verifyCheckout(session)` 在每次借出实际连接时执行，覆盖根查询、
根事务、raw pool 的 promise/callback 借出及 query。它在连接暴露给调用者前
完成；session 只提供 query。观察器必须完成探测并释放探测锁，不开启调用者事务，
也不能递归借用同一 pool。核验拒绝会销毁连接并保留原错误；等待期间不执行调用者
语句。成功后连接按原规则交给调用者，调用者仍负责正常释放。观察器应自行限制执行
时间，此 hook 不扩展超时。

异步核验期间 pool 持有临时连接错误监听器。断线以固定诊断拒绝借出，连接只销毁
一次，未完成的观察器不能再执行探测 SQL。先发生的准入错误保留原对象；非 Error
拒绝值转换为固定错误，避免 pg callback 将假值解释为成功。销毁连接的监听器保留
到 end；成功借出的连接移交时移除该临时监听器。

hook 不授予数据库权限，也不作发布决定，只由服务端组合根配置。activation owner
用它将 Kernel 实际使用的连接绑定到独立观测的物理目标；在另一条连接上前后探测
并不足够。真实证据及漂移核验仍由 owner 负责。不向 Kernel 外传事务，不增加私有
接口。未配置此参数的 pool 保持原行为；启动报告批准仍为独立操作。

`verifiedCheckout.test.ts` 使用受控 pool 测试分派和生命周期，不是 PostgreSQL
或部署身份验收。真实目标观察及受限登录 Kernel 验收属于 activation／reader
通道，执行记录进入存量升级证据文档。
