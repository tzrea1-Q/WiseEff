import { useState, type MouseEvent } from "react";
import type { ProjectLocalOverrideInput } from "@/application/ports/ParameterFileRepository";
import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import type { EffectiveTopologyEffect, EffectiveTopologyNode } from "@/domain/parameter-topology/types";
import { SectionEmpty } from "@/components/common/SectionState";
import { formatDtsValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";
import { isStructuralPropertyKey } from "@/domain/parameter-topology/parameterSurface";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SelectControl } from "@/components/common/SelectControl";
import { presentError } from "@/infrastructure/http/presentError";

const finalValue = (effect: EffectiveTopologyEffect) => formatDtsValueForUi(effect.valueText ?? effect.rawText, effect.value,
  effect.effectKind === "delete" ? "deleted" : "present");

export function effectivePropertyChains(node: EffectiveTopologyNode) {
  const chains = new Map<string, EffectiveTopologyEffect[]>();
  for (const effect of [...node.effects].sort((a, b) => a.sourceOrder - b.sourceOrder)) {
    if (!effect.propertyName) continue;
    const chain = chains.get(effect.propertyName) ?? [];
    chain.push(effect);
    chains.set(effect.propertyName, chain);
  }
  return chains;
}

/** Complete logical instances, independently of organization business navigation. */
export function effectiveStructureNodes(nodes: EffectiveTopologyNode[]): DtsStructuralNode[] {
  return nodes.map(node => ({ nodePath: node.locator, name: node.name, unitAddress: node.unitAddress,
    labels: [], compatible: node.compatible, status: node.enablement?.rawToken ?? undefined, phandleRefs: [],
    properties: [...effectivePropertyChains(node)].flatMap(([name, chain]) => {
      const final = chain.at(-1)!;
      return final.effectKind === "delete" ? [] : [{ name, valueType: "mixed" as const,
        rawText: finalValue(final), normalizedValue: final.valueText ?? final.rawText ?? "" }];
    }) }));
}

type Props = {
  node: EffectiveTopologyNode | null;
  projectId: string;
  configSetId: string;
  revisionId: string;
  search: string;
  blockingAncestorPath?: string;
  onNavigate?: (path: string) => void;
  overrideTargets?: Array<{ fileId: string; fileName: string }>;
  onPrepareOverride?: (input: ProjectLocalOverrideInput) => Promise<void>;
};

