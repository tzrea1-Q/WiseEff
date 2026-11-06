import { useEffect, useRef, useState } from "react";
import { DataTable } from "@/components/admin";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogProjectConfigurationsResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { formatAbsolute } from "@/domain/format/formatDateTime";
import { SelectControl } from "@/components/common/SelectControl";
import { SearchField } from "@/components/common/SearchField";

export function ProjectConfigurations({ repository, organizationId, definitionId, cursor, selectedId, projectId, configSetId, search, includeUnconfigured, onChange, onOpenProject }: {
  repository: ParameterCatalogRepository; organizationId?: string; definitionId: string;
  cursor?: string | null; selectedId?: string | null;
  projectId?: string | null; configSetId?: string | null; search?: string | null; includeUnconfigured?: string | null;
  onOpenProject?: (row: { bindingId: string; projectId: string; configSetId: string }) => void;
  onChange: (update: { instance?: string | null; instanceCursor?: string | null; configProjectId?: string | null; configSetId?: string | null; configSearch?: string | null; includeUnconfigured?: string | null }) => void;
}) {
  const readContext = JSON.stringify([organizationId, definitionId, cursor, selectedId, projectId, configSetId, search, includeUnconfigured]);
  const [loaded, setLoaded] = useState<{ repository: ParameterCatalogRepository; context: string; data: CatalogProjectConfigurationsResponse } | null>(null);
  const [state, setState] = useState<"loading" | "error" | "forbidden" | "stale" | "missing" | "invalid-filter" | "ready">("loading");
  const [retry, setRetry] = useState(0);
  const [searchInput, setSearchInput] = useState(search ?? "");
  const [copyState, setCopyState] = useState<"success" | "error" | null>(null);
  const projectControl = useRef<HTMLButtonElement>(null);
  const configSetControl = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<"project" | "configSet" | null>(null);
  useEffect(() => {
    if (state !== "ready" || !restoreFocus.current) return;
    (restoreFocus.current === "project" ? projectControl : configSetControl).current?.focus();
    restoreFocus.current = null;
  }, [state]);
  useEffect(() => setSearchInput(search ?? ""), [search]);
  useEffect(() => {
    let active = true;
    setState("loading");
    setLoaded(null);
    setCopyState(null);
    if (!repository.getProjectConfigurations) { setState("error"); return () => { active = false; }; }
    repository.getProjectConfigurations(definitionId, { ...(cursor ? { cursor } : {}), ...(selectedId ? { selectedBindingId: selectedId } : {}),
      ...(projectId ? { projectId } : {}), ...(configSetId ? { configSetId } : {}), ...(search ? { search } : {}), ...(includeUnconfigured ? { includeUnconfigured: true } : {}) })
      .then((response) => { if (active) { setLoaded({ repository, context: readContext, data: response }); setState("ready"); } })
      .catch((error: unknown) => {
        if (!active) return;
        setState(error instanceof WiseEffApiError && error.code === "FORBIDDEN" ? "forbidden"
          : error instanceof WiseEffApiError && error.details.reason === "invalid-cursor" ? "stale"
          : error instanceof WiseEffApiError && error.details.reason === "invalid-filter" ? "invalid-filter"
          : error instanceof WiseEffApiError && error.code === "NOT_FOUND" && selectedId ? "missing" : "error");
      });
    return () => { active = false; };
  }, [repository, organizationId, definitionId, cursor, selectedId, projectId, configSetId, search, includeUnconfigured, retry, readContext]);

  if (state === "loading" || (loaded && (loaded.repository !== repository || loaded.context !== readContext))) return <SectionSkeleton label="正在读取当前项目配置" />;
  const result = loaded?.data;
  if (state === "forbidden") return <SectionError message="没有权限读取当前项目配置。" onRetry={() => setRetry((value) => value + 1)} />;
  if (state === "invalid-filter") return <div role="alert"><p>所选项目或配置集在当前组织中不可用。</p>
    <button type="button" className="button subtle sm" onClick={() => onChange({ configProjectId: null, configSetId: null, instanceCursor: null })}>重置项目和配置集</button></div>;
  if (state === "stale" || state === "missing") return <div role="alert">
    <p>{state === "stale" ? "项目配置已变化，请返回第一页重新读取。" : "选中的实例已不可用，请重新选择。"}</p>
    <button type="button" className="button subtle sm" onClick={() => onChange({ instance: null, ...(state === "stale" ? { instanceCursor: null } : {}) })}>
      {state === "stale" ? "返回第一页" : "重新选择"}
    </button>
  </div>;
  if (state === "error" || !result) return <>
    <SectionError message="当前项目配置不可用，请检查来源后重试。" onRetry={() => setRetry((value) => value + 1)} />
    {selectedId ? <button type="button" className="button subtle sm" onClick={() => onChange({ instance: null })}>返回实例列表</button> : null}
  </>;
  const groups = new Map<string, typeof result.items>();
  const copyValue = async (raw: string) => {
    try { await navigator.clipboard.writeText(raw); setCopyState("success"); }
    catch { setCopyState("error"); }
  };
  for (const row of result.items) groups.set(row.projectId, [...(groups.get(row.projectId) ?? []), row]);
  return <div className="parameter-library-configurations">
    <div className="parameter-library-configurations__summary">
      <span>{configSetId ? "所选配置集范围" : projectId ? "所选项目范围" : "当前组织范围"}</span>
      <span>已配置项目 {result.summary.configuredProjectCount} · 已配置实例 {result.summary.configuredInstanceCount}</span>
      <span className="parameter-catalog__muted">筛选结果 {result.totalCount} 条（本页 {result.items.length} 条）</span>
    </div>
    <p className="parameter-library-configurations__note">读取于 {formatAbsolute(result.readAt)} · 数据可能已变化。当前平台配置包含所有配置集，并非设备运行状态；历史定义仍显示当前配置。</p>
    {copyState === "success" ? <p role="status">已复制本次读取的完整原值；来源专属引用未必适用于其他项目。</p> : null}
    {copyState === "error" ? <p role="alert">复制失败，请检查剪贴板权限后重试；选择仍保留。</p> : null}
    <form className="parameter-library-filters" onSubmit={(event) => { event.preventDefault(); onChange({ configSearch: searchInput.trim() || null, instanceCursor: null }); }}>
      <div className="parameter-library-filter"><span>项目</span><SelectControl ref={projectControl} ariaLabel="项目" size="filter" value={projectId ?? ""} onValueChange={(value) => { restoreFocus.current = "project"; onChange({ configProjectId: value || null, configSetId: null, instanceCursor: null }); }}
        options={[{ value: "", label: "全部项目" }, ...(result.projects ?? []).map((project) => ({ value: project.id, label: project.name }))]} /></div>
      <div className="parameter-library-filter"><span>配置集</span><SelectControl ref={configSetControl} ariaLabel="配置集" size="filter" value={configSetId ?? ""} disabled={!projectId && !configSetId} onValueChange={(value) => { restoreFocus.current = "configSet"; onChange({ configSetId: value || null, instanceCursor: null }); }}
        options={[{ value: "", label: projectId ? "全部配置集" : "先选择项目" }, ...(result.configSets ?? []).map((set) => ({ value: set.id, label: `${!projectId ? `${result.projects?.find((project) => project.id === set.projectId)?.name ?? set.projectId} / ` : ""}${set.name}` }))]} /></div>
      <div className="parameter-library-filter"><span>实例 / 来源</span><SearchField ariaLabel="实例 / 来源" value={searchInput} onValueChange={setSearchInput} /></div>
      <button type="submit" className="button subtle sm">筛选</button>
      <label><input type="checkbox" checked={Boolean(includeUnconfigured)} onChange={(event) => onChange({ includeUnconfigured: event.target.checked ? "true" : null, instanceCursor: null })} /> 显示无当前配置项目</label>
      <button type="button" className="button subtle sm" onClick={() => { setSearchInput(""); onChange({ configProjectId: null, configSetId: null, configSearch: null, includeUnconfigured: null, instanceCursor: null }); }}>重置筛选</button>
    </form>
    {result.selected ? <section className="parameter-library-configurations__value" aria-label="选中的完整值">
      <div className="parameter-library-detail__section-heading"><h3>完整值 · {result.selected.projectName} / {result.selected.fileName}</h3>
        <div className="parameter-catalog__actions"><button type="button" className="button subtle sm" disabled={result.selected.rawValue === undefined} onClick={() => { if (result.selected?.rawValue !== undefined) void copyValue(result.selected.rawValue); }}>复制完整原值</button>
        <button type="button" className="button subtle sm" onClick={() => onChange({ instance: null })}>关闭完整值</button></div>
      </div>
      {result.selected.sourceFormat === "dts" && result.selected.valueKind === "boolean" ? <p>布尔属性以存在表示，无值文本。</p> : null}
      <div className="parameter-library-code" role="textbox" aria-label="选中实例完整原值" aria-readonly="true" aria-multiline="true" tabIndex={0}>
        <pre>{result.selected.rawValue ?? "（完整原值不可用）"}</pre>
      </div>
    </section> : null}
    {result.items.length === 0 ? <SectionEmpty message={projectId || configSetId || search || includeUnconfigured ? "没有匹配的项目配置，请调整或重置筛选。" : "当前没有可显示的项目配置。"} /> : [...groups.entries()].map(([projectId, items]) => <section key={projectId} className={items[0]?.kind === "project-status" ? "parameter-library-project-status" : "parameter-library-configurations__project"}>
      <div className="parameter-library-configurations__project-heading"><h3>{items[0]!.projectName}{result.continuedProjectId === projectId ? "（续）" : ""}</h3>
        {items[0]?.kind !== "project-status" ? <span className="parameter-catalog__muted">本页 {items.length} 个实例</span> : null}</div>
      {items[0]?.kind === "project-status" ? <p>无当前配置</p> : <DataTable rows={items.filter((row) => row.kind === "instance")} rowKey={(row) => row.bindingId} aria-label={`${items[0]!.projectName} 的当前配置`} pageSize={items.length} tableClassName="parameter-library-instances-table"
        columns={[
          { key: "source", header: "配置集 / 来源", render: (row) => <div className="parameter-library-instance-source"><strong>{row.configSetName}</strong><span className="parameter-catalog__muted">{row.fileName} · {row.sourceFormat.toUpperCase()}</span><code>{row.sourceLocation}</code></div> },
          { key: "value", header: "当前值", render: (row) => row.valueState === "unset" ? "未设置" : <div className="parameter-library-instance-value"><code>{row.sourceFormat === "dts" && row.valueKind === "boolean" ? "存在" : row.valuePreview}{row.valuePreviewTruncated ? "…" : ""}</code>{row.unit ? ` ${row.unit}` : null}</div> },
          { key: "revision", header: "值固定修订", render: (row) => <>#{row.definitionRevisionNumber}</> },
        ]}
        renderRowActions={(row) => <div className="parameter-library-instance-actions"><button type="button" className="button subtle sm" aria-label={`查看 ${row.fileName} 的完整值`}
          disabled={row.valueState === "unset"} onClick={() => onChange({ instance: row.bindingId })}>查看完整值</button>
          {onOpenProject ? <button type="button" className="button subtle sm" disabled={row.valueState === "unset"} aria-label={`在项目中打开 ${row.fileName} ${row.sourceLocation}`}
            onClick={() => onOpenProject(row)}>在项目中打开</button> : null}</div>} />}
    </section>)}
    {cursor ? <button type="button" className="button subtle sm" onClick={() => onChange({ instanceCursor: null, instance: null })}>返回第一页</button> : null}
    {result.nextCursor ? <button type="button" className="button subtle sm" onClick={() => onChange({ instanceCursor: result.nextCursor, instance: null })}>下一页</button> : null}
  </div>;
}
