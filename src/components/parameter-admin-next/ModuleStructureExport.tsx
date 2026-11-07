import { useState } from "react";
import type { ApiClient } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { Button } from "@/components/ui/button";
import englishGuide from "../../../docs/user-guide/module-structure-editing.md?raw";
import chineseGuide from "../../../docs/zh-CN/user-guide/module-structure-editing.md?raw";

function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function ModuleStructureExport({ apiClient, organizationId, canExport }: {
  apiClient?: ApiClient; organizationId?: string; canExport: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return <div className="module-structure-export" role="group" aria-label="模块结构导出">
    <Button type="button" size="sm" variant="outline" disabled={!canExport || !apiClient || !organizationId || busy}
      onClick={async () => {
        if (!apiClient || !organizationId) return;
        setBusy(true); setMessage(null);
        try {
          const document = await apiClient.post<{ counts: { modules: number; subjects: number } }>(
            `/api/v2/organizations/${encodeURIComponent(organizationId)}/module-structure/exports`, {});
          download("module-structure.json", JSON.stringify(document, null, 2), "application/json;charset=utf-8");
          setMessage(`已导出 ${document.counts.modules} 个模块，${document.counts.subjects} 个主体。`);
        } catch (error) { setMessage(presentError(error, "导出失败，请稍后重试。")); }
        finally { setBusy(false); }
      }}>导出完整结构</Button>
    <Button type="button" size="sm" variant="outline" onClick={() => download("module-structure-guide.md",
      `${chineseGuide}\n\n---\n\n${englishGuide}`, "text/markdown;charset=utf-8")}>下载填写说明</Button>
    <p>模块和主体各最多 10,000 条；文件最大 32 MiB，紧凑 JSON 内容最大 4 MiB。{!canExport ? "导出需要组织管理权限。" : ""}</p>
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
