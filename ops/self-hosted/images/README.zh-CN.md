# 自托管镜像

> English: [English](README.md)

## 固定版本的 MinIO 二进制文件

WiseEff 镜像 `wiseeff/minio:RELEASE.2024-12-18T13-15-44Z` 和 `wiseeff/mc:RELEASE.2024-11-21T17-21-54Z` 沿用原上游版本、root 用户和 `/data` 卷行为。它们基于附带的 Node 基础镜像构建，不拉取 MinIO registry 镜像或安装额外软件包。仅支持 linux/amd64。`minio-bundle.env` 仅作为数据解析，固定 GitHub asset URL 和 SHA-256。缺失或占位校验和、重复或未知键、版本/URL 改动、校验和不符均拒绝构建。

安装和升级会在启动或重建服务前验证并准备镜像。已有官方固定版本镜像通过可执行文件的 release 验证后在本地复用。本地兼容标签也支持回滚旧 Compose。迁移到此版本前，请保留原镜像或将其保存：

```bash
docker save -o minio-pinned-images.tar minio/minio:RELEASE.2024-12-18T13-15-44Z minio/mc:RELEASE.2024-11-21T17-21-54Z
```

请随旧恢复点保留该归档。新的 `minio-volume-v1` 恢复点记录 `server-release`，允许同版本重建镜像具有不同 digest。仅记录 digest 的旧恢复点在恢复到另一镜像 ID 时，需要原镜像仍在本地以确认 release。不同 release 一律拒绝。

离线构建时，将普通文件（不允许符号链接）放入下面已加入 gitignore 的目录。从仓库根目录执行：

```bash
mkdir -p ops/self-hosted/images/minio/offline
cp /media/minio.linux-amd64.RELEASE.2024-12-18T13-15-44Z ops/self-hosted/images/minio/offline/minio
cp /media/mc.linux-amd64.RELEASE.2024-11-21T17-21-54Z ops/self-hosted/images/minio/offline/mc
```

已有文件均验证校验和；无效时直接失败，不回退下载。仅缺失文件才从固定 GitHub asset 下载，沿用现有构建代理、批准 CA 和 TLS 授权契约。构建代理设置不会进入最终运行镜像。数据路径和 Compose 卷名不变。

手工构建时先按下文 load/tag 基础镜像，再从 `ops/self-hosted` 执行 `./scripts/compose --env-file .env build minio minio-init`。受限网络配置见 [upgrade.zh-CN.md](../upgrade.zh-CN.md#受限网络构建配置)。

WiseEff 自托管 Dockerfile 基础镜像（`node:22.21.1-alpine`，**linux/amd64**）的离线包。

日常 `./scripts/upgrade.sh plan` / `apply` 会自动使用该离线包。机器可读契约为 `base-image-bundle.env`；升级控制器会在构建前校验 tar SHA-256、OCI manifest digest、Docker config digest、镜像平台和 Dockerfile 标签。不要在 shell 中 source 该契约，也不要只修改 Dockerfile、tar、契约三者之一。

两个 digest 字段是有意设计的兼容契约。Docker Desktop/containerd 可能通过 `docker image inspect .Id` 返回 OCI manifest digest；经典 Docker Engine `overlay2` 可能对同一份归档返回 config digest。控制器只接受契约固定平台上的这两个固定值，不会因为任意本地镜像具有同名标签就放行。

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

导出后应检查 tar 内的 `index.json` 和 `manifest.json`，并原子更新 `base-image-bundle.env` 中所有固定字段。执行 `npm run selfhost:check`；它会从归档提取两个身份，并拒绝校验和、身份契约或 Dockerfile 漂移。当前 amd64 OCI manifest digest：`sha256:eefb407f08684593068a61d76c3336fb418bdfd184357ccfe448aadfa1147b3e`；config digest：`sha256:c91ce80d48fb1a545181cbad2e7e4329bf5aa581c9a87db465e31fa21f92add7`。
