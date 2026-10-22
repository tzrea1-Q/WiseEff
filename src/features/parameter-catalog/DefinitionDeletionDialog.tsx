import { useCallback, useEffect, useState } from "react";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import type { CatalogDefinitionDeletionPreviewResponse, CatalogDefinitionResponse } from "@/infrastructure/http/parameterCatalogDtos";

export function DefinitionDeletionDialog({ definition, repository, onDeleted, onCancel }: {
  definition: CatalogDefinitionResponse["item"];
  repository: ParameterCatalogRepository;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<CatalogDefinitionDeletionPreviewResponse["item"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [previewEpoch, setPreviewEpoch] = useState(0);
  const readPreview = useCallback(() => repository.previewDefinitionDeletion!(definition.id), [repository, definition.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setError("");
    void readPreview().then((response) => {
      if (!cancelled) setPreview(response.item);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(`无法读取删除影响。${reason instanceof Error ? reason.message : "请重试。"}`);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [readPreview, previewEpoch]);

  const remove = async () => {
    if (!preview || pending || loading) return;
    setPending(true);
    setError("");
    try {
      await repository.deleteDefinition!(definition.id, { previewToken: preview.previewToken });
      onDeleted();
    } catch (reason) {
      if (!(reason instanceof WiseEffApiError) || reason.details.reason === "definition-erasure-cleanup-pending") {
        // Refresh the catalog and durable receipts instead of replaying an uncertain DELETE.
        onDeleted();
      } else {
        setPreview(null);
        setError(`删除未完成，请刷新删除影响后重试。${reason instanceof Error ? reason.message : ""}`);
      }
    } finally {
      setPending(false);
    }
  };

  return <ConfirmDialog open title={`彻底删除 ${preview?.definition.propertyKey ?? definition.propertyKey}`} tone="danger"
    confirmLabel="彻底删除" pendingLabel="正在彻底删除…" pending={pending}
    confirmDisabled={loading || !preview} onConfirm={() => void remove()} onCancel={onCancel}
    error={error}
    description={<>
      <p>将从全平台彻底删除 {preview?.definition.subjectName ?? definition.subject.canonicalName} / {preview?.definition.propertyKey ?? definition.propertyKey}，包括所有组织中的项目值、修订和关联记录。删除后无法恢复。</p>
      <p>包含本参数的整批审批等关联记录可能一并撤除。原始 DTS / JSON 配置文件保留。</p>
      {loading ? <p role="status">正在读取全平台删除影响…</p> : preview ? <dl className="parameter-catalog__dl" aria-label="全平台删除影响">
        <dt>组织</dt><dd>{preview.affected.organizations}</dd>
        <dt>项目</dt><dd>{preview.affected.projects}</dd>
        <dt>参数绑定</dt><dd>{preview.affected.bindings}</dd>
        <dt>项目值</dt><dd>{preview.affected.values}</dd>
        <dt>修订记录</dt><dd>{preview.affected.revisions}</dd>
        <dt>关联记录总数</dt><dd>{preview.affected.relatedRecords}</dd>
      </dl> : null}
    </>}
    extra={<button type="button" className="button subtle" disabled={loading || pending}
      onClick={() => setPreviewEpoch((value) => value + 1)}>刷新删除影响</button>}
  />;
}
