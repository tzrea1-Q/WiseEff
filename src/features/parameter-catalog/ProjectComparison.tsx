import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { SelectControl } from "@/components/common/SelectControl";
import { SectionEmpty, SectionError, SectionSkeleton } from "@/components/common/SectionState";
import type { ParameterCatalogRepository } from "@/application/ports/ParameterCatalogRepository";
import type { CatalogProjectConfigurationsResponse } from "@/infrastructure/http/parameterCatalogDtos";
import { WiseEffApiError } from "@/infrastructure/http/apiClient";
import { diffLines } from "@/application/project-configuration/sourceTextMerge";
import { formatAbsolute } from "@/domain/format/formatDateTime";

type Instance = NonNullable<CatalogProjectConfigurationsResponse["baseline"]>;
type SideLine = { text: string; number: number; changed: boolean };
type PairLine = { left?: SideLine; right?: SideLine };

/** Align insertions and removals with the workbench's bounded Myers diff. */
export function comparisonLines(left: string, right: string) {
  const split = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const difference = diffLines(split(left), split(right));
  const rows: PairLine[] = [];
  let leftNumber = 0;
  let rightNumber = 0;
  let removed: SideLine[] = [];
  let added: SideLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) rows.push({ left: removed[i], right: added[i] });
    removed = []; added = [];
  };
  for (const line of difference.lines) {
    if (line.marker === "-") removed.push({ text: line.text, number: ++leftNumber, changed: true });
    else if (line.marker === "+") added.push({ text: line.text, number: ++rightNumber, changed: true });
    else {
      flush();
      rows.push({ left: { text: line.text, number: ++leftNumber, changed: false }, right: { text: line.text, number: ++rightNumber, changed: false } });
    }
  }
  flush();
  return { rows, bounded: difference.bounded };
}

const comparisonStatus = (status: NonNullable<Instance["comparison"]>["status"]) => ({
  same: "类型化值相同", different: "类型化值不同", "different-semantics": "定义语义不同，不计算差值",
  unsupported: "复杂表达式或引用，仅供原文查看", unavailable: "缺少比较所需证据"
})[status];

