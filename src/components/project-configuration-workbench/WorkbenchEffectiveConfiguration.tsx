import type { MouseEvent } from "react";
import type { DtsStructuralNode } from "@/application/ports/DtsStructuredRepository";
import type { EffectiveTopologyEffect, EffectiveTopologyNode } from "@/domain/parameter-topology/types";
import { SectionEmpty } from "@/components/common/SectionState";
import { formatDtsValueForUi } from "@/domain/parameter-topology/formatDtsRawValueForUi";

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
};

export function WorkbenchEffectiveConfiguration({ node, projectId, configSetId, revisionId, search, blockingAncestorPath, onNavigate }: Props) {
  if (!node) return <SectionEmpty message="选择设备树节点以查看最终值和来源。" />;
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
  return <main className="configuration-workbench__effective" aria-label="生效配置 · 只读">
    <header><h2><code>{node.locator}</code></h2>
      {node.compatible ? <p><code>{node.compatible}</code></p> : null}
      <p>{node.enablement?.selfEnabled === false ? `节点未启用${node.enablement.rawToken ? `（${node.enablement.rawToken}）` : ""}` : "节点已启用"}
        {node.enablement?.blockingAncestorLabel ? ` · 祖先 ${blockingAncestorPath ?? node.enablement.blockingAncestorLabel} 阻断`
          : node.enablement?.reachable === false ? " · 不可达" : " · 可达"}</p>
      <small>生效配置只读 · 查看源码可追溯到此配置修订的固定文件版本</small>
    </header>
    {chains.size === 0 ? <SectionEmpty message="此节点没有参数属性。" /> : <dl className="configuration-workbench__effective-properties">
      {[...chains].map(([name, chain]) => {
        const final = chain.at(-1)!;
        return <div key={name} data-effective-property={name}>
          <dt><code>{name}</code></dt>
          <dd><pre className="parameter-value-content" aria-label={`${name} 最终值`}>{finalValue(final)}</pre>
            <div className="configuration-workbench__effective-origin">{sourceLink(final)}{sharedLink(final)}</div>
            {chain.length > 1 ? <details><summary>继承与覆盖（{chain.length}）</summary>
              <ol aria-label={`${name} 来源链`}>{chain.map((effect, index) => <li key={effect.id}>
                <span>{effect.effectKind === "delete" ? "移除" : index === 0 ? "继承" : "覆盖"}{index === chain.length - 1 ? " · 最终" : ""}</span>
                <pre className="parameter-value-content">{effect.effectKind === "delete" ? "已移除" : effect.rawText ?? "原始值未记录"}</pre>
                <div className="configuration-workbench__effective-origin">{sourceLink(effect)}{sharedLink(effect)}</div>
              </li>)}</ol>
            </details> : null}
          </dd>
        </div>;
      })}
    </dl>}
  </main>;
}
