# 应用构建产物生产

English: [English](applicationArtifact.README.md)。

本有界构建 owner 复用现有 Compose/Dockerfile 配方生成本地应用包。
依赖 `a321084a5a2a97c037cfadb95a3b6177cabc2330`；Scratch 从 main 建立后
快进至该候选。不发行 release/tag、不 push 镜像、不启动服务、不批准升级。
缺少发布身份仅阻止最终 Verification 投影。

## R3 威胁与验收接口

| 威胁 | 必需观测 / 拒绝 |
| --- | --- |
| COPY 吸收未跟踪私有文件 | 仅构建精确 Git commit 的 archive，包含跟踪的 Dockerfile 与 Compose 配方。 |
| image ID 冒充 manifest | 从实际镜像导出中读 OCI index/manifest/config 原始 blob，验证原始字节 hash 和 descriptor size；旧 Docker save manifest 不足。 |
| 平台或加载镜像不同 | runnable descriptor、config 平台、源 SHA/tree 标签和经过认证的 index/manifest/config 图中实际 loaded identity 一致；歧义拒绝。 |
| 可变或残缺包 | 持有 archive FD，拒绝重复/link/越界成员，核所有引用 layer，返回前确认文件未漂移；独占持久 manifest 并 fsync。 |
| 伪造构建信任 | 实际调用既有 build-network prepare/require_verified 和构建，绑定策略/CA 指纹与跟踪配方材料；配置证据不是企业网络证明。 |
| 远程 daemon / ambient 秘密 | 复用 isolated Docker endpoint/daemon 复核，不改全局 builder/context；仅传构建 allowlist，不读取运行 .env。 |
| 假发布身份 | 不创建 tag，不从镜像 tag/SHA 推导发布身份；最终投影必须显式选择指向捕获 commit 的现有 Git tag，此为身份而非批准。 |
| 失败误报成功 | 静态 typed 拒绝，不输出子进程原错；构建/导出失败不签发成功产物。 |

纯 OCI 检查接口不签发 authority；仅真实构建 owner 签发可投影的包。
单元 archive 只证明字节验证，独立真实构建用例必须证明实际配方与导出。
本新模块尚未执行真实 OCI 构建。

首次单元调用因模块尚不存在而导入失败（一项 suite 失败、零用例收集）。随后十项
codec 测试通过，不是真实构建结果。另行获准的只读历史 `df0fa9c56` 应用镜像导出
产生 373,599,232 字节 OCI archive，包含 17 个 runnable layer。最初把 image ID
当作 config 的假设被 `OCI-CONFIG-MISMATCH` 拒绝；实际 `.Id` 与 `.Descriptor`
证实 loaded identity 为 index。区分三种身份后字节验证通过。这是能力观测，
不把历史构建改记为新候选，也不证明新构建 owner 已通过。

当前本地只读能力观测为 Docker driver 与 containerd image store。
可消费 `docker image save` 实际提供的 OCI layout；若只有旧 archive 格式必须拒绝，
不能自行制造 distribution manifest。参见 [OCI layout 规范](https://github.com/opencontainers/image-spec/blob/main/image-layout.md)
和 [Docker exporter 限制](https://docs.docker.com/build/exporters/oci-docker/)。