export function WorkbenchEffectiveConfiguration({ node, projectId, configSetId, revisionId, search, blockingAncestorPath, onNavigate, overrideTargets = [], onPrepareOverride }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [rawText, setRawText] = useState("");
  const [targetFileId, setTargetFileId] = useState("");
  const [nodeAction, setNodeAction] = useState<ProjectLocalOverrideInput["action"] | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ name: string; message: string } | null>(null);
  if (!node) return <SectionEmpty message="选择设备树节点以查看最终值和来源。" />;
  const prepare = async (name: string, final: EffectiveTopologyEffect | undefined, action: ProjectLocalOverrideInput["action"]) => {
    if (!onPrepareOverride || busy) return;
    setBusy(true); setError(null);
    try { await onPrepareOverride({ expectedConfigRevisionId: revisionId, logicalNodeId: node.logicalNodeId, propertyName: name,
      ...(final?.propertyOccurrenceId ? { propertyOccurrenceId: final.propertyOccurrenceId } : {}), action,
      ...(action === "set" ? { rawText, ...(targetFileId ? { targetFileId } : {}) } : {}) }); }
    catch (cause) { setError({ name, message: presentError(cause, "项目源码草稿准备失败，请重试。") }); }
    finally { setBusy(false); }
  };
  const sourcePath = (effect: EffectiveTopologyEffect) => {
    const params = new URLSearchParams(search);
    params.set("configSet", configSetId); params.set("revision", revisionId); params.set("tab", "source");
    params.set("file", effect.source!.fileId); params.set("version", effect.source!.fileVersionId);
    params.set("sourceMode", "history");
    if (effect.source!.startLine) params.set("line", String(effect.source!.startLine)); else params.delete("line");
    params.set("node", node.locator); params.set("property", effect.propertyName ?? "");
    params.delete("inspector"); params.delete("candidate"); params.delete("baseline");
    return `/parameter-admin/projects/${encodeURIComponent(projectId)}/configuration?${params}`;
  };
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(event.currentTarget.getAttribute("href")!);
  };
  const sourceLink = (effect: EffectiveTopologyEffect) => effect.source
    ? <><a href={sourcePath(effect)} onClick={follow}>{effect.source.sourceName}{effect.source.startLine ? `:${effect.source.startLine}` : ""}</a>
      {!effect.source.startLine ? <span>原始行号未记录</span> : null}</>
    : <span>原始位置未记录</span>;
  const sharedLink = (effect: EffectiveTopologyEffect) => {
    const shared = effect.source?.sharedReference;
    if (!shared) return null;
    const params = new URLSearchParams(search);
    params.set("resource", shared.resourceId); params.set("version", shared.versionId);
    params.set("member", shared.memberId);
    if (effect.source!.startLine) params.set("line", String(effect.source!.startLine)); else params.delete("line");
    params.set("tab", "source");
    params.set("projectContext", sourcePath(effect));
    return <a href={`/parameter-admin/sources?${params}`} onClick={follow}>共享资源 v{shared.version}</a>;
  };
  const chains = effectivePropertyChains(node);
  const status = chains.get("status")?.at(-1);
  return <main className="configuration-workbench__effective" aria-label="生效配置">
    <header><h2><code>{node.locator}</code></h2>
      {node.compatible ? <p><code>{node.compatible}</code></p> : null}
      <p>{node.enablement?.selfEnabled === false ? `节点未启用${node.enablement.rawToken ? `（${node.enablement.rawToken}）` : ""}` : "节点已启用"}
        {node.enablement?.blockingAncestorLabel ? ` · 祖先 ${blockingAncestorPath ?? node.enablement.blockingAncestorLabel} 阻断`
          : node.enablement?.reachable === false ? " · 不可达" : " · 可达"}</p>
      <small>查看源码可追溯到此配置修订的固定文件版本</small>
      {onPrepareOverride ? <form className="configuration-workbench__override-actions" aria-label="本项目节点操作" onSubmit={event => {
        event.preventDefault(); if (nodeAction) void prepare("status", undefined, nodeAction);
      }}>
        <SelectControl ariaLabel="节点操作" value={nodeAction} onValueChange={setNodeAction} disabled={busy}
          options={[{ value: "", label: "选择节点操作" }, { value: "enable-node", label: "在本项目启用" }, { value: "disable-node", label: "在本项目禁用" },
            ...(status && status.effectKind !== "delete" && status.source && !status.source.sharedReference
              ? [{ value: "remove-status-override" as const, label: "撤销本项目状态覆盖" }] : []),
            ...(node.locator !== "/" ? [{ value: "delete-node" as const, label: "显式删除此节点及子节点" }] : [])]} />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !nodeAction}>查看节点差异</Button>
        {error?.name === "status" ? <p role="alert">{error.message}</p> : null}
      </form> : null}
    </header>
    {node.effects.filter(effect => effect.directive?.kind === "delete-node").map(effect => <p key={effect.id}>
      {effect.directive!.redeclared ? "节点曾显式删除，后续已重新声明" : "已显式删除节点"} <code>{effect.directive!.targetNodeLocator}</code> · {sourceLink(effect)}
    </p>)}
    {chains.size === 0 ? <SectionEmpty message="此节点没有参数属性。" /> : <dl className="configuration-workbench__effective-properties">
      {[...chains].filter(([name]) => !editing || name === editing).map(([name, chain]) => {
        const final = chain.at(-1)!;
        return <div key={name} data-effective-property={name}>
          <dt><code>{name}</code></dt>
          <dd><pre className="parameter-value-content" aria-label={`${name} 最终值`}>{finalValue(final)}</pre>
            {final.effectKind === "delete" ? <p>显式删除属性 · 继承值不生效</p> : null}
            <div className="configuration-workbench__effective-origin">{sourceLink(final)}{sharedLink(final)}</div>
            {chain.length > 1 ? <details><summary>继承与覆盖（{chain.length}）</summary>
              <ol aria-label={`${name} 来源链`}>{chain.map((effect, index) => <li key={effect.id}>
                <span>{effect.effectKind === "delete" ? "显式删除" : index === 0 ? "继承" : "覆盖"}{index === chain.length - 1 ? " · 最终" : ""}</span>
                <pre className="parameter-value-content">{effect.rawText ?? (effect.effectKind === "delete" ? "删除指令原文未记录" : "原始值未记录")}</pre>
                <div className="configuration-workbench__effective-origin">{sourceLink(effect)}{sharedLink(effect)}</div>
              </li>)}</ol>
            </details> : null}
            {onPrepareOverride && final.effectKind !== "delete" && !isStructuralPropertyKey(name) ? <div className="configuration-workbench__override-actions">
              {editing !== name ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => {
                setEditing(name); setRawText(final.valueText ?? final.rawText ?? ""); setError(null);
                setTargetFileId(overrideTargets.find(target => target.fileId === final.source?.fileId)?.fileId ?? "");
              }}>在本项目覆盖</Button> : null}
              {editing !== name && final.source && !final.source.sharedReference ? <Button type="button" variant="outline" size="sm" disabled={busy}
                onClick={() => void prepare(name, final, "remove-override")}>撤销本项目覆盖</Button> : null}
              {editing !== name ? <Button type="button" variant="outline" size="sm" disabled={busy}
                onClick={() => void prepare(name, final, "delete-property")}>删除此属性</Button> : null}
              {editing === name ? <form aria-label={`${name} 本项目覆盖`} onSubmit={event => { event.preventDefault(); void prepare(name, final, "set"); }}>
                <label htmlFor={`override-value-${name}`}>本项目值（DTS）</label>
                <Textarea id={`override-value-${name}`} aria-label={`${name} 本项目值`} value={rawText} disabled={busy} onChange={event => setRawText(event.target.value)} />
                {overrideTargets.length > 1 ? <label>项目源码成员<SelectControl ariaLabel={`${name} 项目源码成员`} value={targetFileId} disabled={busy}
                  onValueChange={setTargetFileId} options={[{ value: "", label: "按覆盖顺序选择项目成员" }, ...overrideTargets.map(target => ({ value: target.fileId, label: target.fileName }))]} /></label> : null}
                <p>在项目源码中查看差异，再按当前权限提交审阅或确认应用。</p>
                <Button type="submit" size="sm" disabled={busy || (!rawText.trim() && final.value?.kind !== "boolean")}>查看源码差异</Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setEditing(null); setError(null); }}>取消</Button>
              </form> : null}
              {error?.name === name ? <p role="alert">{error.message}</p> : null}
            </div> : null}
          </dd>
        </div>;
      })}
    </dl>}
  </main>;
}
