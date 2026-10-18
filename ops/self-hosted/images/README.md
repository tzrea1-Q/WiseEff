# Self-Hosted Images

> Chinese: [Chinese](README.zh-CN.md)

Offline bundle for the WiseEff self-hosted Dockerfile base image (`node:22.21.1-alpine`, **linux/amd64**).

The normal `./scripts/upgrade.sh plan` / `apply` workflow consumes this bundle automatically. Its machine-readable contract is `base-image-bundle.env`; the upgrade controller verifies the archive SHA-256, OCI manifest digest, Docker config digest, image platform, and Dockerfile tag before build. Do not source the contract in a shell or edit only one of the Dockerfile, tar, and contract.

The two digest fields are intentional. Docker Desktop/containerd may return the OCI manifest digest from `docker image inspect .Id`; classic Docker Engine with `overlay2` may return the config digest for the same archive. The controller accepts either contracted digest on the exact contracted platform. It never accepts an arbitrary local image merely because its tag matches.

## Pinned MinIO binaries

The WiseEff images `wiseeff/minio:RELEASE.2024-12-18T13-15-44Z` and `wiseeff/mc:RELEASE.2024-11-21T17-21-54Z` keep the previous upstream releases, root user, and `/data` volume behavior. They build on the bundled Node base without pulling MinIO registry images or installing packages. Only linux/amd64 is supported. `minio-bundle.env` is parsed as data and pins the GitHub asset URLs and SHA-256 values. Missing/placeholder checksums, duplicate/unknown keys, changed releases/URLs, and checksum mismatches refuse the build.

Setup and upgrade verify/prepare the images before starting or recreating services. Existing official pinned images are verified by their executable release and reused locally. Local compatibility tags also support older Compose files during rollback. Until moving to this release, keep the original images or save them:

```bash
docker save -o minio-pinned-images.tar minio/minio:RELEASE.2024-12-18T13-15-44Z minio/mc:RELEASE.2024-11-21T17-21-54Z
```

Retain this archive with legacy recovery points. New `minio-volume-v1` points record `server-release` and permit a same-release rebuild with a different image digest. Digest-only legacy points need the original local image to establish its release when restoring to another image ID. A different release is always refused.

For offline builds, place regular, non-symlink binaries in the gitignored directory below. From the repository root:

```bash
mkdir -p ops/self-hosted/images/minio/offline
cp /media/minio.linux-amd64.RELEASE.2024-12-18T13-15-44Z ops/self-hosted/images/minio/offline/minio
cp /media/mc.linux-amd64.RELEASE.2024-11-21T17-21-54Z ops/self-hosted/images/minio/offline/mc
```

Present files are checksum-verified; an invalid file fails without a download fallback. Missing files download from the pinned GitHub assets through the existing build proxy/approved-CA/TLS authorization contract. Build proxy settings do not enter the final runtime image. Data paths and Compose volume names stay unchanged.

For manual builds, load/tag the base as described below, then run `./scripts/compose --env-file .env build minio minio-init` from `ops/self-hosted`. Restricted-network configuration is documented in [upgrade.md](../upgrade.md#restricted-network-build-configuration).

## Manual First-Adoption Fallback

Use these commands only when the controller already installed on the host predates automatic bundle preparation, or when building outside `upgrade.sh`. Normal upgrades do not require them.

```bash
docker load -i node-22.21.1-alpine-amd64.tar
docker image inspect node:22.21.1-alpine-amd64 --format '{{.Architecture}} {{.Id}}'
```

After loading, tag the image for the Dockerfile `FROM` line if needed:

```bash
docker tag node:22.21.1-alpine-amd64 node:22.21.1-alpine
```

Then build from `ops/self-hosted` as usual:

```bash
./scripts/compose --env-file .env up -d --build
```

## Refresh This Bundle

From a machine with Docker registry access:

```bash
docker pull --platform linux/amd64 node:22.21.1-alpine
docker save node:22.21.1-alpine -o node-22.21.1-alpine-amd64.tar
```

After export, inspect `index.json` and `manifest.json` inside the tar and atomically update all pinned fields in `base-image-bundle.env`. Run `npm run selfhost:check`; it extracts both identities from the archive and rejects checksum, identity-contract, or Dockerfile drift. Current amd64 OCI manifest digest: `sha256:eefb407f08684593068a61d76c3336fb418bdfd184357ccfe448aadfa1147b3e`; config digest: `sha256:c91ce80d48fb1a545181cbad2e7e4329bf5aa581c9a87db465e31fa21f92add7`.
