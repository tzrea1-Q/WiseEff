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
| Fake release | The producer never creates tags or infers them from an image tag/SHA. Projection requires an explicitly selected existing Git tag bound to the captured commit. The acceptance command creates synthetic-only refs in a separate private Git copy, not release approval. |
| Failure / false success | Static typed failures, no raw subprocess errors. Failed builds/exports do not produce an issued successful artifact. |

The pure OCI inspection seam is not an authority issuer. Only the real build
owner issues a package eligible for projection. Unit archives prove byte-level
validation; the separate real build test must prove the actual recipe/export.
The real-build command below has executed for the first fixed builder. Later
readback/mutation additions require their own execution; results are not rebadged.

The first unit invocation failed at import because the module did not exist
(one failed suite, zero collected cases). The initial ten codec tests pass;
that is not a real-build result. A separately authorized read-only export of
the historical `df0fa9c56` application image produced a 373,599,232-byte OCI
archive with 17 runnable layers. The initial config-ID assumption correctly
failed `OCI-CONFIG-MISMATCH`; actual `.Id` and `.Descriptor` proved the loaded
identity is an index. After distinguishing all three kinds, byte validation
passed. This capability observation does not reidentify that historical build
as a new candidate or prove the new build owner.

## Actual first build and permanent entrypoints

Builder `c95f31bac70a14abee4e55e08752e9cf2e6d623e`, tree
`a2d0d285a07d3c29cd746ac98311496372ba3ab1`, built the exact tracked source
`a321084a5a2a97c037cfadb95a3b6177cabc2330` with the existing recipe. Build,
actual OCI save, all blob checks and package persistence exited zero. Missing
release identity independently refused only the final projection. The log
`/tmp/upg824-application-build-c95.log` has SHA256
`d0231cd39b0b9c8a7ba56e49df2e47522b8bc1b65e1c3993b87b327f27c5bec9`.
The application package digest is `sha256:d7b20b5acf16418cc10852222ac2cfc55a39f1b0941d37e95e0ec77ba01650c5`;
its actual loaded index is `sha256:95d39399aa2f107aa15bab33dcde5270bae245c12217c8ed50041f3ad55c597f`,
platform image manifest `sha256:7fc7d34adc9f76f2d5a930f21d0346ce49f99a4684d7b8d331b6064a7e66869f`,
config `sha256:213ee4c0749a543cbfab7713e54a3fa7e699574d6a3740ac567f5da319079e45`,
and platform `linux/arm64`. The private output and new nonce image are retained
as build artifacts. No containers/services were created or started. There was
no registry push, release issuance, production connection or startup approval.

Independent review found two provenance gaps in that first builder: extracted
tracked files could change during build, and a base tag could move A→B→A with
identical filesystem layers but different configuration. That historical success
does not prove immutable source/base provenance. The revised owner captures Git
archive stdout in a private buffer (256 MiB limit), resolves only the first FROM
to an actual saved OCI digest, and streams the resulting tar to BuildKit.
Additional external stages and unsupported Compose build options refuse. The
package records original/resolved Dockerfile bytes and hashes, source/context
digests, and the verified base graph. The resolved recipe differs explicitly
from the Git recipe. The hashed CA buffer is passed through a dedicated process
environment secret; the builder never reopens a mutable CA path. The existing
Dockerfile's certificate installation policy is unchanged. Native tar tests
exercise the actual stream transformation, not an image build.

The normal scripts suite collects `applicationArtifact.test.ts`. The additional
real acceptance command deliberately requires explicit source, independently
observed daemon and new private output arguments; there is no opt-in skip or
zero-test success. It is not registered in mandatory CI yet:

```sh
node --import tsx ops/self-hosted/scripts/parameter-catalog-upgrade/applicationArtifact.build.ts \
  "$REPOSITORY" "$SOURCE_SHA" "$OBSERVED_DAEMON_ID" "$PRIVATE_OUTPUT_PARENT" "$PUBLIC_API_BASE_URL"
```

The optional sixth argument is the private build-network data file. The owner
requires an available base image with an actual repository digest and verifies
its saved OCI platform manifest/config graph before using that immutable FROM.
It does not invent a base identity. Its timeout is 20 minutes; an
interrupted child process group is terminated, and partial artifacts remain
unissued. It does not restart an interrupted build automatically.

`readApplicationArtifact` rechecks this process's issued package/OCI bytes.
There is deliberately no arbitrary JSON-to-issued-handle import. The parent
still owns restart-safe artifact selection and formal fixed-pins integration.
The latest real acceptance command also mutates the newly produced manifest,
requires `PACKAGE-CHANGED`, restores/fsyncs the original bytes and rechecks them;
that addition was made after the recorded first build. A transient missing
brace in its accompanying pure test produced zero collected cases and TS1005;
the corrected fifteen pure tests and strict targeted types passed. None of this
substitutes a package digest for approval. The revised real command also makes
synthetic-only tags in its private Git copy, proves positive six-field pins,
and refuses a tag pointing at another commit. No shared refs change or tags
are published. These revised checks still await a new real build.

The current local read-only capability observation found a Docker driver and a
containerd image store. The implementation may consume an actual OCI layout
from `docker image save`; it must reject a legacy-only archive rather than
inventing a distribution manifest. See the [OCI layout specification](https://github.com/opencontainers/image-spec/blob/main/image-layout.md)
and [Docker exporter limits](https://docs.docker.com/build/exporters/oci-docker/).
