import { useCallback, useEffect, useRef, useState } from "react";
import type { ParameterTopologyRepository } from "@/application/ports/ParameterTopologyRepository";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CanonicalDtsDefinitionDetail } from "@/domain/parameter-topology/types";
import { formatParameterConstraints } from "@/domain/parameter-topology/formatParameterConstraints";
import { loadCanonicalDtsDefinitionDetail } from "@/application/parameters/loadCanonicalDtsDefinitionDetail";
import { presentError } from "@/infrastructure/http/presentError";
import { formatDtsValueSchema } from "@/domain/dts/dtsValueSchema";

type DefinitionInput = {
  projectId: string; revisionId: string | null; fileId: string | null; nodePath: string | null; propertyName: string | null;
  topologyRepository?: Pick<ParameterTopologyRepository, "listBindings">;
  catalogRepository?: Pick<ParameterCatalogRepository, "getDefinitionRevision">;
};

export type WorkbenchDefinitionState = {
  detail: CanonicalDtsDefinitionDetail | null;
  status: "unavailable" | "loading" | "ready" | "missing" | "ambiguous" | "error";
  error: string;
  retry: () => void;
};

export function useWorkbenchPropertyDefinition({ projectId, revisionId, fileId, nodePath, propertyName, topologyRepository, catalogRepository }: DefinitionInput): WorkbenchDefinitionState {
  const identity = JSON.stringify([projectId, revisionId, fileId, nodePath, propertyName]);
  const [state, setState] = useState<{ identity: string; detail: CanonicalDtsDefinitionDetail | null; status: WorkbenchDefinitionState["status"]; error: string }>({ identity: "", detail: null, status: "unavailable", error: "" });
  const [retry, setRetry] = useState(0);
  const bindingCache = useRef<{ projectId: string; revisionId: string; repository: NonNullable<DefinitionInput["topologyRepository"]>; promise: ReturnType<NonNullable<DefinitionInput["topologyRepository"]>["listBindings"]> } | null>(null);
  const retryDefinition = useCallback(() => { bindingCache.current = null; setRetry((value) => value + 1); }, []);
  useEffect(() => {
    let cancelled = false;
    const update = (status: WorkbenchDefinitionState["status"], detail: CanonicalDtsDefinitionDetail | null = null, error = "") => {
      if (!cancelled) setState({ identity, status, detail, error });
    };
    if (!revisionId || !topologyRepository || !catalogRepository || fileId === null || nodePath === null || propertyName === null) {
      update("unavailable"); return;
    }
    update("loading");
    void (async () => {
      const cached = bindingCache.current;
      const request = cached?.projectId === projectId && cached.revisionId === revisionId && cached.repository === topologyRepository
        ? cached.promise : topologyRepository.listBindings(projectId, revisionId);
      bindingCache.current = { projectId, revisionId, repository: topologyRepository, promise: request };
      const bindings = await request;
      const matches = bindings.filter((binding) => (!binding.projectId || binding.projectId === projectId)
        && binding.sourceFileId === fileId && binding.sourceNodePath === nodePath && binding.propertyKey === propertyName);
      if (cancelled) return;
      if (matches.length !== 1) { update(matches.length ? "ambiguous" : "missing"); return; }
      const binding = matches[0]!;
      if (!binding.definitionId || !(binding.effectiveRevisionId || binding.definitionRevisionId)) { update("unavailable"); return; }
      const next = await loadCanonicalDtsDefinitionDetail(catalogRepository, {
        definitionId: binding.definitionId!, revisionId: (binding.effectiveRevisionId || binding.definitionRevisionId)!, propertyKey: propertyName
      });
      update("ready", next);
    })().catch((cause) => { update("error", null, presentError(cause, "参数定义加载失败。")); });
    return () => { cancelled = true; };
  }, [catalogRepository, fileId, identity, nodePath, projectId, propertyName, revisionId, retry, topologyRepository]);
  return { ...(state.identity === identity ? state : { detail: null, status: "loading" as const, error: "" }), retry: retryDefinition };
}

export function WorkbenchPropertyDefinitionContent({ state, propertyName }: { state: WorkbenchDefinitionState; propertyName: string }) {
  const { detail, status, error, retry } = state;
  const shape = detail?.valueShape;
  const schema = shape && typeof shape === "object" && "schema" in shape ? shape.schema : undefined;
  const constraints = formatDtsValueSchema(schema) || formatParameterConstraints(detail?.constraints);
  return <section className="configuration-workbench__property-definition" aria-label="参数含义与约束">
    {status === "loading" ? <p role="status">正在加载参数定义…</p> : error ? <p role="alert">{error} <button type="button" className="button subtle" onClick={retry}>重试定义</button><span className="muted">业务约束尚未校验，输入已保留。</span></p>
      : detail ? <>
        {detail.displayName !== propertyName ? <strong>{detail.displayName}</strong> : null}
        {detail.documentation ? <details><summary>参数说明</summary><p>{detail.documentation}</p></details> : <p className="muted">尚无参数说明。</p>}
        <dl><div><dt>单位</dt><dd>{detail.unit || "未提供"}</dd></div><div><dt>取值约束</dt><dd>{constraints || "未提供业务约束；仍需符合下方类型语法。"}</dd></div></dl>
      </> : <><p className="muted">当前属性没有唯一关联的参数定义，单位与业务约束尚不可用。</p>
        {status === "missing" || status === "ambiguous" ? <p role="note">{status === "ambiguous" ? "保存目标存在歧义" : "尚无可确认的保存目标"}，当前输入可保留在本地，暂不能保存为待审核草稿。</p> : null}</>}
  </section>;
}

export function WorkbenchPropertyDefinition(props: DefinitionInput) {
  const state = useWorkbenchPropertyDefinition(props);
  return <WorkbenchPropertyDefinitionContent state={state} propertyName={props.propertyName ?? ""} />;
}
