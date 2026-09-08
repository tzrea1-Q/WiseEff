# scripts 源锁测试调度

[English](source-lock-routing.README.md)

`npm run test:scripts` 先检查工作区链接，再通过 `test:scripts:source-lock`
运行完整四例 rehearsal source-lock 文件，最后按原有并发方式运行其他
scripts suites。普通 scripts 配置仅排除这一文件，避免再次并发遍历历史。
单独调用普通配置属于 focused 检查，不是完整 scripts 门禁。

`scripts-pgvector` 独占 runner 使用同样两个配置，按顺序启动独立子进程。
任一阶段失败即停止；两阶段共享原来的 15 分钟期限和 8 MiB 输出预算。
资源准入、私有目标 receipt 和清理保持不变。source-lock 阶段不连接
PostgreSQL，也不修改冻结源码、祖先检查、trusted baseline、断言或
60 秒测试超时。

Hosted `build-and-test` 执行 `npm run test:scripts`；L1 必需时，Merge bar
同时要求该 job 和既有独占组件 job 成功。跳过或取消 build 不能作为
source-lock 证据。专用配置只有一个 worker，关闭文件并行，设置
`passWithNoTests: false`；它收集完整文件，不包含测试名称过滤。

防范的缺口包括：两条路径都漏收冻结文件、只跑四例中的一例、重复并发
收集、首阶段失败后继续，以及 Hosted build 被跳过后仍放行。永久路由
回归检查实际命令列表并执行 Merge bar 程序。此次调度消除与其他 scripts
worker 的竞争；不消除 Git 历史增长成本，也不承诺未来容量。

文档影响限于本模块中英文伴随文件。主计划、生产证据与运维手册继续由
父协调者维护。不改变生产操作、Policy、grant 或发布批准。
