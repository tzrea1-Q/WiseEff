# 自托管基础镜像

> English: [English](README.md)

WiseEff 自托管 Dockerfile 基础镜像（`node:22.21.1-alpine`）的离线包。

## 在隔离主机上加载

```bash
docker load -i node-22.21.1-alpine.tar
docker image inspect node:22.21.1-alpine --format '{{.Id}}'
```

加载完成后，在 `ops/self-hosted` 目录按常规方式构建：

```bash
./scripts/compose --env-file .env up -d --build
```

## 更新此离线包

在有 Docker 仓库访问权限的机器上执行：

```bash
docker pull node:22.21.1-alpine
docker save node:22.21.1-alpine -o node-22.21.1-alpine.tar
```

导出时镜像 digest：`sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf`
