import { useEffect, useRef, useState } from "react";
import type { ParameterFileCandidate, ParameterFileRepository, ParameterFileSourceReviewStatus } from "@/application/ports/ParameterFileRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import { formatRelativeOrAbsolute } from "@/domain/format/formatDateTime";
import { presentError } from "@/infrastructure/http/presentError";

export const candidateStatusLabels: Record<ParameterFileCandidate["status"], string> = {
  uploading: "上传中", parsing: "解析中", ready: "待核对", blocked: "需处理问题",
  failed: "解析失败", abandoned: "已放弃", stale: "需要重新核对", active: "已应用"
};

const reviewStatusLabels: Record<ParameterFileSourceReviewStatus, string> = {
  pending: "待审核", approved: "审核通过", rejected: "审核驳回", withdrawn: "已撤回"
};

export type WorkbenchCandidatesState = {
  items: ParameterFileCandidate[];
  loading: boolean;
  error: string;
  retry: () => void;
  reviewStatusById?: Readonly<Record<string, ParameterFileSourceReviewStatus>>;
  reviewStatusError?: string;
};

export function useWorkbenchCandidates({ projectId, fileId, repository, reloadToken, reviewRepository }: {
  projectId: string;
  fileId?: string;
  repository: Pick<ParameterFileRepository, "listCandidates">;
  reloadToken?: string;
  reviewRepository?: Pick<ParameterCatalogRepository, "listProjectValueChangeRequests" | "listProjectValueBatchChangeRequests">;
}): WorkbenchCandidatesState {
  const [items, setItems] = useState<ParameterFileCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const [sourceIndex, setSourceIndex] = useState<{
    projectId: string; statuses: Record<string, ParameterFileSourceReviewStatus>; error: string;
  }>({ projectId, statuses: {}, error: "" });
  const listSingleReviews = reviewRepository?.listProjectValueChangeRequests;
  const listBatchReviews = reviewRepository?.listProjectValueBatchChangeRequests;
  useEffect(() => {
    let cancelled = false;
    setItems([]);
    setLoading(true);
    setError("");
    void repository.listCandidates(projectId, { fileId, includeAbandoned: true }).then((next) => {
      if (!cancelled) setItems(next.filter((item) => item.projectId === projectId && (!fileId || item.fileId === fileId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }).catch((cause) => {
      if (!cancelled) setError(presentError(cause, "候选记录加载失败。"));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fileId, projectId, reloadToken, repository, retryToken]);
  useEffect(() => {
    let cancelled = false;
    setSourceIndex({ projectId, statuses: {}, error: "" });
    if (!listSingleReviews && !listBatchReviews) return;
    void Promise.all([
      listSingleReviews?.(projectId, { mine: true }) ?? Promise.resolve({ items: [] }),
      listBatchReviews?.(projectId, { mine: true }) ?? Promise.resolve({ items: [] })
    ]).then(([single, batch]) => {
      if (cancelled) return;
      const priority = { pending: 0, approved: 1, rejected: 2, withdrawn: 2 };
      const requests = [...single.items, ...batch.items].flatMap<{
        id: string; status: ParameterFileSourceReviewStatus; updatedAt?: string; createdAt?: string; candidateIds: (string | null)[];
      }>((request) => {
        const status = request.status;
        return request.projectId === projectId && (status === "pending" || status === "approved" || status === "rejected" || status === "withdrawn")
          ? [{ id: request.id, status, updatedAt: request.updatedAt, createdAt: request.createdAt,
            candidateIds: [request.candidateId, ...("uploadCandidateId" in request ? [request.uploadCandidateId] : [])] }] : [];
      })
        .sort((a, b) => priority[a.status] - priority[b.status]
          || (Date.parse(b.updatedAt ?? b.createdAt ?? "") || 0) - (Date.parse(a.updatedAt ?? a.createdAt ?? "") || 0)
          || b.id.localeCompare(a.id));
      const statuses = new Map<string, ParameterFileSourceReviewStatus>();
      for (const request of requests) {
        for (const id of request.candidateIds) {
          if (id && !statuses.has(id)) statuses.set(id, request.status);
        }
      }
      setSourceIndex({ projectId, statuses: Object.fromEntries(statuses), error: "" });
    }).catch((cause) => {
      if (!cancelled) setSourceIndex({ projectId, statuses: {}, error: presentError(cause, "审核状态暂不可用，来源更新记录仍可查看。") });
    });
    return () => { cancelled = true; };
  }, [projectId, reloadToken, retryToken, listSingleReviews, listBatchReviews]);
  return { items: items.filter((item) => item.projectId === projectId && (!fileId || item.fileId === fileId)), loading, error, retry: () => setRetryToken((value) => value + 1),
    reviewStatusById: sourceIndex.projectId === projectId ? sourceIndex.statuses : {},
    reviewStatusError: sourceIndex.projectId === projectId ? sourceIndex.error : "" };
}

export function WorkbenchCandidateList({ state, selectedId, currentFileId, reviewStatusById, onSelect }: {
  state: WorkbenchCandidatesState;
  selectedId: string | null;
  currentFileId?: string;
  reviewStatusById?: Readonly<Record<string, ParameterFileSourceReviewStatus>>;
  onSelect: (candidate: ParameterFileCandidate) => void;
}) {
  const { items, loading, error, retry } = state;
  const isCompleted = (item: ParameterFileCandidate) => item.status === "active" || item.status === "abandoned" || reviewStatusById?.[item.id] === "approved";
  const completed = items.filter(isCompleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unfinished = items.filter((item) => !isCompleted(item))
    .sort((a, b) => (currentFileId ? Number(b.fileId === currentFileId) - Number(a.fileId === currentFileId) : 0)
      || b.createdAt.localeCompare(a.createdAt));
  const completedRef = useRef<HTMLDetailsElement>(null);
  const selectedCompletedId = completed.find((item) => item.id === selectedId)?.id;
  useEffect(() => {
    if (!loading && !error && selectedCompletedId && completedRef.current) completedRef.current.open = true;
  }, [error, loading, selectedCompletedId]);
  const renderItems = (records: ParameterFileCandidate[]) => <ul>{records.map((item) => {
    const reviewStatus = reviewStatusById?.[item.id];
    const label = item.status === "active" ? "已生效" : item.status === "abandoned" ? "已放弃"
      : reviewStatus ? reviewStatusLabels[reviewStatus] : item.status === "ready" ? "状态待核对" : candidateStatusLabels[item.status];
    return <li key={item.id}>
    <button type="button" className="button subtle configuration-workbench__candidate-item" aria-pressed={item.id === selectedId}
      onClick={() => onSelect(item)}>
      <strong>{item.fileName}</strong><span>{label}</span>
      <time dateTime={item.createdAt}>{formatRelativeOrAbsolute(item.createdAt)}</time>
    </button>
  </li>;
  })}</ul>;
  return <section aria-label="候选记录" className="configuration-workbench__candidate-list">
    {loading ? <SectionSkeleton label="正在加载候选记录…" /> : error ? <SectionError message={error} onRetry={retry} />
      : items.length === 0 ? <SectionEmpty message="暂无来源更新记录。上传来源文件后，可在这里继续核对或查看处理结果。" />
        : <>
          {unfinished.length > 0 ? renderItems(unfinished) : null}
          {completed.length > 0 ? <details ref={completedRef}>
            <summary>已完成与已放弃（{completed.length}）</summary>
            {renderItems(completed)}
          </details> : null}
        </>}
  </section>;
}
