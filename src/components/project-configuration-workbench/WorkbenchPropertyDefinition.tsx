import { useEffect, useState } from "react";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CanonicalDtsDefinitionDetail } from "@/domain/parameter-topology/types";
import { formatParameterConstraints } from "@/domain/parameter-topology/formatParameterConstraints";
import { loadCanonicalDtsDefinitionDetail } from "@/application/parameters/loadCanonicalDtsDefinitionDetail";
import { presentError } from "@/infrastructure/http/presentError";

export function WorkbenchPropertyDefinition({ projectId, revisionId, fileId, nodePath, propertyName, topologyRepository, catalogRepository }: {
  projectId: string; revisionId: string | null; fileId: string; nodePath: string; propertyName: string;
  topologyRepository?: Pick<ParameterTopologyRepository, "listBindings">;
  catalogRepository?: Pick<ParameterCatalogRepository, "getDefinitionRevision">;
}) {
  const [detail, setDetail] = useState<CanonicalDtsDefinitionDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError("");
    if (!revisionId || !topologyRepository || !catalogRepository) { setLoading(false); return; }
    setLoading(true);
    void (async () => {
      const bindings = await topologyRepository.listBindings(projectId, revisionId);
      const matches = bindings.filter((binding) => (!binding.projectId || binding.projectId === projectId)
        && binding.sourceFileId === fileId && binding.sourceNodePath === nodePath && binding.propertyKey === propertyName);
      if (matches.length !== 1 || cancelled) return;
      const binding = matches[0]!;
      if (!binding.definitionId || !(binding.effectiveRevisionId || binding.definitionRevisionId)) return;
      const next = await loadCanonicalDtsDefinitionDetail(catalogRepository, {
        definitionId: binding.definitionId!, revisionId: (binding.effectiveRevisionId || binding.definitionRevisionId)!, propertyKey: propertyName
      });
      if (!cancelled) setDetail(next);
    })().catch((cause) => { if (!cancelled) setError(presentError(cause, "参数定义加载失败。")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [catalogRepository, fileId, nodePath, projectId, propertyName, revisionId, retry, topologyRepository]);
  const constraints = formatParameterConstraints(detail?.constraints);
  return <section className="configuration-workbench__property-definition" aria-label="参数含义与约束">
    {loading ? <p role="status">正在加载参数定义…</p> : error ? <p role="alert">{error} <button type="button" className="button subtle" onClick={() => setRetry((value) => value + 1)}>重试定义</button></p>
      : detail ? <>
        {detail.displayName !== propertyName ? <strong>{detail.displayName}</strong> : null}
        {detail.documentation ? <p>{detail.documentation}</p> : <p className="muted">尚无参数说明。</p>}
        <dl><div><dt>单位</dt><dd>{detail.unit || "未提供"}</dd></div><div><dt>取值约束</dt><dd>{constraints || "未提供业务约束；仍需符合下方类型语法。"}</dd></div></dl>
      </> : <p className="muted">当前属性没有唯一关联的参数定义，单位与业务约束尚不可用。</p>}
  </section>;
}
