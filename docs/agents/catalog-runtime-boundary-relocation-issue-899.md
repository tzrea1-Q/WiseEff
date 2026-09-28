# Issue #899 Catalog boundary successor

> Chinese: [中文](../zh-CN/agents/catalog-runtime-boundary-relocation-issue-899.md)

Issue #899 moves Catalog boundary observations in six files. The fixed successor binds unchanged trusted-base slices to the exact candidate blobs at `683297cfc4d66bd474446c346dbc212d28d7c1a8`:

| File | Pairs | Trusted-base blob | Candidate blob |
| --- | ---: | --- | --- |
| `server/modules/parameter-topology/schemas.ts` | 3 | `4e10ae4b663012ac0fec7b611db828c508569555` | `031779ff8777ffc761d2206b26f4a883484e769b` |
| `src/infrastructure/http/parameterTopologyClient.test.ts` | 24 | `0354e7aac348d2a8230509d065290bd48b922992` | `1f1771f3f8bd067c52b179b92504cf2bb5d53c45` |
| `src/infrastructure/http/parameterTopologyClient.ts` | 32 | `da08b196f95ea9610cb182d620288a15457b4244` | `d65904e0bc725ad8d8af314f3ecd8a720da79fb4` |
| `server/modules/parameter-topology/bindingService.ts` | 58 | `71a5646171a3b92127ebf82b87c6d7c63a360eea` | `9455d3c90e3a683d5fc501664745158daa1540c7` |
| `server/modules/parameter-topology/service.ts` | 14 | `03b396d3b1f42da5070a50d57d20aeed5619ea4c` | `bd81b64d432f92406c93cfdac0d884d81be00ffc` |
| `server/modules/parameter-topology/service.test.ts` | 2 | `5b0707835772615d39cae671d18a195672d04089` | `67f9db5a1253d8f2981acbcee95293669c4cd614` |

The [fixed 133-pair successor](../../scripts/fixtures/parameter-catalog-allowlist/issue-911-boundary-successor-relocation.json) has SHA256 `f187dc3f6ed3ea56cc81e915c6686a3ec0c7d52eb1031c380968ec4a93d3ef49`. It retains the original fixture, trusted base, allowlist, and all earlier records. It adds no allowance. Each pair checks exact occurrence metadata, stable anchor and byte order, raw-slice digest, and complete source and destination blobs before returning an alias.

The earlier [source-workflow record](../../scripts/fixtures/parameter-catalog-allowlist/source-workflow-relocation.json), SHA256 `b998321716d00d58ea83b03cd283a52bafb40ac40437549ee453e7153c83742c`, remains fixed at 82 pairs. The [consumer record](../../scripts/fixtures/parameter-catalog-allowlist/source-workflow-consumer-relocation.json), SHA256 `97f3190a80d0800fac88b6d3d5b60897ed24312ef056bdc59e2099dfa6e712a9`, remains fixed at 237 pairs. Both complete records are proof-only at main commit `47a67562df2920d804ea6ca0f27b84e024ff2ac4`, tree `3ff4fd6a2a1a212465b9eeea92df86f3c6b09312`; proof checks their fixed digests, every source and destination blob, and every pair. Current aliases remain strict for unchanged portions: 79 source-workflow pairs and 183 consumer pairs. The successor supplies current aliases for the six changed files.

The successor has 133 unique source IDs and 133 unique destinations. Its source IDs overlap the fixed source-workflow record in 3 cases and the consumer record in 54 cases. The other 76 consist of the 74 moved observations in the three topology service files and two original `s12-top.json` fixture observations: `S12-TOP:legacy-parameter-spec-identifier:2f10fffcedb520cb:a7946cfaf2b74e70` and `S12-TOP:legacy-parameter-spec-identifier:4c7221a2d9f1a7bc:cd5b4f01bf89b99f`. The fixture observations remain individually required. No historical record is rewritten or used to authorize a new current identity.

Missing, duplicate, already-bound, or cross-record endpoints, changed records, complete-file drift, allowance growth, swapped same-anchor mappings, and newly introduced debt fail closed. These mappings establish occurrence identity only; they do not assert product or runtime behavior equivalence.
