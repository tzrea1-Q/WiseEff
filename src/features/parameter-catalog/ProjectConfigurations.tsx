import { useEffect, useState } from "react";
import { DataTable } from "@/components/admin";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogProjectConfigurationsResponse } from "@/infrastructure/http/parameterCatalogDtos";

export function ProjectConfigurations({ repository, organizationId, definitionId, cursor, selectedId, onChange }: {
  repository: ParameterCatalogRepository; organizationId?: string; definitionId: string;
  cursor?: string | null; selectedId?: string | null;
  onChange: (update: { instance?: string | null; instanceCursor?: string | null }) => void;
}) {
  const [result, setResult] = useState<CatalogProjectConfigurationsResponse | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState("loading");
    setResult(null);
    if (!repository.getProjectConfigurations) { setState("error"); return () => { active = false; }; }
    repository.getProjectConfigurations(definitionId, { ...(cursor ? { cursor } : {}), ...(selectedId ? { selectedBindingId: selectedId } : {}) })
      .then((response) => { if (active) { setResult(response); setState("ready"); } })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [repository, organizationId, definitionId, cursor, selectedId, retry]);

  if (state === "loading") return <SectionSkeleton label="正在读取当前项目配置" />;
  if (state === "error" || !result) return <SectionError message="当前项目配置不可用，可能没有读取权限或来源证据不完整。" onRetry={() => setRetry((value) => value + 1)} />;
  const groups = new Map<string, typeof result.items>();
  for (const row of result.items) groups.set(row.projectId, [...(groups.get(row.projectId) ?? []), row]);
  return <div className="parameter-library-configurations">
    <p className="parameter-catalog__muted">当前组织 · 已配置项目 {result.summary.configuredProjectCount} · 已配置实例 {result.summary.configuredInstanceCount}</p>
    <p className="parameter-catalog__muted">显示当前平台配置，包含所有配置集；并非设备运行状态。历史定义仍显示当前配置。</p>
    {result.items.length === 0 ? <SectionEmpty message="当前没有可显示的项目配置。" /> : [...groups.entries()].map(([projectId, items]) => <section key={projectId}>
      <h3>{items[0]!.projectName}{result.continuedProjectId === projectId ? "（续）" : ""}</h3>
      <DataTable rows={items} rowKey={(row) => row.bindingId} aria-label={`${items[0]!.projectName} 的当前配置`} pageSize={items.length}
        columns={[
          { key: "source", header: "配置集 / 来源", render: (row) => <><strong>{row.configSetName}</strong><br /><span className="parameter-catalog__muted">{row.fileName} · {row.sourceFormat.toUpperCase()}</span><br /><code>{String(row.sourceLocator.pointer ?? row.sourceLocator.propertyName ?? "")}</code></> },
          { key: "value", header: "当前值", render: (row) => row.valueState === "unset" ? "未设置" : <><code>{row.valuePreview}{row.valuePreviewTruncated ? "…" : ""}</code>{row.unit ? ` ${row.unit}` : null}</> },
          { key: "revision", header: "值固定修订", render: (row) => <>#{row.definitionRevisionNumber}</> },
        ]}
        renderRowActions={(row) => <button type="button" className="button subtle sm" aria-label={`查看 ${row.fileName} 的完整值`}
          disabled={row.valueState === "unset"} onClick={() => onChange({ instance: row.bindingId })}>查看完整值</button>} />
    </section>)}
    {result.selected ? <section aria-label="选中的完整值"><h3>完整值 · {result.selected.projectName} / {result.selected.fileName}</h3><pre>{result.selected.rawValue}</pre>
      <button type="button" className="button subtle sm" onClick={() => onChange({ instance: null })}>关闭完整值</button></section> : null}
    {cursor ? <button type="button" className="button subtle sm" onClick={() => onChange({ instanceCursor: null, instance: null })}>返回第一页</button> : null}
    {result.nextCursor ? <button type="button" className="button subtle sm" onClick={() => onChange({ instanceCursor: result.nextCursor, instance: null })}>下一页</button> : null}
  </div>;
}
