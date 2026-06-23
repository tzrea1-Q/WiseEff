# Self-Hosted Base Images

> Chinese: [Chinese](README.zh-CN.md)

Offline bundle for the WiseEff self-hosted Dockerfile base image (`node:22.21.1-alpine`).

## Load On An Air-Gapped Host

```bash
docker load -i node-22.21.1-alpine.tar
docker image inspect node:22.21.1-alpine --format '{{.Id}}'
```

After loading, build from `ops/self-hosted` as usual:

```bash
./scripts/compose --env-file .env up -d --build
```

## Refresh This Bundle

From a machine with Docker registry access:

```bash
docker pull node:22.21.1-alpine
docker save node:22.21.1-alpine -o node-22.21.1-alpine.tar
```

Image digest at export time: `sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf`
