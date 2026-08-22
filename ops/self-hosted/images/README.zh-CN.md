# 自托管基础镜像

> English: [English](README.md)

WiseEff 自托管 Dockerfile 基础镜像（`node:22.21.1-alpine`，**linux/amd64**）的离线包。

日常 `./scripts/upgrade.sh plan` / `apply` 会自动使用该离线包。机器可读契约为 `base-image-bundle.env`；升级控制器会在构建前校验 tar SHA-256、image ID、镜像平台和 Dockerfile 标签。不要在 shell 中 source 该契约，也不要只修改 Dockerfile、tar、契约三者之一。

## 首次接入的手工 fallback

只有宿主机当前安装的控制器早于自动准备离线包版本，或在 `upgrade.sh` 之外直接构建时，才使用以下命令。日常升级不需要手工执行。

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

导出后应检查已加载归档镜像，并原子更新 `base-image-bundle.env` 中所有固定字段。执行 `npm run selfhost:check`，它会拒绝校验和、契约或 Dockerfile 漂移。导出时 amd64 image ID：`sha256:eefb407f08684593068a61d76c3336fb418bdfd184357ccfe448aadfa1147b3e`。
