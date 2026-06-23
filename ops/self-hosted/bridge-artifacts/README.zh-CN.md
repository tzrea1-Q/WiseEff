# 设备 Bridge 制品

> English: [English](README.md)

本目录存放按版本组织的 `wiseeff-bridge` CLI 压缩包，供自托管 WiseEff 部署以同源方式提供下载。

## 目录结构

```text
bridge-artifacts/
  <version>/
    manifest.json
    windows/amd64/wiseeff-bridge_<version>_windows_amd64.zip
    darwin/arm64/wiseeff-bridge_<version>_darwin_arm64.zip
    linux/amd64/wiseeff-bridge_<version>_linux_amd64.zip
```

每个版本目录必须包含 `manifest.json`。API 通过 `DEVICE_BRIDGE_ARTIFACT_ROOT` 读取该文件，并返回相对路径 `downloadUrl`，例如 `/downloads/device-bridge/0.1.0/windows/amd64/wiseeff-bridge_0.1.0_windows_amd64.zip`。

## 构建与发布

在仓库根目录构建 Windows 包：

```bash
npm run bridge:build
```

发布前请在 `manifest.json` 中写入各制品的真实 SHA-256，并将其他平台的 zip 放到对应的 `<version>/<platform>/<arch>/` 路径下。

## 自托管分发

[compose.yaml](../compose.yaml) 中的 Caddy 代理会以只读方式把本目录挂载到 `/bridge-artifacts`，并提供：

```text
GET /downloads/device-bridge/<version>/<platform>/<arch>/<artifact>
```

前端下载面板所需的元数据来自 `GET /api/v1/device-bridges/releases`。请保持制品文件与 manifest 条目一致，确保同源下载链接可正常访问。
