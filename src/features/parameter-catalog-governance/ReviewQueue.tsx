import { useCallback, useEffect, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogReviewItemResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { DataTable, type Column } from "@/components/admin";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";

import { ReviewResolutionDialog } from "./ReviewResolutionDialog";
import type { PlacementOption } from "./RegistrationDialog";
import {
  canExecuteGovernanceAction,
  governanceCopy,
  reviewItemGovernanceState,
  reviewReasonLabels
} from "./governanceState";

type ReviewItem = CatalogReviewItemResponse["item"];

export type ReviewQueueProps = {
  actor: CatalogActorKind;
  domainState: CatalogDomainState;
  repository: ParameterCatalogGovernanceRepository;
  organizationId: string;
  catalogReleaseId: string;
  placementOptions?: PlacementOption[];
  defaultRegistrationId?: string;
  createIdempotencyKey?: () => string;
  selectedReviewItemId?: string;
  onSelectReviewItem?: (id: string | null) => void;
  onRefreshEvidence?: () => void | Promise<void>;
  onResolved?: () => void;
};

function reasonLabel(reason: ReviewItem["reason"]): string {
  return reviewReasonLabels[reason];
}

export function ReviewQueue({
  actor,
  domainState,
  repository,
  organizationId,
  catalogReleaseId,
  placementOptions,
  defaultRegistrationId,
  createIdempotencyKey,
  selectedReviewItemId,
  onSelectReviewItem,
  onRefreshEvidence,
  onResolved
}: ReviewQueueProps) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const canResolve = canExecuteGovernanceAction(actor, "resolve-review-item", domainState);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await repository.listReviewItems(organizationId);
      setItems([...response.items]);
      setEmptyReason(response.items.length === 0 ? (response.emptyReason ?? "no-review-work") : null);
    } catch {
      setError("审核队列加载失败，请稍后重试。");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, repository]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedReviewItemId) {
      return;
    }
    const match = items.find((item) => item.id === selectedReviewItemId) ?? null;
    setSelected(match);
  }, [items, selectedReviewItemId]);

  const columns: Column<ReviewItem>[] = [
    {
      key: "id",
      header: "审核项",
      render: (row) => row.id
    },
    {
      key: "propertyKey",
      header: "属性键",
      render: (row) => row.observation?.propertyKey ?? "—"
    },
    {
      key: "reason",
      header: "原因",
      render: (row) => reasonLabel(row.reason)
    },
    {
      key: "status",
      header: "状态",
      render: (row) => (row.status === "open" ? "待处理" : row.status === "resolved" ? "已处理" : "范围外")
    }
  ];

  return (
    <section className="parameter-catalog__review" aria-label={governanceCopy.reviewQueue}>
      {loading ? <SectionSkeleton label={governanceCopy.reviewLoading} /> : null}
      {error ? <SectionError message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && emptyReason ? (
        <SectionEmpty message={governanceCopy.reviewEmpty} />
      ) : null}
      {!loading && !error && items.length > 0 ? (
        <DataTable
          rows={items}
          rowKey={(row) => row.id}
          columns={columns}
          ariaLabel={governanceCopy.reviewQueue}
          renderRowActions={(row) => {
            if (!canResolve) {
              return null;
            }
            const stale = reviewItemGovernanceState(row, domainState).kind === "conflict";
            return (
              <button
                type="button"
                className="button sm"
                disabled={stale}
                title={stale ? governanceCopy.staleReview : undefined}
                onClick={() => {
                  setSelected(row);
                  onSelectReviewItem?.(row.id);
                }}
              >
                {governanceCopy.resolveTitle}
              </button>
            );
          }}
        />
      ) : null}
      {selected ? (
        <ReviewResolutionDialog
          open
          actor={actor}
          domainState={domainState}
          repository={repository}
          organizationId={organizationId}
          catalogReleaseId={catalogReleaseId}
          item={selected}
          placementOptions={placementOptions}
          defaultRegistrationId={defaultRegistrationId}
          createIdempotencyKey={createIdempotencyKey}
          onOpenChange={(open) => {
            if (!open) {
              setSelected(null);
              onSelectReviewItem?.(null);
            }
          }}
          onCompleted={() => {
            void load();
            onResolved?.();
          }}
          onRefreshEvidence={onRefreshEvidence}
        />
      ) : null}
    </section>
  );
}
