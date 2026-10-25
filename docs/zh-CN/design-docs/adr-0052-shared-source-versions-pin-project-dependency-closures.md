# ADR-0052：共享源码版本固定完整项目依赖闭包

> 英文：[English](../../adr/0052-shared-source-versions-pin-project-dependency-closures.md)

日期：2026-10-25

## 状态

这是 [#1410](https://github.com/tzrea1-Q/WiseEff/issues/1410) 已确认的实现架构，由 #1417 扩展。记录共享源码边界，不改变 ADR-0040、ADR-0043 或 ADR-0046。

组织拥有稳定的共享源码资源及不可变发布修订。每个修订保留自身原始成员，并固定依赖的精确修订 ID 和相对挂载目录。发布检查并冻结有界无环的完整闭包、原始校验和与 include 图；不求解版本范围，也不从网络获取源码。同一资源经不同路径选中不同版本或挂载位置、来源路径或标签碰撞、缺少必需文件时，阻止发布或项目组合。不完整草稿继续保留并可编辑。

项目组成通过现有 canonical 成员加入预览与应用事务消费完整且已授权的闭包。每个项目派生自身不可变来源行；同一项目内精确匹配的重复依赖可复用已有固定引用。引用身份来自资源、修订与成员 ID，不从文件名或哈希推断。冻结既有 include 搜索与 overlay 顺序；新增共享 include 放在既有共享 include 之后、私有声明之前。全部派生来源版本和私有根文件修改必须由一份精确冻结凭据证明，保留私有 JSON、来源 occurrence、Binding 连续性和历史。普通来源写入不能编辑或断开共享快照。

账号删除断开实时 actor 引用，同时保留已批准的组成与转换回执。引用替换或恢复私有归属后，历史复核使用准确的已应用修订清单、上游成员字节与原始导入证据。首次应用仍须验证当前引用，保留的回执与源码继续不可变。

共享发布不修改项目，也不写入 Catalog 定义。[ADR-0040](adr-0040-canonical-parameter-catalog-relational-model.md) 与 [ADR-0043](adr-0043-catalog-authoring-and-online-publication.md) 的唯一 Catalog 同步器保持所有权；[ADR-0046](adr-0046-source-occurrence-identity-spans-dts-and-software-configuration.md) 的来源身份与原点转移证明保持不变。直接和间接项目引用查询按当前授权过滤行与总数。头文件是原始构建输入，不是独立 DTS 声明，由确定性预处理解释。引用版本变更与完整项目快照恢复继续作为不同的受治理操作。
