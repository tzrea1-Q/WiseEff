import { useEffect, useRef, useState } from "react";
import { buildCatalogHref, EMPTY_CATALOG_URL_ANCHOR } from "@/application/parameter-catalog/urlAnchor";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { CatalogDriverCompatibleDiscoveryResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";

type ReadyPage = Extract<CatalogDriverCompatibleDiscoveryResponse, { status: "ready" }>;
type DiscoveryItem = ReadyPage["items"][number];

const unavailableText = {
  "catalog-unavailable": "规范目录暂不可用，请稍后刷新。",
  "release-drift": "目录发布已变化，请刷新发现结果。",
  "review-evidence-limit": "复核证明超出可读取范围，请缩小范围后刷新。",
  "review-evidence-invalid": "复核证明不可用，请刷新后重试。"
} as const;
const unavailableMessage = (reason: string) =>
  unavailableText[reason as keyof typeof unavailableText] ?? "发现服务暂不可用，请刷新后重试。";
const isReleaseDrift = (cause: unknown) =>
  cause instanceof WiseEffApiError && cause.code === "CONFLICT" && cause.details.reason === "release-drift";
const discoveryErrorMessage = (cause: unknown) =>
  isReleaseDrift(cause) ? unavailableText["release-drift"] : presentError(cause, "发现结果加载失败，请刷新。");

export function CanonicalDriverDiscovery({ governance, organizationId, onNavigate, refreshKey = 0 }: {
  governance: ParameterCatalogGovernanceRepository;
  organizationId: string;
  onNavigate?: (path: string) => void;
  refreshKey?: number;
}) {
  const generation = useRef(0);
  const [page, setPage] = useState<ReadyPage | null>(null);
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    setPage(null);
    setItems([]);
    setCursor(null);
    void governance.listDriverCompatibleDiscovery(organizationId, { limit: 50 })
      .then((result) => {
        if (request !== generation.current) return;
        if (result.status === "unavailable") {
          setError(unavailableMessage(result.reason));
          return;
        }
        setPage(result);
        setItems([...result.items]);
        setCursor(result.nextCursor);
      })
      .catch((cause) => {
        if (request === generation.current) setError(discoveryErrorMessage(cause));
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    return () => { generation.current += 1; };
  }, [governance, organizationId, refreshKey, refresh]);

  const loadMore = async () => {
    if (!page || !cursor || loading) return;
    const request = generation.current;
    const nextCursor = cursor;
    setLoading(true);
    setError(null);
    try {
      const next = await governance.listDriverCompatibleDiscovery(
        organizationId, { cursor: nextCursor, limit: 50 }, page.catalogRelease
      );
      if (request !== generation.current) return;
      if (next.status === "unavailable") {
        if (next.reason === "release-drift") setCursor(null);
        setError(unavailableMessage(next.reason));
        return;
      }
      if (next.catalogRelease.id !== page.catalogRelease.id ||
          next.catalogRelease.digest !== page.catalogRelease.digest) {
        setCursor(null);
        setError(unavailableText["release-drift"]);
        return;
      }
      if (next.matcherRevision !== page.matcherRevision) {
        setError("识别规则已变化，请刷新发现结果。");
        return;
      }
      if (next.nextCursor === nextCursor) {
        setError("发现结果返回重复游标，请刷新后重试。");
        return;
      }
      setItems((current) => [...current, ...next.items]);
      setCursor(next.nextCursor);
    } catch (cause) {
      if (request === generation.current) {
        if (isReleaseDrift(cause)) setCursor(null);
        setError(discoveryErrorMessage(cause));
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };

  const navigate = (anchor: { subjectId?: string; reviewItemId?: string }) => {
    onNavigate?.(buildCatalogHref({ ...EMPTY_CATALOG_URL_ANCHOR, ...anchor }));
  };

  return <section className="canonical-driver-discovery" aria-label="驱动兼容发现">
    <div className="canonical-driver-discovery__head">
      <div><h4>驱动兼容发现</h4><p className="muted">按来源观察记录展示完整 compatible 和规范识别结果。</p></div>
      <button type="button" className="button subtle" onClick={() => setRefresh((value) => value + 1)}>刷新发现</button>
    </div>
    <p className="muted">组织覆盖解析编写已退役。覆盖变更请提交定义提案，并通过 Catalog 发布流程生效。{" "}
      <a href={buildCatalogHref(EMPTY_CATALOG_URL_ANCHOR)}>前往 Catalog 提交定义提案</a>
    </p>
    {error ? <p role="alert" className="parameter-module-mapping-panel__error">{error}</p> : null}
    {loading && !page ? <p role="status">正在读取发现结果…</p> : null}
    {loading && page ? <p role="status">正在读取下一页…</p> : null}
    {page ? <>
      <p className="muted">目录发布 {page.catalogRelease.id} · 已忽略复核项：{page.ignoredReviewItemCount === null ? "无权查看" : page.ignoredReviewItemCount}</p>
      {items.length === 0 && cursor === null ? <p role="status">{page.emptyReason === "no-observations" ? "当前范围没有来源观察记录。" : "当前范围没有兼容发现。"}</p> : null}
      <ul className="canonical-driver-discovery__list">
        {items.map((item) => <li key={item.observationId} className="canonical-driver-discovery__item">
          <div><strong>观察记录 {item.observationId}</strong> · 项目 {item.projectId} · 节点 {item.logicalNodeId}</div>
          {item.source.status === "current" ? <p>当前来源：{item.source.sourceName} · 文件版本 {item.source.fileVersionId}</p>
            : item.source.status === "historical" ? <p>历史来源；当前配置修订 {item.source.currentConfigRevisionId}。历史 compatible：{item.source.historicalCompatibles.join("；") || "无"}。不可按当前发现操作。</p>
              : <p>来源不可用：{item.source.reason}。不可按当前发现操作。</p>}
          {item.source.status === "current" ? <ul>{item.compatibles.map((entry, index) => <li key={`${entry.compatible}-${index}`}>
            <code>{entry.compatible}</code>{" "}
            {entry.candidate.kind === "recognized" ? <>
              已识别主体 {entry.candidate.subjectId} · {entry.candidate.registrationId === null ? "尚未登记" : `登记 ${entry.candidate.registrationId}`}
              {onNavigate ? <button type="button" className="button subtle" onClick={() => navigate({ subjectId: entry.candidate.kind === "recognized" ? entry.candidate.subjectId : undefined })}>查看主体</button> : null}
            </> : <>
              需要复核（{entry.candidate.reason}） · {entry.candidate.reviewItemIds === null ? "复核项关联不可查看" : entry.candidate.reviewItemIds.length === 0 ? "没有开放的复核项" : `${entry.candidate.reviewItemIds.length} 个复核项`}
              {entry.candidate.reviewItemIds?.map((id) => onNavigate ? <button key={id} type="button" className="button subtle" onClick={() => navigate({ reviewItemId: id })}>查看复核项 {id}</button> : <span key={id}>{id}</span>)}
            </>}
          </li>)}</ul> : null}
        </li>)}
      </ul>
      {cursor ? <button type="button" className="button subtle" disabled={loading || !!error} onClick={() => void loadMore()}>加载下一页</button> : null}
    </> : null}
  </section>;
}
