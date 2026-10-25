import { useEffect, useRef, useState } from "react";
import { buildCatalogHref, EMPTY_CATALOG_URL_ANCHOR } from "@/application/parameter-catalog/urlAnchor";
import type { ParameterCatalogGovernanceRepository } from "@/application/ports/ParameterCatalogGovernanceRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogDriverCompatibleDiscoveryResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { presentError } from "@/infrastructure/http/presentError";
import { SelectControl } from "@/components/common/SelectControl";
import { Button } from "@/components/ui/button";
import { FileSearch } from "lucide-react";

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

export function CanonicalDriverDiscovery({ governance, catalog, projects = [], organizationId, onNavigate, refreshKey = 0, managedRefresh = false }: {
  governance: ParameterCatalogGovernanceRepository;
  catalog?: ParameterCatalogRepository;
  projects?: readonly { id: string; name: string }[];
  organizationId: string;
  onNavigate?: (path: string) => void;
  refreshKey?: number;
  managedRefresh?: boolean;
}) {
  const generation = useRef(0);
  const [page, setPage] = useState<ReadyPage | null>(null);
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [projectId, setProjectId] = useState("");
  const [subjectNames, setSubjectNames] = useState<Record<string, string>>({});
  const nameCache = useRef<{ pin: string; names: Record<string, string> }>({ pin: "", names: {} });

  useEffect(() => {
    const request = ++generation.current;
    setLoading(true);
    setError(null);
    setPage(null);
    setItems([]);
    setSubjectNames({});
    setCursor(null);
    void governance.listDriverCompatibleDiscovery(organizationId, { limit: 50, ...(projectId ? { projectId } : {}) })
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
  }, [governance, organizationId, projectId, refreshKey, refresh]);

  useEffect(() => {
    let cancelled = false;
    if (!catalog || !page) return;
    const pin = `${organizationId}:${page.catalogRelease.id}:${page.catalogRelease.digest}`;
    if (nameCache.current.pin !== pin) {
      nameCache.current = { pin, names: {} };
      setSubjectNames({});
    }
    const subjectIds = [...new Set(items.flatMap((item) => item.compatibles.flatMap((entry) =>
      entry.candidate.kind === "recognized" && !nameCache.current.names[entry.candidate.subjectId] ? [entry.candidate.subjectId] : [])))];
    void Promise.all(subjectIds.map(async (id) => {
      try {
        const response = await catalog.getSubject(id, { catalogReleaseId: page.catalogRelease.id });
        return response.item.membership.catalogReleaseId === page.catalogRelease.id ? [id, response.item.canonicalName] as const : null;
      } catch { return null; }
    })).then((names) => {
      if (!cancelled) {
        nameCache.current.names = { ...nameCache.current.names, ...Object.fromEntries(names.filter((name) => name !== null)) };
        setSubjectNames(nameCache.current.names);
      }
    });
    return () => { cancelled = true; };
  }, [catalog, items, organizationId, page]);

  const loadMore = async () => {
    if (!page || !cursor || loading) return;
    const request = generation.current;
    const nextCursor = cursor;
    setLoading(true);
    setError(null);
    try {
      const next = await governance.listDriverCompatibleDiscovery(
        organizationId, { cursor: nextCursor, limit: 50, ...(projectId ? { projectId } : {}) }, page.catalogRelease
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
        setCursor(null);
        setError("识别规则已变化，请刷新发现结果。");
        return;
      }
      if (next.nextCursor === nextCursor) {
        setCursor(null);
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

  const sourcePath=(item:DiscoveryItem)=>item.source.status==="current" && item.source.location
    ? `/parameter-admin/projects/${encodeURIComponent(item.projectId)}/configuration?${new URLSearchParams({organizationId,configSet:item.source.configSetId,revision:item.configRevisionId,node:item.source.location.nodeLocator,tab:"source",sourceMode:"history",file:item.source.location.fileId,version:item.source.fileVersionId,line:String(item.source.location.line)})}` : null;
  const navigate = (anchor: { subjectId?: string; reviewItemId?: string },item:DiscoveryItem) => {
    const href=buildCatalogHref({ ...EMPTY_CATALOG_URL_ANCHOR, ...anchor,catalogReleaseId:page?.catalogRelease.id??null,...(sourcePath(item)?{sourceReturn:sourcePath(item)!}:{}) });
    onNavigate?.(`${href}&organizationId=${encodeURIComponent(organizationId)}`);
  };
  const visibleItems = items.filter((item) => {
    if (sourceFilter !== "all" && item.source.status !== sourceFilter) return false;
    const sourceTerms = item.source.status === "current" ? [item.source.sourceName,item.source.location?.nodeLocator]
      : item.source.status === "historical" ? item.source.historicalCompatibles : [];
    return [item.projectId, projects.find((project) => project.id === item.projectId)?.name, item.logicalNodeId, ...sourceTerms,
      ...item.compatibles.flatMap((entry) => [entry.compatible, entry.candidate.kind === "recognized" ? subjectNames[entry.candidate.subjectId] : ""])]
      .join(" ").toLowerCase().includes(search.trim().toLowerCase());
  });

  return <section className="canonical-driver-discovery" aria-label="来源识别结果">
    <div className="canonical-driver-discovery__head">
      <div><h4>来源识别</h4><p className="muted">按项目节点查看 compatible 标识及正式主体匹配。</p></div>
      {!managedRefresh ? <button type="button" className="button subtle" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>刷新发现</button> : null}
    </div>
    <p className="muted">需要复核的记录可打开对应待处理项；已识别的记录可查看主体下的定义。{" "}
      <a href={`${buildCatalogHref(EMPTY_CATALOG_URL_ANCHOR)}?review=open`}>打开待审核事项</a>
    </p>
    <label>项目范围<SelectControl ariaLabel="发现项目范围" value={projectId} onValueChange={setProjectId} size="filter"
      options={[{ value: "", label: "全部可访问项目" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} /></label>
    {error ? <p role="alert" className="parameter-module-mapping-panel__error">{error}</p> : null}
    {loading && !page ? <p role="status">正在读取发现结果…</p> : null}
    {loading && page ? <p role="status">正在读取下一页…</p> : null}
    {page ? <>
      {items.length > 0 || cursor ? <div className="parameter-module-mapping-panel__form">
        <label>搜索发现记录（已加载范围）<input type="search" aria-label="搜索发现记录" placeholder="已加载的 compatible 标识、主体、来源或项目" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <label>来源状态<SelectControl ariaLabel="筛选来源状态" value={sourceFilter} onValueChange={setSourceFilter} size="filter"
          options={[{ value: "all", label: "全部来源" }, { value: "current", label: "当前来源" }, { value: "historical", label: "历史来源" }, { value: "unavailable", label: "来源不可用" }]} /></label>
      </div> : null}
      <p className="muted">已加载 {items.length} 条，匹配 {visibleItems.length} 条（仅筛选已加载记录{cursor ? "，可继续加载下一页" : ""}） · 已忽略复核项：{page.ignoredReviewItemCount === null ? "无权查看" : page.ignoredReviewItemCount}</p>
      {items.length === 0 && cursor === null ? <div className="canonical-discovery-empty">
        <FileSearch aria-hidden="true" />
        <h4>暂无发现记录</h4>
        <p role="status">{page.emptyReason === "no-observations" ? "当前范围没有来源观察记录。" : "当前范围没有兼容发现。"}</p>
        <p>先在项目配置工作台添加来源文件并完成解析，再返回这里刷新发现。项目范围由服务端筛选；关键词仅搜索已加载记录。</p>
        <a className="button subtle" href={projectId ? `/parameter-admin/projects/${encodeURIComponent(projectId)}/configuration` : "/parameter-admin/projects"}>前往项目配置</a>
      </div> : null}
      <ul className="canonical-driver-discovery__list">
        {visibleItems.map((item) => <li key={item.observationId} className="canonical-driver-discovery__item">
          <p><strong>{projects.find((project) => project.id === item.projectId)?.name ?? item.projectId}</strong> · 节点 <code>{item.source.status==="current"&&item.source.location?item.source.location.nodeLocator:item.logicalNodeId}</code></p>
          {sourcePath(item) ? <a href={sourcePath(item)!}>查看固定项目来源</a>:null}
          {item.source.status === "current" ? <p><strong>当前来源：{item.source.sourceName}</strong></p>
            : item.source.status === "historical" ? <p>历史来源。历史 compatible 标识：{item.source.historicalCompatibles.join("；") || "无"}。不可按当前发现操作。</p>
              : <p>来源不可用，暂不能处理此记录。</p>}
          {item.source.status === "current" ? <ul>{item.compatibles.map((entry, index) => <li key={`${entry.compatible}-${index}`}>
            <code>{entry.compatible}</code>{" "}
            {entry.candidate.kind === "recognized" ? <>
              已识别主体：{subjectNames[entry.candidate.subjectId] ?? entry.candidate.subjectId} · {entry.candidate.registrationId === null ? "尚未登记" : "已登记"}
              {onNavigate ? <button type="button" className="button subtle" onClick={() => navigate({ subjectId: entry.candidate.kind === "recognized" ? entry.candidate.subjectId : undefined },item)}>查看主体</button> : null}
            </> : <>
              需要复核（{{ unknown: "尚未识别", ambiguous: "存在多个候选", retired: "主体已停用" }[entry.candidate.reason]}） · {entry.candidate.reviewItemIds === null ? "复核项关联不可查看" : entry.candidate.reviewItemIds.length === 0 ? "没有开放的复核项" : `${entry.candidate.reviewItemIds.length} 个复核项`}
              {entry.candidate.reviewItemIds?.map((id, index) => onNavigate ? <button key={id} type="button" className="button subtle" onClick={() => navigate({ reviewItemId: id },item)}>查看复核项 {index + 1}</button> : null)}
            </>}
          </li>)}</ul> : null}
          <details><summary>记录详情</summary><dl><dt>观察记录</dt><dd>{item.observationId}</dd><dt>项目</dt><dd>{item.projectId}</dd><dt>节点</dt><dd>{item.logicalNodeId}</dd><dt>目录发布</dt><dd>{page.catalogRelease.id}</dd>
            {item.source.status === "current" ? <><dt>文件版本</dt><dd>{item.source.fileVersionId}</dd></> : item.source.status === "historical" ? <><dt>当前配置修订</dt><dd>{item.source.currentConfigRevisionId}</dd></> : <><dt>来源诊断</dt><dd>{item.source.reason}</dd></>}</dl></details>
        </li>)}
      </ul>
      {items.length > 0 && visibleItems.length === 0 ? <p role="status">已加载记录中没有匹配结果，请调整筛选{cursor ? "或加载下一页" : ""}。</p> : null}
      {cursor ? <Button type="button" variant="outline" disabled={loading} onClick={() => void loadMore()}>{error ? "重试加载下一页" : "加载下一页"}</Button> : null}
    </> : null}
    {error && !cursor ? <Button type="button" variant="outline" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>重新读取发现</Button> : null}
  </section>;
}
