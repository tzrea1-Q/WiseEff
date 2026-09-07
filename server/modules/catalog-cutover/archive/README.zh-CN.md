# 不可变 Archive 适配器

> English: [English](README.md)

[已接受的 Archive 合同](../../../../docs/zh-CN/design-docs/parameter-catalog-cutover-archive-rollback.md)
要求身份元数据保留源的归属，并加密保存源 payload。`persistArchive` 与
`persistEvidenceArchive` 共用同一持久路径，都不向普通读取者开放源 payload。
本修复不改 schema、权限、归档格式、分类或公开接口。

## 经核验的 owner 元数据与明文保护

组织源行含组织 ID，Archive 元数据必须保留同一个 owner ID。如果把每个较长
源字符串都视为所有元数据列的禁用内容，就会误拒绝这个必需的身份投影。
原组织测试使用短 ID，且 source payload 没有组织字段，未覆盖该形态。

本次限定修正保留全部明文 needle；加密对象仍与全部 needle 比对。任何写入前，
适配器须读取真实 `legacy_identities` 行，精确比对请求的 owner kind 和 ID。
仅 `owner_scope_id` 身份列采用这个经核验的值，不按 payload 子串拒绝。
其余元数据维持原完整扫描：owner ID 若被复制进 reason 或 audit，仍然拒绝。
没有全局字符串豁免、调用者 allow-list 或私密值分类猜测。checksum、认证加密
与受权还原仍保留完整原始源图。

永久 PostgreSQL 用例通过既有适配器接口和 owned `bindings-pg16` lane 执行，
覆盖真实 UUID owner 组织源、实际源读回及受权往返、owner/checksum 元数据保持、
密文不含 owner/源字节、reason 和 audit 引用复制 owner/秘密，以及伪造 owner。
拒绝必须不留下新的 Archive 行或对象；原八项威胁矩阵和测试保持。

此前 custody transport 的准备流程到达 P7 并暴露此问题；平台形态的临时替代
不证明组织归档成功。本适配器的新 Red/Green 是独立证据，不代表获批 P12、
完整 controller 切换、恢复就绪或生产授权。

实际 owned PG16 Red `4bf7a876631c6de82c193119c7de79b14a3830ed` 执行
现有九文件 `bindings-pg16` suite：收集 98、通过 96、失败 2，70.32 秒。
两项失败分别是合法长 owner 归档及伪造 owner 应优先身份拒绝的错误码。
Green `82bf84d50b6e06097e3845d79124dbe1de8f18eb` 全部 98 通过，69.87 秒，
包括 Archive 的全部 24 项 PostgreSQL 用例和七项纯测试。两轮均核验自有
资源清理成功；profile 为 Linux/arm64 的 `postgres:16-alpine`，镜像
`sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229`。
原超时与八项威胁矩阵均未更改。

日志 `/tmp/pr824-archive-owner-red.log` 和
`/tmp/pr824-archive-owner-green.log` 的 SHA-256 分别为
`b380f3904291241fc564cab392403d180499ad11e567851018ab0e463eefdad0`、
`c0afa125b151e43bec5b482aaba7b6066172cde4610ec9b1f36d48f3cf7d592a`。
这些是本地精确 checkout 的观察，不是后续本次文档更新的执行或 Hosted 验收。
