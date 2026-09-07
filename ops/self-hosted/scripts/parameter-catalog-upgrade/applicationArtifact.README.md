# Application artifact production

Chinese: [中文](applicationArtifact.README.zh-CN.md).

This bounded build owner produces a local application package from the existing
Compose/Dockerfile recipe. Dependency: `a321084a5a2a97c037cfadb95a3b6177cabc2330`;
the Scratch branch starts at main and fast-forwards that accepted candidate.
It does not publish a release/tag, push an image, start services, or approve an
upgrade. A missing release identity blocks only the final Verification projection.

## R3 threats and acceptance seam

| Threat | Required observation / refusal |
| --- | --- |
| Untracked private files entering COPY | Build only an archive of the exact Git commit, including the tracked Dockerfile and Compose recipe. |
| Image ID presented as manifest | Read actual OCI index/manifest/config blobs from the exported image; hash their original bytes and verify descriptor sizes. A legacy Docker save manifest is insufficient. |
| Wrong platform or a different loaded image | Match the selected runnable descriptor, config platform, source SHA/tree labels and actual loaded identity in its authenticated index/manifest/config graph. Ambiguous runnable images fail. |
| Mutable or incomplete package | Hold the archive file descriptor, reject duplicate/link/traversal entries, verify every referenced layer, and detect file changes before returning. Persist the package manifest exclusively and fsync. |
| Forged build trust | Invoke the existing build-network preparation plus require_verified and the actual build. Bind its policy/CA fingerprint and tracked recipe/materials. Configuration evidence is not enterprise network proof. |
| Remote daemon or ambient secrets | Reuse isolated Docker endpoint/daemon verification; no global builder/context changes. Pass only the build allowlist, never runtime .env. |
| Fake release | Never create tags or infer them from an image tag/SHA. Final projection needs an explicitly selected existing Git tag bound to the captured commit; this is identity evidence, not approval. |
| Failure / false success | Static typed failures, no raw subprocess errors. Failed builds/exports do not produce an issued successful artifact. |

The pure OCI inspection seam is not an authority issuer. Only the real build
owner issues a package eligible for projection. Unit archives prove byte-level
validation; the separate real build test must prove the actual recipe/export.
No real OCI build has been executed for this new module yet.

The first unit invocation failed at import because the module did not exist
(one failed suite, zero collected cases). The initial ten codec tests pass;
that is not a real-build result. A separately authorized read-only export of
the historical `df0fa9c56` application image produced a 373,599,232-byte OCI
archive with 17 runnable layers. The initial config-ID assumption correctly
failed `OCI-CONFIG-MISMATCH`; actual `.Id` and `.Descriptor` proved the loaded
identity is an index. After distinguishing all three kinds, byte validation
passed. This capability observation does not reidentify that historical build
as a new candidate or prove the new build owner.

The current local read-only capability observation found a Docker driver and a
containerd image store. The implementation may consume an actual OCI layout
from `docker image save`; it must reject a legacy-only archive rather than
inventing a distribution manifest. See the [OCI layout specification](https://github.com/opencontainers/image-spec/blob/main/image-layout.md)
and [Docker exporter limits](https://docs.docker.com/build/exporters/oci-docker/).
