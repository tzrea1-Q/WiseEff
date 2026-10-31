import { useEffect, useRef, useState } from "react";
import { DEFINITION_BATCH_LIMIT, MockDefinitionBatchUnsupportedError } from "@/application/parameter-catalog/definitionBatch";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { catalogFailureReason } from "@/infrastructure/http/parameterCatalogClient";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { CatalogDefinitionResponse, CatalogRevisionDocumentResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { catalogErrorCopy, catalogLifecycleLabels } from "./copy";

type Definition = CatalogDefinitionResponse["item"];
const exportSkipLabels: Record<CatalogRevisionDocumentResponse["item"]["skipped"][number]["reason"], string> = {
  retired: catalogLifecycleLabels.retired, deprecated: catalogLifecycleLabels.deprecated, "not-visible": "不可见", unknown: "不存在",
  "documentation-not-expressible": "说明无法在文档中表达", "not-round-trippable": "内容无法无损导入",
};

export function DefinitionBatchBar({ selected, clear, ownerWritable, disabled, releaseId, repository, ownerState, onCommand, resetKey }: {
  selected: Definition[]; clear: () => void; ownerWritable: (item: Definition) => boolean; disabled: boolean;
  releaseId: string | undefined; repository: ParameterCatalogRepository; ownerState: CatalogDomainState;
  onCommand: (intent: "retire-definition" | "restore-definition", definitions: Definition[], state: CatalogDomainState) => void;
  resetKey: string;
}) {
  const [pending, setPending] = useState(false);
  const [skipped, setSkipped] = useState<CatalogRevisionDocumentResponse["item"]["skipped"]>([]);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(() => { generation.current += 1; setPending(false); setSkipped([]); setError(""); return () => { generation.current += 1; }; }, [resetKey]);
  if (!selected.length) return null;
  const overLimit = selected.length > DEFINITION_BATCH_LIMIT;
  const writable = selected.every(ownerWritable);
  const exportDocument = () => {
    if (!releaseId || !repository.exportRevisionDocument) return;
    const current = generation.current;
    setPending(true); setError(""); setSkipped([]);
    void repository.exportRevisionDocument(selected.map((item) => item.id), { catalogReleaseId: releaseId })
      .then(({ item }) => {
        if (current !== generation.current) return;
        setSkipped(item.skipped);
        const url = URL.createObjectURL(new Blob([item.document], { type: "text/markdown;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = "catalog-revisions.md"; link.click();
        URL.revokeObjectURL(url);
      }).catch((failure: unknown) => {
        if (current !== generation.current) return;
        setError(failure instanceof MockDefinitionBatchUnsupportedError ? failure.message
          : failure instanceof WiseEffApiError && catalogFailureReason(failure) === "release-drift" ? catalogErrorCopy("release-drift")
            : "导出修订文档失败，请重试。");
      }).finally(() => { if (current === generation.current) setPending(false); });
  };
  return <div className="parameter-catalog__actions" role="group" aria-label="批量定义操作">
    <span>已选 {selected.length} 项</span>
    <button type="button" className="button ghost sm" onClick={clear}>清除选择</button>
    <button type="button" className="button primary sm" disabled={disabled || overLimit || !writable || !selected.every((item) => item.lifecycle === "active")}
      onClick={() => onCommand("retire-definition", selected, ownerState)}>退役所选（{selected.length}）</button>
    <button type="button" className="button subtle sm" disabled={disabled || overLimit || !writable || !selected.every((item) => item.lifecycle === "retired")}
      onClick={() => onCommand("restore-definition", selected, ownerState)}>恢复所选（{selected.length}）</button>
    <button type="button" className="button subtle sm" disabled={disabled || pending || !releaseId || overLimit || !selected.some((item) => item.lifecycle === "active")}
      onClick={exportDocument}>导出为修订文档</button>
    {skipped.length ? <span role="status">已跳过：{skipped.map(({ id, reason }) => `${id}（${exportSkipLabels[reason]}）`).join("、")}</span> : null}
    {overLimit ? <span role="status">每批最多选择 {DEFINITION_BATCH_LIMIT} 个定义。</span>
      : !selected.every((item) => item.lifecycle === selected[0]?.lifecycle) ? <span role="status">所选定义状态不同，请选择相同状态的定义。</span> : null}
    {!writable ? <span role="status">所选定义中有当前不可写的项。</span> : null}
    {error ? <span role="alert">{error}</span> : null}
  </div>;
}
