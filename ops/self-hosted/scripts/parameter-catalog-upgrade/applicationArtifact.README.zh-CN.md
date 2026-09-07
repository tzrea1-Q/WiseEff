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
| 假发布身份 | producer 不创建 tag、不从镜像 tag/SHA 推导发布身份；投影必须显式选择指向捕获 commit 的现有 Git tag。验收命令仅在独立私有 Git 副本创建 synthetic-only refs，不授予发布批准。 |
| 失败误报成功 | 静态 typed 拒绝，不输出子进程原错；构建/导出失败不签发成功产物。 |

纯 OCI 检查接口不签发 authority；仅真实构建 owner 签发可投影的包。
单元 archive 只证明字节验证，独立真实构建用例必须证明实际配方与导出。
下述真实构建命令已在首个固定 builder 执行；后续 readback/mutation 增量需独立执行，
不重标历史结果。

首次单元调用因模块尚不存在而导入失败（一项 suite 失败、零用例收集）。随后十项
codec 测试通过，不是真实构建结果。另行获准的只读历史 `df0fa9c56` 应用镜像导出
产生 373,599,232 字节 OCI archive，包含 17 个 runnable layer。最初把 image ID
当作 config 的假设被 `OCI-CONFIG-MISMATCH` 拒绝；实际 `.Id` 与 `.Descriptor`
证实 loaded identity 为 index。区分三种身份后字节验证通过。这是能力观测，
不把历史构建改记为新候选，也不证明新构建 owner 已通过。

## 首次真实构建与永久入口

Builder `c95f31bac70a14abee4e55e08752e9cf2e6d623e`、tree
`a2d0d285a07d3c29cd746ac98311496372ba3ab1` 以现有配方构建精确跟踪 source
`a321084a5a2a97c037cfadb95a3b6177cabc2330`。实际 build、OCI save、全部 blob 校验
及 package 持久化退出零；缺少 release 身份只独立拒绝最终投影。
日志 `/tmp/upg824-application-build-c95.log` 的 SHA256 为
`d0231cd39b0b9c8a7ba56e49df2e47522b8bc1b65e1c3993b87b327f27c5bec9`。
应用 package digest 为 `sha256:d7b20b5acf16418cc10852222ac2cfc55a39f1b0941d37e95e0ec77ba01650c5`；
实际 loaded index 为 `sha256:95d39399aa2f107aa15bab33dcde5270bae245c12217c8ed50041f3ad55c597f`，
平台 image manifest 为 `sha256:7fc7d34adc9f76f2d5a930f21d0346ce49f99a4684d7b8d331b6064a7e66869f`，
config 为 `sha256:213ee4c0749a543cbfab7713e54a3fa7e699574d6a3740ac567f5da319079e45`，
平台为 `linux/arm64`。私有输出与新 nonce 镜像作为构建产物保留；未创建或启动容器/服务，
未 push registry、未发行 release、未连接生产、未授予 startup 准入。

独立审查发现首版存在两项来源缺口：解压的跟踪文件可在构建中变化；基础 tag 可
A→B→A，文件系统层相同而配置不同。因此历史成功不证明不可变源码/基础镜像来源。
修订 owner 捕获 Git archive stdout 为私有 Buffer（上限 256 MiB），仅把首个 FROM
解析为实际已保存 OCI 图的 digest，并将结果 tar 直接流入 BuildKit。额外外部 stage
和不支持的 Compose build 选项拒绝。包记录原/解析后 Dockerfile 字节及 hash、
source/context digest 与实际基础镜像图；明确解析后配方不等于 Git 原配方。
参与 hash 的同一 CA Buffer 通过专用进程环境 secret 传给 builder，不再重新打开
可变 CA 路径。既有 Dockerfile 证书安装策略不变。原生 tar 测试验证实际字节转换，
不冒充真实镜像构建。

后续真实 Git 反例证实未跟踪 `info/attributes` 能覆盖归档内容：18 收集、17 通过、
1 失败。现使用空 template 的全新 bare 对象视图，禁外部 attributes，并在身份与
archive 读取中禁 replacement objects；跟踪的 `.gitattributes` 仍生效。19 项 Green
另含真实 replacement-ref 反例。构建输出由 BuildKit 实际 metadata manifest/config
结果选定，再按不可变身份 inspect/save；nonce 输出 tag 仅作漂移检查，不作为构建
身份来源。修订后的真实构建结果仍待执行。

固定 `56f8e24fb` 真实命令在应用构建前以 `OCI-RUNNABLE-AMBIGUOUS-OR-MISSING`
停止：实际 Docker inspect 与保存的基础 config 都为 `linux/arm64/v8`，但调用者
丢失了 `Variant`。修复保留实际字段；永久 variant 用例同时拒绝被缩短的身份。
这是实际基础导出阶段失败，不是构建成功。

原 scripts suite 收集 `applicationArtifact.test.ts`。独立真实验收命令必须显式提供
源、独立实测 daemon、新私有输出目录，不以 opt-in skip 或零用例冒成功；目前尚未
注册 mandatory CI：

```sh
node --import tsx ops/self-hosted/scripts/parameter-catalog-upgrade/applicationArtifact.build.ts \
  "$REPOSITORY" "$SOURCE_SHA" "$OBSERVED_DAEMON_ID" "$PRIVATE_OUTPUT_PARENT" "$PUBLIC_API_BASE_URL"
```

可选第六参数为私有 build-network 数据文件。owner 要求基础镜像已有真实 repository
digest，核实际保存的 OCI 平台 manifest/config 图后以不可变 FROM 构建，不捏造基础
镜像身份。超时为 20 分钟；
中断时终止自有子进程组，部分产物保留但不签发，不自动重试构建。

`readApplicationArtifact` 重新核对此进程签发的 package/OCI 字节，不提供任意 JSON
导入签发句柄的入口。跨进程可信产物选择与正式 fixed-pins 集成仍由父负责。
最新真实命令还会修改新产物 manifest、要求 `PACKAGE-CHANGED`、恢复并 fsync 原字节
再复验；此增量晚于首轮真实构建。配套纯测试一度缺右括号，产生零收集与 TS1005；
修正后十五项纯测试和严格 targeted types 通过。以上均不提供 release tag，也不将
package digest 等同批准。修订真实命令还会在私有 Git 副本生成 synthetic-only tags，
证明六字段 pins 正向并拒绝指向其他 commit 的 tag；不改共享 refs、不发布 tag。
这些修订验收仍待新的真实构建。

当前本地只读能力观测为 Docker driver 与 containerd image store。
可消费 `docker image save` 实际提供的 OCI layout；若只有旧 archive 格式必须拒绝，
不能自行制造 distribution manifest。参见 [OCI layout 规范](https://github.com/opencontainers/image-spec/blob/main/image-layout.md)
和 [Docker exporter 限制](https://docs.docker.com/build/exporters/oci-docker/)。
