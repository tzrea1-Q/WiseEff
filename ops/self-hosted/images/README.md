# Self-Hosted Base Images

> Chinese: [Chinese](README.zh-CN.md)

Offline bundle for the WiseEff self-hosted Dockerfile base image (`node:22.21.1-alpine`, **linux/amd64**).

## Load On An Air-Gapped Host

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

Amd64 image digest at export time: `sha256:eefb407f08684593068a61d76c3336fb418bdfd184357ccfe448aadfa1147b3e`
