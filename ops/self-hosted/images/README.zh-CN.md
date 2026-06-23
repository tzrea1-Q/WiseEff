# 自托管基础镜像

> English: [English](README.md)

WiseEff 自托管 Dockerfile 基础镜像（`node:22.21.1-alpine`，**linux/amd64**）的离线包。

## 在隔离主机上加载

```bash
docker load -i node-22.21.1-alpine-amd64.tar
docker image inspect node:22.21.1-alpine-amd64 --format '{{.Architecture}} {{.Id}}'
```

加载后，如 Dockerfile 的 `FROM` 需要标准标签，可执行：

```bash
docker tag node:22.21.1-alpine-amd64 node:22.21.1-alpine
```

然后在 `ops/self-hosted` 目录按常规方式构建：

```bash
./scripts/compose --env-file .env up -d --build
```

## 更新此离线包

在有 Docker 仓库访问权限的机器上执行：

```bash
docker pull --platform linux/amd64 node:22.21.1-alpine
docker save node:22.21.1-alpine -o node-22.21.1-alpine-amd64.tar
```

导出时 amd64 镜像 digest：`sha256:eefb407f08684593068a61d76c3336fb418bdfd184357ccfe448aadfa1147b3e`
