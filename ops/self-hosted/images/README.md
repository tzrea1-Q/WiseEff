# Self-Hosted Base Images

> Chinese: [Chinese](README.zh-CN.md)

Offline bundle for the WiseEff self-hosted Dockerfile base image (`node:22.21.1-alpine`, **linux/amd64**).

The normal `./scripts/upgrade.sh plan` / `apply` workflow consumes this bundle automatically. Its machine-readable contract is `base-image-bundle.env`; the upgrade controller verifies the archive SHA-256, image ID, image platform, and Dockerfile tag before build. Do not source the contract in a shell or edit only one of the Dockerfile, tar, and contract.

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

After export, inspect the loaded archive image and atomically update all pinned fields in `base-image-bundle.env`. Run `npm run selfhost:check`; it rejects checksum, contract, or Dockerfile drift. Amd64 image ID at export time: `sha256:eefb407f08684593068a61d76c3336fb418bdfd184357ccfe448aadfa1147b3e`.