export function ProjectComparison({ repository, organizationId, definitionId, baselineId, targetId, onChange, onOpenProject }: {
  repository: ParameterCatalogRepository; organizationId?: string; definitionId: string;
  baselineId?: string | null; targetId?: string | null;
  onChange: (update: { baseline: string | null; target: string | null }, mode?: "push" | "replace") => void;
  onOpenProject?: (row: Instance) => void;
}) {
  const context = JSON.stringify([organizationId, definitionId]);
  const [retry, setRetry] = useState(0);
  const [inventory, setInventory] = useState<{ context: string; repository: ParameterCatalogRepository; items: Instance[] } | null>(null);
  const [inventoryError, setInventoryError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState<{ context: string; repository: ParameterCatalogRepository; result?: CatalogProjectConfigurationsResponse; error?: unknown } | null>(null);
  const [copyStatus, setCopyStatus] = useState<{ context: string; message: string; error: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    setInventory(null); setInventoryError(null);
    void (async () => {
      if (!repository.getProjectConfigurations) throw new Error("Configuration read unavailable");
      const items = new Map<string, Instance>();
      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: CatalogProjectConfigurationsResponse = await repository.getProjectConfigurations(definitionId, cursor ? { cursor } : {});
        if (!active) return;
        for (const item of page.items) if (item.kind === "instance" && item.valueState === "present") items.set(item.bindingId, item);
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error("Repeated configuration cursor");
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (active) setInventory({ context, repository, items: [...items.values()] });
    })().catch((error: unknown) => { if (active) setInventoryError(error); });
    return () => { active = false; };
  }, [repository, definitionId, organizationId, context, retry]);

  const items = inventory?.context === context && inventory.repository === repository ? inventory.items : undefined;
  const leftId = baselineId ?? items?.[0]?.bindingId ?? null;
  const leftProject = items?.find(item => item.bindingId === leftId)?.projectId;
  const rightId = targetId ?? items?.find(item => item.projectId !== leftProject)?.bindingId ?? null;
  useEffect(() => {
    if (items?.length && (leftId !== (baselineId ?? null) || rightId !== (targetId ?? null))) onChange({ baseline: leftId, target: rightId }, "replace");
  }, [items, leftId, rightId, baselineId, targetId, onChange]);

  const pairContext = JSON.stringify([context, leftId, rightId]);
  useEffect(() => {
    let active = true;
    setLoaded(null);
    if (!items || !leftId || !repository.getProjectConfigurations) return;
    repository.getProjectConfigurations(definitionId, { baselineBindingId: leftId, ...(rightId ? { targetBindingId: rightId } : {}) })
      .then(result => { if (active) setLoaded({ context: pairContext, repository, result }); })
      .catch((error: unknown) => { if (active) setLoaded({ context: pairContext, repository, error }); });
    return () => { active = false; };
  }, [repository, definitionId, items, leftId, rightId, pairContext, retry]);

  const current = loaded?.context === pairContext && loaded.repository === repository ? loaded : null;
  const result = current?.result;
  const left = result?.baseline;
  const right = result?.target;
  const complete = left?.rawValue !== undefined && right?.rawValue !== undefined;
  const difference = useMemo(() => {
    // ponytail: above 2,000 lines or 200 KB, use two full-text panes instead of
    // thousands of aligned DOM rows; a virtualized diff can extend this ceiling.
    const large = [left?.rawValue ?? "", right?.rawValue ?? ""].some(value => value.length > 200_000 || value.split("\n").length > 2_000);
    return { large, ...(large ? { rows: [] as PairLine[], bounded: false } : comparisonLines(left?.rawValue ?? "", right?.rawValue ?? "")) };
  }, [left?.rawValue, right?.rawValue]);
  const failure = inventoryError || current?.error;
  const reason = failure instanceof WiseEffApiError ? failure.details.reason : undefined;
  const unavailable = reason === "baseline-unavailable" || reason === "target-unavailable";
  const choices = [...new Map([...(items ?? []), ...[left, right].filter(item => item != null)].map(item => [item.bindingId, item])).values()];
  const projects = [...new Map([...choices, ...[left, right].filter(item => item != null)].map(item => [item.projectId, { value: item.projectId, label: item.projectName }])).values()];
  const copy = async (item: Instance, label: string) => {
    if (item.rawValue === undefined) return;
    try {
      await navigator.clipboard.writeText(item.rawValue);
      setCopyStatus({ context: pairContext, message: `已复制${label}完整原值。`, error: false });
    } catch { setCopyStatus({ context: pairContext, message: "复制失败，请检查剪贴板权限后重试；选择仍保留。", error: true }); }
  };

  return <section className="parameter-library-compare" aria-label="实例对比">
    {inventoryError ? <SectionError message={failure instanceof WiseEffApiError && failure.code === "FORBIDDEN" ? "没有权限读取当前项目配置。" : "项目配置列表读取失败，请重试。"} onRetry={() => setRetry(value => value + 1)} />
      : !items ? <SectionSkeleton label="正在读取可对比项目" /> : <>
      <div className="parameter-library-compare__selectors">
        {(["left", "right"] as const).map(side => {
          const isLeft = side === "left";
          const id = isLeft ? leftId : rightId;
          const detail = isLeft ? left : right;
          const item = detail ?? items.find(candidate => candidate.bindingId === id);
          const label = isLeft ? "基准实例" : "目标实例";
          const sideLabel = isLeft ? "左侧" : "右侧";
          const options = choices.filter(candidate => candidate.projectId === item?.projectId);
          const select = (bindingId: string) => onChange({ baseline: isLeft ? bindingId : leftId, target: isLeft ? rightId : bindingId });
          return <div className="parameter-library-compare__selection" key={side}>
            <div className="parameter-library-compare__side-heading"><h3>{label}</h3>
              {detail ? <div className="parameter-library-compare__actions"><button className="button subtle sm" type="button" disabled={detail.rawValue === undefined} onClick={() => void copy(detail, label)} aria-label={`复制${label}完整原值`}><Copy size={14} aria-hidden="true" />复制</button>
                {onOpenProject ? <button className="button subtle sm" type="button" onClick={() => onOpenProject(detail)} aria-label={`在项目中打开 ${label}`}><ExternalLink size={14} aria-hidden="true" />打开项目</button> : null}</div> : null}
            </div>
            <SelectControl ariaLabel={`${sideLabel}项目`} placeholder={projects.length ? "选择项目" : "暂无已配置项目"} disabled={!projects.length}
              value={item?.projectId ?? ""} options={projects} onValueChange={value => select(choices.find(candidate => candidate.projectId === value)!.bindingId)} />
            {options.length > 1 ? <SelectControl ariaLabel={`${sideLabel}配置实例`} value={id ?? ""} options={options.map(option => ({ value: option.bindingId,
              label: `${option.configSetName} · ${option.fileName} · ${option.sourceLocation}` }))} onValueChange={select} /> : null}
            {!item ? <p className="parameter-library-compare__selection-hint">{projects.length === 1 ? "只有一个已配置项目，可选择同一项目中的其他实例。" : "选择项目后显示配置原值。"}</p> : null}
          </div>;
        })}
      </div>
      {unavailable ? <div className="parameter-library-compare__message" role="alert"><p>{reason === "baseline-unavailable" ? "基准实例已不可用，请明确重新选择。" : "目标实例已不可用，请重新选择目标。"}</p>
        <button type="button" className="button subtle sm" onClick={() => { setInventory(null); onChange({ baseline: reason === "baseline-unavailable" ? null : leftId, target: null }); setRetry(value => value + 1); }}>重新选择</button></div>
        : current?.error ? <SectionError message={failure instanceof WiseEffApiError && failure.code === "FORBIDDEN" ? "没有权限读取当前项目配置。" : "对比读取失败，请重试。"} onRetry={() => setRetry(value => value + 1)} />
          : !items.length && !leftId ? <SectionEmpty message="当前没有可用于对比的项目配置。" />
            : !result ? <SectionSkeleton label="正在读取两侧完整原值" /> : <>
      <div className="parameter-library-compare__status" role="status">
        <strong>{complete ? left.rawValue === right.rawValue ? "原文相同" : "原文存在差异" : "请选择两侧项目进行对比"}</strong>
        {right?.comparison ? <span>{comparisonStatus(right.comparison.status)}{right.comparison.revisionChanged ? " · 固定修订不同" : ""}
          {right.comparison.delta !== undefined ? ` · 目标 − 基准：${right.comparison.delta} ${right.unit ?? ""}` : ""}</span> : null}
        {complete && !difference.large && left.rawValue !== right.rawValue ? <span className="parameter-library-compare__legend"><span>− {difference.rows.filter(row => row.left?.changed).length}</span><span>+ {difference.rows.filter(row => row.right?.changed).length}</span></span> : null}
      </div>
      {difference.bounded ? <p className="parameter-library-compare__message">差异较大，按整块替换显示；完整原值仍可复制。</p> : null}
      {difference.large ? <p className="parameter-library-compare__message">内容较长，以下并排显示完整原文，不逐行标色；可滚动阅读或复制完整原值。</p> : null}
      <div className="parameter-library-compare__code" role="region" aria-label="配置代码差异">
        {(["left", "right"] as const).map(side => {
          const detail = side === "left" ? left : right;
          const label = side === "left" ? "基准实例" : "目标实例";
          return <div key={side} className="parameter-library-compare__code-side" data-large={difference.large || undefined} role="textbox" aria-label={`${label}原值`} aria-readonly="true" aria-multiline="true" tabIndex={0}
            style={{ gridRow: `1 / span ${Math.max(1, difference.rows.length)}` }}>
            {detail?.rawValue === undefined || detail.rawValue === "" ? <div className="parameter-library-compare__code-empty">{!detail ? "选择项目以查看原值" : detail.rawValue === undefined ? "完整原值不可用" : detail.sourceFormat === "dts" && detail.valueKind === "boolean" ? "布尔属性存在，无值文本" : "空值"}</div>
              : difference.large ? <pre className="parameter-library-compare__full-source">{detail.rawValue}</pre> : difference.rows.map((row, index) => <div key={index} className="parameter-library-compare__line" data-kind={!row[side] ? "gap" : complete && row[side].changed ? side === "left" ? "remove" : "add" : "equal"}>
                <span className="parameter-library-compare__line-number" aria-hidden="true">{row[side]?.number ?? ""}</span>
                <span className="parameter-library-compare__marker" aria-hidden="true">{complete && row[side]?.changed ? side === "left" ? "−" : "+" : ""}</span>
                <code>{row[side]?.text ?? ""}</code>
              </div>)}
          </div>;
        })}
      </div>
      <p className="parameter-library-compare__footnote">读取于 {formatAbsolute(result.readAt)} · 对比当前平台配置原文，非设备运行状态。</p>
      {copyStatus?.context === pairContext ? <p role={copyStatus.error ? "alert" : "status"}>{copyStatus.message}</p> : null}
      </>}
    </>}
  </section>;
}
