import { useCallback, useEffect, useState } from "react";
import type {
  FileSyncSummary,
  ParameterFileRepository,
  ProjectParameterFileVersion
} from "@/application/ports/ParameterFileRepository";

type ProjectParameterFilesPanelProps = {
  projectId: string;
  repository: ParameterFileRepository;
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败。"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("读取文件失败。"));
        return;
      }
      const base64 = reader.result.split(",")[1];
      if (!base64) {
        reject(new Error("文件内容为空，无法上传。"));
        return;
      }
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

function formatSyncSummary(result: unknown): string {
  const summary = result as Partial<FileSyncSummary> | null | undefined;
  if (!summary || typeof summary !== "object") {
    return "同步成功。";
  }

  if (typeof summary.draftsCreated === "number") {
    return `同步成功，已创建 ${summary.draftsCreated} 条草稿。`;
  }

  return "同步成功。";
}

function chooseLatestVersion(versions: ProjectParameterFileVersion[]) {
  return [...versions].sort((left, right) => right.versionNumber - left.versionNumber)[0];
}

export function ProjectParameterFilesPanel({ projectId, repository }: ProjectParameterFilesPanelProps) {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<
    Array<{
      id: string;
      fileName: string;
      format: string;
      enabled: boolean;
      currentVersionId?: string;
      currentVersionNumber?: number;
    }>
  >([]);
  const [expandedVersions, setExpandedVersions] = useState<Record<string, ProjectParameterFileVersion[]>>({});
  const [versionsLoading, setVersionsLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [summaryText, setSummaryText] = useState("");

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const items = await repository.listFiles(projectId);
      setFiles(items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "参数文件列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [projectId, repository]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const onUploadFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    setUploading(true);
    setUploadError("");
    setActionError("");
    setSummaryText("");
    try {
      const contentBase64 = await readFileAsBase64(file);
      await repository.uploadFile(projectId, { fileName: file.name, contentBase64 });
      await loadFiles();
      setSummaryText(`已上传文件：${file.name}`);
    } catch (uploadFileError) {
      setUploadError(uploadFileError instanceof Error ? uploadFileError.message : "上传参数文件失败。");
    } finally {
      setUploading(false);
    }
  };

  const toggleVersions = async (fileId: string) => {
    if (expandedVersions[fileId]) {
      setExpandedVersions((current) => {
        const next = { ...current };
        delete next[fileId];
        return next;
      });
      return;
    }

    setVersionsLoading((current) => ({ ...current, [fileId]: true }));
    setActionError("");
    try {
      const versions = await repository.listVersions(projectId, fileId);
      setExpandedVersions((current) => ({ ...current, [fileId]: versions }));
    } catch (versionsError) {
      setActionError(versionsError instanceof Error ? versionsError.message : "加载版本列表失败。");
    } finally {
      setVersionsLoading((current) => ({ ...current, [fileId]: false }));
    }
  };

  const downloadLatest = async (fileId: string, fallbackName: string, currentVersionId?: string) => {
    setActionError("");
    try {
      let targetVersionId = currentVersionId;
      if (!targetVersionId) {
        const versions = await repository.listVersions(projectId, fileId);
        targetVersionId = chooseLatestVersion(versions)?.id;
      }
      if (!targetVersionId) {
        throw new Error("该文件暂无可下载版本。");
      }

      const result = await repository.downloadVersion(projectId, fileId, targetVersionId);
      const blob = new Blob([Uint8Array.from(result.bytes)], {
        type: result.contentType || "application/octet-stream"
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName || fallbackName;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSummaryText(`已下载最新版本：${fallbackName}`);
    } catch (downloadError) {
      setActionError(downloadError instanceof Error ? downloadError.message : "下载参数文件失败。");
    }
  };

  const syncFile = async (fileId: string, fileName: string) => {
    setActionError("");
    try {
      const result = await repository.syncFile(projectId, fileId);
      setSummaryText(`${fileName}：${formatSyncSummary(result)}`);
    } catch (syncError) {
      setActionError(syncError instanceof Error ? syncError.message : "文件同步失败。");
    }
  };

  return (
    <section className="project-parameter-files">
      <header className="project-parameter-files__header">
        <div>
          <h3>参数文件</h3>
          <p>上传并维护项目参数文件，支持版本查看、最新版本下载与手动同步。</p>
        </div>
        <label className="button primary project-parameter-files__upload-button" aria-label="上传参数文件">
          <input
            type="file"
            className="project-parameter-files__input"
            accept=".json,.dts,.dtsi"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              void onUploadFile(file);
              event.currentTarget.value = "";
            }}
          />
          {uploading ? "上传中…" : "上传参数文件"}
        </label>
      </header>

      {loading ? <p className="project-parameter-files__loading">参数文件加载中…</p> : null}
      {error ? (
        <p className="project-parameter-files__error" role="alert">
          {error}
        </p>
      ) : null}
      {uploadError ? (
        <p className="project-parameter-files__error" role="alert">
          {uploadError}
        </p>
      ) : null}
      {actionError ? (
        <p className="project-parameter-files__error" role="alert">
          {actionError}
        </p>
      ) : null}
      {summaryText ? (
        <p className="project-parameter-files__summary" role="status">
          {summaryText}
        </p>
      ) : null}

      {!loading && !error && files.length === 0 ? (
        <div className="project-parameter-files__empty">
          <p>当前项目还没有参数文件，先上传一个 `.json`、`.dts` 或 `.dtsi` 文件。</p>
        </div>
      ) : null}

      {!loading && !error && files.length > 0 ? (
        <ul className="project-parameter-files__list" aria-label="项目参数文件列表">
          {files.map((item) => {
            const versions = expandedVersions[item.id] ?? [];
            const versionLoading = versionsLoading[item.id] ?? false;
            return (
              <li key={item.id} className="project-parameter-files__item">
                <div className="project-parameter-files__item-main">
                  <div className="project-parameter-files__meta">
                    <strong>{item.fileName}</strong>
                    <span>格式：{item.format.toUpperCase()}</span>
                    <span>当前版本：{item.currentVersionNumber ?? "-"}</span>
                    <span>状态：{item.enabled ? "启用" : "停用"}</span>
                  </div>
                  <div className="project-parameter-files__actions">
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() => {
                        void toggleVersions(item.id);
                      }}
                    >
                      {expandedVersions[item.id] ? "收起版本" : "查看版本"}
                    </button>
                    <button
                      type="button"
                      className="button subtle"
                      onClick={() => {
                        void downloadLatest(item.id, item.fileName, item.currentVersionId);
                      }}
                    >
                      下载最新
                    </button>
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => {
                        void syncFile(item.id, item.fileName);
                      }}
                    >
                      手动同步
                    </button>
                  </div>
                </div>
                {versionLoading ? <p className="project-parameter-files__versions-loading">版本列表加载中…</p> : null}
                {expandedVersions[item.id] ? (
                  <ul className="project-parameter-files__versions" aria-label={`${item.fileName} 版本列表`}>
                    {versions.length === 0 ? <li>暂无版本记录。</li> : null}
                    {versions.map((version) => (
                      <li key={version.id}>
                        版本 {version.versionNumber} · {version.origin} · {Math.max(version.sizeBytes, 0)} bytes
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
