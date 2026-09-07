# Durable application artifact selection

Chinese: [中文](applicationArtifactCustody.README.zh-CN.md).

Dependency: `a557e6886`. This owner binds an actual application build to an
already initialized host journal. It does not initialize a run, infer a cutover
plan, publish a release, reconstruct P13, or grant startup permission. Production
precedes handoff: the root later compares the returned source/image facts with
its actual candidate when creating the handoff. Previous-source identity remains
the existing root's responsibility.

## R3 implementation boundary

| Threat | Required behavior / permanent regression |
| --- | --- |
| Caller JSON becomes build provenance | Only the owner calls the actual builder and pins projection before retention. A raw file inspection lease is read-only and never an issued artifact. |
| Wrong run or lock | Existing settled journal, issued direct-parent host lock, original canonical private directory and full-record CAS are required. |
| Process stops during build/receipt/journal persistence | Pending precedes the actual build. Receipt fsync precedes committed acknowledgment. Pending/unknown never reopen successfully or automatically rebuild. |
| Source or package changes across an await | Hold all source/config/package/OCI file descriptors and both directory identities, validate original named identities and hashes before/after reads and boundary checks. |
| Forged/partial receipt or renamed parent | Reopen only the exact original receipt selected by the same run's committed event. Require private regular single-link files and original directory/file identities. |
| Mutable tag or borrowed identity | Pin and re-read the actual physical Git tag object/commit; disable replacement objects. Record producer code SHA/tree and build source before the first build effect. |
| False complete result | Return only artifact pins/source/image facts. No runtime generation, actual old-writer inventory or approval is invented. |

The existing trusted same-UID private custodian and host journal remain the
trust boundary. This is persistence of real producer output, not a new signing
authority. A hostile custodian capable of replacing all private state is outside
that existing boundary. Developer fixtures must not be reported as an approved
build or whole-controller result. Actual restart acceptance must reopen the same
produced package in a separate process, without another build.

## Root API and evidence

`produceApplicationArtifactSelection({journal, lock, build, releaseTag})` owns
the actual build. `build` uses the existing producer inputs except that
`outputParent` is fixed to the original journal directory. The physical source
commit/tag and clean controller SHA/tree are pinned before the build; actual
controller files must match their Git blobs. Direct loose tags and direct packed
tags are supported. Symbolic tags are refused. The original tag FD remains held
through the final host-lock await; no Git subprocess follows that final check.
Build-network configuration must be a private same-owner file.

The original request and receipt file identity (device/inode, nanosecond
timestamps, owner, mode, size) joins its byte digest in the journal CAS.
Identical bytes in a replacement receipt are insufficient. Custody explicitly
fsyncs every required artifact material, including Buildx metadata, before its
receipt. The raw inspection helper remains read-only and cannot issue a build
handle. Each synchronous mkdir/write/commit follows the real host boundary.

`reopenApplicationArtifactSelection({journal, lock})` returns the same
`selection.observe()` interface without rebuilding. Each observation owns and
releases all FDs before resolving, so the selection has no `close()` obligation.
The raw inspection lease separately requires `close()`. Journal initialization
and the official `upgrade.sh` dispatcher belong to the root.

The 50 focused tests cover 24 artifact/native Git/tar/raw-FD cases and 26 host
persistence cases. The latter use real private files, native Git and an issued
OS lock, with explicit build/OCI owner doubles. The actual holder is killed in
the pre-request Git window; no request or build follows. An actual material FD
fsync failure prevents committed acknowledgment. These are not actual application
build acceptance. Same-byte receipt replacement and a native symbolic tag each
first failed their new negative test and then passed. The initial missing-module
run was a collection failure, not a behavioral Red. Strict targeted types and the
unchanged trusted boundary are checked separately. Official init/prepare and a
separate-process inspect of one issued package subsequently passed at `73f12a24e`.
The permanent terminal acceptance at `3cee9f235` built that source, reopened in
another process and refused wrong input/material changes. Its final negative
run is intentionally ineligible for reuse; the earlier positive package is retained.
Exact execution identities and hashes are in the existing populated upgrade evidence.

```sh
node_modules/.bin/vitest run --config vitest.scripts.config.ts ops/self-hosted/scripts/parameter-catalog-upgrade/applicationArtifact.test.ts ops/self-hosted/scripts/parameter-catalog-upgrade/applicationArtifactCustody.test.ts
```
