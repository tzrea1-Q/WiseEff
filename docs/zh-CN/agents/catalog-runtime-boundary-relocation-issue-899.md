# Issue #899 Catalog 边界后继映射

> English: [English](../../agents/catalog-runtime-boundary-relocation-issue-899.md)

Issue #899 移动了六个文件中的 Catalog 边界观察。固定后继记录将 trusted base 中未改变的原始切片绑定到候选提交 `683297cfc4d66bd474446c346dbc212d28d7c1a8` 的精确 blob：

| 文件 | 对数 | Trusted-base blob | 候选 blob |
| --- | ---: | --- | --- |
| `server/modules/parameter-topology/schemas.ts` | 3 | `4e10ae4b663012ac0fec7b611db828c508569555` | `031779ff8777ffc761d2206b26f4a883484e769b` |
| `src/infrastructure/http/parameterTopologyClient.test.ts` | 24 | `0354e7aac348d2a8230509d065290bd48b922992` | `1f1771f3f8bd067c52b179b92504cf2bb5d53c45` |
| `src/infrastructure/http/parameterTopologyClient.ts` | 32 | `da08b196f95ea9610cb182d620288a15457b4244` | `d65904e0bc725ad8d8af314f3ecd8a720da79fb4` |
| `server/modules/parameter-topology/bindingService.ts` | 58 | `71a5646171a3b92127ebf82b87c6d7c63a360eea` | `9455d3c90e3a683d5fc501664745158daa1540c7` |
| `server/modules/parameter-topology/service.ts` | 14 | `03b396d3b1f42da5070a50d57d20aeed5619ea4c` | `bd81b64d432f92406c93cfdac0d884d81be00ffc` |
| `server/modules/parameter-topology/service.test.ts` | 2 | `5b0707835772615d39cae671d18a195672d04089` | `67f9db5a1253d8f2981acbcee95293669c4cd614` |

[固定 133 对后继记录](../../../scripts/fixtures/parameter-catalog-allowlist/issue-911-boundary-successor-relocation.json) 的 SHA256 为 `f187dc3f6ed3ea56cc81e915c6686a3ec0c7d52eb1031c380968ec4a93d3ef49`。它保留原 fixture、trusted base、allowlist 和此前所有记录，不新增 allowance。每一对都在返回别名前校验精确观察元数据、稳定锚点与字节顺序、raw slice 摘要，以及完整源和目标 blob。

较早的 [source-workflow 记录](../../../scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json) 固定为 82 对，SHA256 为 `b998321716d00d58ea83b03cd283a52bafb40ac40437549ee453e7153c83742c`。[consumer 记录](../../../scripts/fixtures/parameter-catalog-allowlist/source-workflow-consumer-relocation.json) 固定为 237 对，SHA256 为 `97f3190a80d0800fac88b6d3d5b60897ed24312ef056bdc59e2099dfa6e712a9`。两份完整记录只在 main commit `47a67562df2920d804ea6ca0f27b84e024ff2ac4`、tree `3ff4fd6a2a1a212465b9eeea92df86f3c6b09312` 上作 proof-only 验证；证明检查固定摘要、每个源/目标 blob 和每条映射。未变部分的当前别名继续严格验证：source-workflow 79 对、consumer 183 对。后继记录为六个变更文件提供当前别名。

后继记录含 133 个互不重复的源 ID 和 133 个互不重复的目标。源 ID 与固定 source-workflow 记录重合 3 条，与 consumer 记录重合 54 条。其余 76 条由三个 topology service 文件中的 74 个位移观察，以及原 `s12-top.json` fixture 的两个观察组成：`S12-TOP:legacy-parameter-spec-identifier:2f10fffcedb520cb:a7946cfaf2b74e70` 和 `S12-TOP:legacy-parameter-spec-identifier:4c7221a2d9f1a7bc:cd5b4f01bf89b99f`。fixture 中的两条观察仍被逐条要求。历史记录不重写，也不用于授权新的当前身份。

缺失、重复、已绑定或跨记录端点、记录变更、完整文件漂移、allowance 增长、同锚点映射交换及新出现的债务都会 fail closed。这些映射只确认观察位置身份，不声明产品或运行时行为等价。
