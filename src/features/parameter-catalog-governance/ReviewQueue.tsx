import { useCallback, useEffect, useRef, useState } from "react";

import type { CatalogActorKind } from "@/application/parameter-catalog/authority";
import type { CatalogDomainState } from "@/application/parameter-catalog/states";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogReviewItemResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { DataTable, type Column } from "@/components/admin";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";

import { ReviewResolutionDialog } from "./ReviewResolutionDialog";
import type { PlacementOption, RegistrationModuleOption } from "./RegistrationDialog";
import type { CatalogSubjectListResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/common/SearchField";
import { SelectControl } from "@/components/common/SelectControl";
import "./review-queue.css";
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
  moduleOptions?: RegistrationModuleOption[];
  subjects?: CatalogSubjectListResponse["items"];
  onContinueDefinition?: (context: { subjectId?: string; propertyKey?: string; proposalId: string }) => void;
  defaultRegistrationId?: string;
  createIdempotencyKey?: () => string;
  selectedReviewItemId?: string;
  onSelectReviewItem?: (id: string | null) => void;
  onRefreshEvidence?: () => void | Promise<void>;
  onResolved?: () => void;
  embedded?: boolean;
  onEditorActiveChange?: (active: boolean) => void;
  onLeaveGuardChange?: (guard: (() => boolean) | null) => void;
  onCountChange?: (count: number | null) => void;
};

function reasonLabel(reason: ReviewItem["reason"]): string {
  return reviewReasonLabels[reason];
}

function sourcesOf(item: ReviewItem) {
  return item.sources?.length ? item.sources : item.sourceSummary ? [item.sourceSummary] : [];
}

