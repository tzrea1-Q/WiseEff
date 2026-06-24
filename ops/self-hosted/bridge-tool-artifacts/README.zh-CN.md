# Bridge 调试工具制品

供本地 Device Bridge 同源下载的 **ADB platform-tools** 与 **HarmonyOS HDC** 固定版本制品。

## 目录结构

```text
bridge-tool-artifacts/
  0.1.0/
    manifest.json
    windows/amd64/adb-platform-tools.zip
    darwin/arm64/adb-platform-tools.zip
    ...
```

每个版本目录必须包含 `manifest.json`。API 通过 `DEVICE_BRIDGE_TOOL_ARTIFACT_ROOT` 读取，并返回相对路径 `downloadUrl`，例如 `/downloads/device-bridge-tools/0.1.0/windows/amd64/adb-platform-tools.zip`。

## 许可说明

请在部署中固定经批准可再分发的 Google `platform-tools` 与 HarmonyOS `hdc` 版本；运行时不得拉取任意 URL。

## 构建与发布

1. 按 `manifest.json` 下载各平台/架构/协议的上游 zip。
2. 放入 `<version>/<platform>/<arch>/`。
3. 运行 `npm run bridge-tool-artifacts:build` 更新 sha256。
4. 随 WiseEff 自托管栈部署；Caddy 从挂载卷提供 `/downloads/device-bridge-tools/*`。

## API

```http
GET /api/v1/device-bridges/tool-releases
GET /downloads/device-bridge-tools/<version>/<platform>/<arch>/<artifact>
```

Bridge 安装到私有目录（不修改系统 PATH）：

- Windows：`%LOCALAPPDATA%\WiseEff\tools\`
- macOS：`~/Library/Application Support/WiseEff/tools/`
- Linux：`~/.wiseeff/tools/`
