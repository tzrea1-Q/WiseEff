# 受控原始 DTS 预处理

> English: [Controlled original DTS preprocessing](../../developer/dts-preprocessing.md)

`dts-cpp/v1` 保留原始 UTF-8 成员、路径、BOM、换行和来源版本。通过真实 GNU CPP 支持字面路径 `#include`、随附头文件、对象/函数值宏与条件编译。原生 `/include/` 继续可用；启用 CPP 时必须独占一行。相对路径可以进入清单内的另一个目录。头文件是构建输入，不作为独立设备树声明解析。

固定合约使用 `tools/dts-toolchain/versions.json` 中固定摘要的官方 GCC 14.2.0 Linux/amd64 镜像、C17、UTF-8 输入输出、`C` locale、`-nostdinc`、`-undef` 和 `__DTS__=1`。搜索路径仅来自冻结清单，其他 define 来自原始成员。请求不能选择可执行文件、镜像或编译器参数。服务端适配独占一行的原生 include 与 DTS 的井号属性行；这些转换属于版本化合约，不会改写保存的源码。

预检覆盖所有成员，包括不生效的条件分支。计算生成的 include、外部文件、`#line`/数字行控制、`include_next`、pragma/嵌入、环境探测及易变时间/路径宏均被拒绝。不使用宿主 include 目录或网络输入。不支持的声明可以保留在可修正草稿中，但不能发布或应用。

每次操作将独立私有临时清单只读挂载到无网络、无持久日志、无 capabilities、禁止提权的容器中，限制八个 PID、512 MiB 内存及 swap 总量、五秒 CPU 硬限额及五秒原生墙钟期限。异步客户端单次最多十秒并限制 stdout/stderr，完整操作最多三十秒。输入限制为 128 个文件、每个成员 2 MiB、总量 16 MiB；include 最深 16 层；完整原始/语义展开各最多 32 MiB、100000 项声明。失败只清理该操作唯一命名的容器。每个 API 进程同时最多运行一个 CPP 操作；其他预处理操作收到可重试的繁忙冲突，健康检查及无关 API 请求继续响应。增加 API 进程属于运维容量配置。

适配器将仅处理指令的活动原始声明与展开声明比较，并核对授权冻结成员的原始行及精确 UTF-16 CST 范围。编译器行标记不能单独证明可写位置。生成声明的宏，以及同一原始出现位置在不同上下文展开为不同结果的情况，会被阻断。支持的值宏使用明确的 `expanded-v1` 来源模式：出现记录保留精确原始调用文本，语义 AST 与 `dts-cpp/v1` 输入/输出/工具回执作为派生证明。精确来源证明重新运行冻结合约。普通 DTS 的原有证明保持不变。CPP 配置不能经过旧式仿射属性写回；错误提供原始源码编辑器或项目本地覆盖的修正路径，整份源码审阅则使用完整清单。

共享发布、项目解析/摄入、源码审阅、Catalog 项目值同步、原生编译、原始源码导出/重导入及项目复制初始化消费同一合约。资源发布不会创建 Catalog 定义或改变项目。导出的权威内容仍是原始源码，生成文本不能替代它。

本地或 CI 环境先启动能够实施内存、swap 和 PID 限额的 Docker Engine，再执行 `npm run dts:toolchain:bootstrap` 和 `npm run dts:toolchain:check -- --required`。只有 bootstrap 拉取固定镜像，请求使用 `--pull=never`。API 需要明确配置的可用沙箱；缺少此能力的部署容器报告 CPP 不可用，普通 DTS 继续可用。本功能不授权向既有部署挂载 Docker socket 或变更生产基础设施。

原生语法与来源验证位于 `server/modules/dts/cppSources.test.ts`；真实 API 角色发布/整份源码审阅、PostgreSQL 精确证明和原生 DTB 等价性扩展现有 owner 测试。浏览器验证扩展 `shared-dtsi-publication.acceptance.spec.ts`。工具可用或历史运行不能充当当前验收。

参考：[GNU 预处理选项](https://gcc.gnu.org/onlinedocs/gcc/Preprocessor-Options.html)、[Docker 资源限制](https://docs.docker.com/engine/containers/resource_constraints/)、[Docker run 限制](https://docs.docker.com/reference/cli/docker/container/run/)。
