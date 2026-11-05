import { useEffect, useState } from "react";
import { DataTable } from "@/components/admin";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogProjectConfigurationsResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";

export function ProjectConfigurations({ repository, organizationId, definitionId, cursor, selectedId, compare = false, baselineId, targetId, projectId, configSetId, search, includeUnconfigured, onChange, onOpenProject }: {
  repository: ParameterCatalogRepository; organizationId?: string; definitionId: string;
  cursor?: string | null; selectedId?: string | null;
  compare?: boolean; baselineId?: string | null; targetId?: string | null;
  projectId?: string | null; configSetId?: string | null; search?: string | null; includeUnconfigured?: string | null;
  onOpenProject?: (row: { bindingId: string; projectId: string; configSetId: string }) => void;
  onChange: (update: { instance?: string | null; instanceCursor?: string | null; baseline?: string | null; target?: string | null; configProjectId?: string | null; configSetId?: string | null; configSearch?: string | null; includeUnconfigured?: string | null }) => void;
}) {
  const [loaded, setLoaded] = useState<{ organizationId?: string; definitionId: string; data: CatalogProjectConfigurationsResponse } | null>(null);
  const [state, setState] = useState<"loading" | "error" | "forbidden" | "stale" | "missing" | "baseline-missing" | "target-missing" | "invalid-filter" | "ready">("loading");
  const [retry, setRetry] = useState(0);
  const [searchInput, setSearchInput] = useState(search ?? "");
  useEffect(() => setSearchInput(search ?? ""), [search]);
  useEffect(() => {
    let active = true;
    setState("loading");
    setLoaded(null);
    if (!repository.getProjectConfigurations) { setState("error"); return () => { active = false; }; }
    repository.getProjectConfigurations(definitionId, { ...(cursor ? { cursor } : {}), ...(selectedId && !compare ? { selectedBindingId: selectedId } : {}),
      ...(compare && baselineId ? { baselineBindingId: baselineId } : {}), ...(compare && baselineId && targetId ? { targetBindingId: targetId } : {}),
      ...(projectId ? { projectId } : {}), ...(configSetId ? { configSetId } : {}), ...(search ? { search } : {}), ...(includeUnconfigured ? { includeUnconfigured: true } : {}) })
      .then((response) => { if (active) { setLoaded({ organizationId, definitionId, data: response }); setState("ready"); } })
      .catch((error: unknown) => {
        if (!active) return;
        setState(error instanceof WiseEffApiError && error.code === "FORBIDDEN" ? "forbidden"
          : error instanceof WiseEffApiError && error.details.reason === "invalid-cursor" ? "stale"
          : error instanceof WiseEffApiError && error.details.reason === "baseline-unavailable" ? "baseline-missing"
          : error instanceof WiseEffApiError && error.details.reason === "target-unavailable" ? "target-missing"
          : error instanceof WiseEffApiError && error.details.reason === "invalid-filter" ? "invalid-filter"
          : error instanceof WiseEffApiError && error.code === "NOT_FOUND" && selectedId ? "missing" : "error");
      });
    return () => { active = false; };
  }, [repository, organizationId, definitionId, cursor, selectedId, compare, baselineId, targetId, projectId, configSetId, search, includeUnconfigured, retry]);

  if (state === "loading" || (loaded && (loaded.organizationId !== organizationId || loaded.definitionId !== definitionId))) return <SectionSkeleton label="正在读取当前项目配置" />;
  const result = loaded?.data;
  if (state === "forbidden") return <SectionError message="没有权限读取当前项目配置。" onRetry={() => setRetry((value) => value + 1)} />;
  if (state === "baseline-missing" || state === "target-missing") return <div role="alert">
    <p>{state === "baseline-missing" ? "基准实例已不可用，请明确重新选择。" : "目标实例已不可用，请重新选择目标。"}</p>
    <button type="button" className="button subtle sm" onClick={() => onChange(state === "baseline-missing" ? { baseline: null, target: null } : { target: null })}>重新选择</button>
  </div>;
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
  for (const row of result.items) groups.set(row.projectId, [...(groups.get(row.projectId) ?? []), row]);
  const status = (comparison: NonNullable<Extract<(typeof result.items)[number], { kind: "instance" }>["comparison"]>) => ({
    same: "类型化值相同", different: "类型化值不同", "different-semantics": "定义语义不同，不计算差值",
    unsupported: "复杂表达式或引用，仅供原文查看", unavailable: "缺少比较所需证据",
  })[comparison.status];
  const detail = (item: NonNullable<typeof result.baseline>, label: string) => <article className="parameter-library-compare__detail">
    <h3>{label}</h3><strong>{item.projectName} / {item.configSetName}</strong>
    <p className="parameter-library-compare__source" title={`${item.fileName} · ${item.sourceLocation}`}>{item.fileName} · {item.sourceLocation}</p><p>值固定修订 #{item.definitionRevisionNumber} · {item.effectiveRevisionId === item.definitionRevisionId ? "生效修订相同" : `生效修订 ${item.effectiveRevisionId}`} · 单位 {item.unit ?? "未说明"}</p>
    <div role="textbox" aria-readonly="true" aria-multiline="true" tabIndex={0} aria-label={`${label}原值`}><pre>{item.rawValue || (item.sourceFormat === "dts" && item.valueKind === "boolean" ? "（布尔属性存在，无值文本）" : "（空值）")}</pre></div>
    <details><summary>实例与值身份</summary><p>{item.fileName} · {item.sourceLocation}<br />Binding {item.bindingId}<br />ProjectValue {item.currentValueId}<br />值固定修订 {item.definitionRevisionId}</p></details>
  </article>;
  return <div className="parameter-library-configurations">
    <p className="parameter-catalog__muted">当前组织 · 已配置项目 {result.summary.configuredProjectCount} · 已配置实例 {result.summary.configuredInstanceCount} · 筛选结果 {result.totalCount} 条（本页 {result.items.length} 条）</p>
    <p className="parameter-catalog__muted">当前平台配置包含所有配置集，并非设备运行状态；历史定义仍显示当前配置。</p>
    {compare ? <section className="parameter-library-compare" aria-label="实例对比">
      {!baselineId && targetId ? <p role="alert">目标需要先选择基准；请选择基准后重新选择目标。</p> : null}
      {!result.baseline ? <p>请选择基准实例，然后选择目标查看焦点对比。每个实例均按其固定的定义修订解释。</p> : <>
        {result.target?.comparison ? <p role="status"><strong>{status(result.target.comparison)}</strong>{result.target.comparison.revisionChanged ? " · 固定修订不同" : ""}
          {result.target.comparison.delta !== undefined ? ` · 目标 − 基准：${result.target.comparison.delta} ${result.target.unit ?? ""}` : ""}</p> : null}
        <div className="parameter-library-compare__pair">{detail(result.baseline, "基准实例")}{result.target ? detail(result.target, "目标实例") : <p>选择一行作为目标，以查看焦点对比。</p>}</div>
        <button type="button" className="button subtle sm" onClick={() => onChange({ baseline: null, target: null })}>更换基准</button>
      </>}
    </section> : null}
    <form className="parameter-library-filters" onSubmit={(event) => { event.preventDefault(); onChange({ configSearch: searchInput.trim() || null, instanceCursor: null }); }}>
      <label>项目 <select value={projectId ?? ""} onChange={(event) => onChange({ configProjectId: event.target.value || null, configSetId: null, instanceCursor: null })}>
        <option value="">全部项目</option>{result.projects?.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      <label>配置集 <select value={configSetId ?? ""} disabled={!projectId && !configSetId} onChange={(event) => onChange({ configSetId: event.target.value || null, instanceCursor: null })}>
        <option value="">{projectId ? "全部配置集" : "先选择项目"}</option>{result.configSets?.map((set) => <option key={set.id} value={set.id}>{!projectId ? `${result.projects?.find((project) => project.id === set.projectId)?.name ?? set.projectId} / ` : ""}{set.name}</option>)}
      </select></label>
      <label>实例 / 来源 <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /></label>
      <button type="submit" className="button subtle sm">筛选</button>
      <label><input type="checkbox" checked={Boolean(includeUnconfigured)} onChange={(event) => onChange({ includeUnconfigured: event.target.checked ? "true" : null, instanceCursor: null })} /> 显示无当前配置项目</label>
      <button type="button" className="button subtle sm" onClick={() => { setSearchInput(""); onChange({ configProjectId: null, configSetId: null, configSearch: null, includeUnconfigured: null, instanceCursor: null }); }}>重置筛选</button>
    </form>
    {result.items.length === 0 ? <SectionEmpty message={projectId || configSetId || search || includeUnconfigured ? "没有匹配的项目配置，请调整或重置筛选。" : "当前没有可显示的项目配置。"} /> : [...groups.entries()].map(([projectId, items]) => <section key={projectId} className={items[0]?.kind === "project-status" ? "parameter-library-project-status" : undefined}>
      <h3>{items[0]!.projectName}{result.continuedProjectId === projectId ? "（续）" : ""}</h3>
      {items[0]?.kind === "project-status" ? <p>无当前配置</p> : <DataTable rows={items.filter((row) => row.kind === "instance")} rowKey={(row) => row.bindingId} aria-label={`${items[0]!.projectName} 的当前配置`} pageSize={items.length} tableClassName={compare ? "parameter-library-comparison-table" : "parameter-library-instances-table"}
        columns={[
          { key: "source", header: "配置集 / 来源", render: (row) => <><strong>{row.configSetName}</strong><br /><span className="parameter-catalog__muted">{row.fileName} · {row.sourceFormat.toUpperCase()}</span><br /><code>{row.sourceLocation}</code></> },
          { key: "value", header: "当前值", render: (row) => row.valueState === "unset" ? "未设置" : <><code>{row.sourceFormat === "dts" && row.valueKind === "boolean" ? "存在" : row.valuePreview}{row.valuePreviewTruncated ? "…" : ""}</code>{row.unit ? ` ${row.unit}` : null}</> },
          { key: "revision", header: "值固定修订", render: (row) => <>#{row.definitionRevisionNumber}</> },
          ...(compare ? [{ key: "comparison", header: "相对基准", render: (row: Extract<(typeof result.items)[number], { kind: "instance" }>) => row.comparison ? status(row.comparison) : "尚未选择基准" }] : []),
        ]}
        renderRowActions={(row) => <div>{compare ? <><button type="button" className="button subtle sm" disabled={row.valueState === "unset"}
          onClick={() => onChange({ baseline: row.bindingId, target: null })}>设为基准</button>{baselineId ? <button type="button" className="button subtle sm" disabled={row.valueState === "unset"}
          onClick={() => onChange({ target: row.bindingId })}>查看对比</button> : null}</> : <button type="button" className="button subtle sm" aria-label={`查看 ${row.fileName} 的完整值`}
          disabled={row.valueState === "unset"} onClick={() => onChange({ instance: row.bindingId })}>查看完整值</button>}
          {onOpenProject ? <button type="button" className="button subtle sm" disabled={row.valueState === "unset"} aria-label={`在项目中打开 ${row.fileName} ${row.sourceLocation}`}
            onClick={() => onOpenProject(row)}>在项目中打开</button> : null}</div>} />}
    </section>)}
    {result.selected ? <section aria-label="选中的完整值"><h3>完整值 · {result.selected.projectName} / {result.selected.fileName}</h3>
      {result.selected.sourceFormat === "dts" && result.selected.valueKind === "boolean" ? <p>布尔属性以存在表示，无值文本。</p> : null}<pre>{result.selected.rawValue}</pre>
      <button type="button" className="button subtle sm" onClick={() => onChange({ instance: null })}>关闭完整值</button></section> : null}
    {cursor ? <button type="button" className="button subtle sm" onClick={() => onChange({ instanceCursor: null, instance: null })}>返回第一页</button> : null}
    {result.nextCursor ? <button type="button" className="button subtle sm" onClick={() => onChange({ instanceCursor: result.nextCursor, instance: null })}>下一页</button> : null}
  </div>;
}