export function ReviewQueue({
  actor,
  domainState,
  repository,
  organizationId,
  catalogReleaseId,
  placementOptions,
  moduleOptions,
  subjects,
  onContinueDefinition,
  defaultRegistrationId,
  createIdempotencyKey,
  selectedReviewItemId,
  onSelectReviewItem,
  onRefreshEvidence,
  onResolved,
  embedded = false,
  onEditorActiveChange,
  onLeaveGuardChange,
  onCountChange
}: ReviewQueueProps) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [emptyReason, setEmptyReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [selectionLoading, setSelectionLoading] = useState(false);
  const [selectionRetry, setSelectionRetry] = useState(0);
  const [query, setQuery] = useState("");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const selectedCache = useRef(new Map<string, ReviewItem>());
  const countCallback = useRef(onCountChange);
  useEffect(() => { countCallback.current = onCountChange; }, [onCountChange]);
  const generation = useRef(0);
  const canResolve = canExecuteGovernanceAction(actor, "resolve-review-item", domainState);

  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setLoadingMore(false);
    setError(null);
    setPageError(null);
    setItems([]);
    setNextCursor(null);
    try {
      const response = await repository.listReviewItems(organizationId);
      if (request !== generation.current) return;
      if (response.catalogReleaseId !== catalogReleaseId) throw new Error("目录发布已变化");
      setItems([...response.items]);
      countCallback.current?.(response.totalCount ?? (response.nextCursor ? null : response.items.length));
      setNextCursor(response.nextCursor);
      setEmptyReason(response.items.length === 0 ? (response.emptyReason ?? "no-review-work") : null);
    } catch {
      if (request !== generation.current) return;
      setError("审核队列加载失败，请稍后重试。");
      countCallback.current?.(null);
      setItems([]);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [catalogReleaseId, organizationId, repository]);

  useEffect(() => {
    selectedCache.current.clear();
    setSelected(null);
    setQuery("");
    setReasonFilter("all");
    setProjectFilter("all");
    void load();
    return () => { generation.current += 1; };
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const request = generation.current;
    setLoadingMore(true);
    setPageError(null);
    try {
      const response = await repository.listReviewItems(organizationId, { cursor: nextCursor, limit: 50, catalogReleaseId });
      if (request !== generation.current) return;
      if (response.catalogReleaseId !== catalogReleaseId || response.nextCursor === nextCursor) {
        setNextCursor(null);
        setPageError("审核证据已变化，请重新读取队列。");
        return;
      }
      setItems((current) => [...new Map([...current, ...response.items].map((item) => [item.id, item])).values()]);
      countCallback.current?.(response.totalCount ?? null);
      setNextCursor(response.nextCursor);
    } catch {
      if (request === generation.current) setPageError("下一页加载失败，已加载的审核项已保留。");
    } finally {
      if (request === generation.current) setLoadingMore(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setSelectionError(null);
    if (!selectedReviewItemId) {
      setSelected(null);
      setSelectionLoading(false);
      return;
    }
    const cached = selectedCache.current.get(`${organizationId}:${selectedReviewItemId}`);
    if (cached?.catalogReleaseId === catalogReleaseId) {
      setSelected(cached);
      setSelectionLoading(false);
      return;
    }
    setSelected(null);
    setSelectionLoading(true);
    void repository.getReviewItem(organizationId, selectedReviewItemId).then((response) => {
      if (cancelled) return;
      if (response.item.id !== selectedReviewItemId) throw new Error("审核项证据已变化");
      selectedCache.current.set(`${organizationId}:${response.item.id}`, response.item);
      setSelected(response.item);
    }).catch(() => {
      if (!cancelled) setSelectionError("链接中的审核项不存在、无权访问，或证据已变化。请重试读取。");
    }).finally(() => { if (!cancelled) setSelectionLoading(false); });
    return () => { cancelled = true; };
  }, [catalogReleaseId, organizationId, repository, selectedReviewItemId, selectionRetry]);

  useEffect(() => {
    onEditorActiveChange?.(Boolean(selected || selectionLoading));
  }, [selected, selectionLoading, onEditorActiveChange]);

  const projectOptions = [...new Map(items.flatMap((item) => sourcesOf(item).flatMap((source) => source.projectId
    ? [[source.projectId, source.projectName ?? source.projectId] as const] : []))).entries()];
  const visibleItems = items.filter((item) => {
    if (reasonFilter !== "all" && item.reason !== reasonFilter) return false;
    if (projectFilter !== "all" && !sourcesOf(item).some((source) => source.projectId === projectFilter)) return false;
    return [item.id, item.observation?.propertyKey, ...sourcesOf(item).flatMap((source) => [source.compatible,
      source.projectName, source.fileName, source.nodeLocator]), ...item.candidates.map((candidate) => candidate.canonicalName)]
      .join(" ").toLowerCase().includes(query.trim().toLowerCase());
  });

  const editor = selected ? <ReviewResolutionDialog
    key={`${organizationId}:${selected.id}`} open embedded={embedded}
    actor={actor} domainState={domainState} repository={repository} organizationId={organizationId}
    catalogReleaseId={catalogReleaseId} item={selected} placementOptions={placementOptions}
    moduleOptions={moduleOptions} subjects={subjects} onContinueDefinition={onContinueDefinition}
    defaultRegistrationId={defaultRegistrationId} createIdempotencyKey={createIdempotencyKey}
    onLeaveGuardChange={onLeaveGuardChange}
    onOpenChange={(open) => {
      if (!open) { setSelected(null); onSelectReviewItem?.(null); }
    }}
    onCompleted={() => {
      selectedCache.current.delete(`${organizationId}:${selected.id}`);
      void load();
      onResolved?.();
    }}
    onRefreshEvidence={async () => {
      const request = generation.current;
      await onRefreshEvidence?.();
      const response = await repository.getReviewItem(organizationId, selected.id);
      if (request !== generation.current || response.item.id !== selected.id ||
        response.item.catalogReleaseId !== catalogReleaseId ||
        reviewItemGovernanceState(response.item, domainState).kind === "conflict") throw new Error("审核项或发布版本已变化");
      selectedCache.current.set(`${organizationId}:${response.item.id}`, response.item);
      setSelected(response.item);
      setSelectionError(null);
      return response.item;
    }} /> : null;

  if (embedded && selected) return editor;

  const columns: Column<ReviewItem>[] = [
    {
      key: "id",
      header: "审核对象",
      render: (row) => <div className="review-queue__object">
        <strong>{row.sourceSummary?.compatible ?? row.observation?.propertyKey ?? "待核对来源"}</strong>
        {sourcesOf(row).length > 1 ? <span>涉及 {sourcesOf(row).length} 处来源</span> : null}
        {row.sourceSummary?.compatible && row.observation?.propertyKey ? <span>属性：{row.observation.propertyKey}</span> : null}
        <details><summary>来源详情</summary><dl>
          <dt>审核编号</dt><dd><code title={row.id}>{row.id}</code></dd>
          {sourcesOf(row).map((source, index) => <div key={`${source.projectId}:${source.fileId}:${source.nodeLocator}:${index}`}>
            <dt>来源 {index + 1}</dt><dd>{[source.projectName, source.fileName, source.nodeLocator, source.compatible].filter(Boolean).join(" · ") || "来源信息不可用"}</dd>
          </div>)}
          <dt>证据</dt><dd>{row.sourceSummary?.evidenceCount ?? row.candidates.flatMap((candidate) => candidate.evidence).length} 条</dd>
        </dl></details>
      </div>
    },
    {
      key: "propertyKey",
      header: "来源",
      render: (row) => {
        const sources = sourcesOf(row);
        const projects = [...new Set(sources.map((source) => source.projectName ?? source.projectId).filter(Boolean))];
        const files = [...new Set(sources.map((source) => source.fileName).filter(Boolean))];
        return <div className="review-queue__object"><span>{projects.length > 1 ? `${projects.length} 个项目` : projects[0] ?? "来源待核对"}</span>
          <span>{files.length > 1 ? `${files.length} 个来源文件` : files[0] ?? "未提供文件信息"}</span></div>;
      }
    },
    {
      key: "reason",
      header: "原因",
      className: "whitespace-nowrap",
      render: (row) => reasonLabel(row.reason)
    },
    {
      key: "status",
      header: "状态",
      className: "whitespace-nowrap",
      render: (row) => <span className="parameter-catalog__badge" data-tone="warning">{row.status === "open" ? "待处理" : row.status === "resolved" ? "已处理" : "范围外"}</span>
    }
  ];

  return (
    <section className="parameter-catalog__review review-queue" aria-label={governanceCopy.reviewQueue}>
      <div className="review-queue__toolbar">
        <p>核对来源与识别依据，再选择处理方式。</p>
        <div className="review-queue__tools">
          <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void load()}>刷新列表</Button>
          {actor === "org-admin" ? <Button asChild variant="outline" size="sm"><a href="/audit?kind=parameter-catalog-governance">处理记录</a></Button> : null}
        </div>
      </div>
      {loading ? <SectionSkeleton label={governanceCopy.reviewLoading} /> : null}
      {error ? <SectionError message={error} onRetry={() => void load()} /> : null}
      {!loading && !error && emptyReason ? (
        <><SectionEmpty message={governanceCopy.reviewEmpty} /><p>需要核对来源识别结果时，可在「来源识别」查看当前项目的记录；这里仅显示已进入审核流程的事项。</p><Button asChild variant="outline" size="sm" className="self-start"><a href="/parameter-admin/modules/queue">查看来源识别</a></Button></>
      ) : null}
      {selectionLoading ? <SectionSkeleton label="正在读取链接中的审核项…" /> : null}
      {selectionError ? <SectionError message={selectionError} onRetry={() => setSelectionRetry((value) => value + 1)} /> : null}
      {pageError ? <p role="alert">{pageError}</p> : null}
      {!loading && !error && items.length > 0 ? <>
        <div className="review-queue__filters">
          <SearchField value={query} onValueChange={setQuery} ariaLabel="搜索待审核事项" placeholder="搜索兼容标识、属性或来源" />
          <SelectControl ariaLabel="筛选审核原因" value={reasonFilter} onValueChange={setReasonFilter} size="filter"
            options={[{ value: "all", label: "全部原因" }, ...Object.entries(reviewReasonLabels).map(([value, label]) => ({ value, label }))]} />
          {projectOptions.length > 0 ? <SelectControl ariaLabel="筛选来源项目" value={projectFilter} onValueChange={setProjectFilter} size="filter"
            options={[{ value: "all", label: "全部项目" }, ...projectOptions.map(([value, label]) => ({ value, label }))]} /> : null}
        </div>
        <p className="review-queue__count">已加载 {items.length} 条审核项，当前匹配 {visibleItems.length} 条{nextCursor ? "（仅筛选已加载记录，可继续加载）" : ""}。</p>
      </> : null}
      {!loading && !error && items.length > 0 ? (
        <DataTable
          rows={visibleItems}
          rowKey={(row) => row.id}
          columns={columns}
          ariaLabel={governanceCopy.reviewQueue}
          emptyState={<SectionEmpty message="没有匹配的审核项。" actionLabel="清除筛选" onAction={() => { setQuery(""); setReasonFilter("all"); setProjectFilter("all"); }} />}
          renderRowActions={(row) => {
            if (!canResolve || row.status !== "open") {
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
                  selectedCache.current.set(`${organizationId}:${row.id}`, row);
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
      {nextCursor ? <Button type="button" variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>{pageError ? "重试加载审核项" : loadingMore ? "正在读取下一页…" : "加载更多审核项"}</Button> : pageError ? <Button type="button" variant="outline" onClick={() => void load()}>重新读取队列</Button> : null}
      {editor}
    </section>
  );
}
