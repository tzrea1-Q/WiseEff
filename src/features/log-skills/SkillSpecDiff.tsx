import { diffSkillSpecs, specJson } from "./diffSkillSpecs";
import type { SkillSpec } from "./types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const labels: Record<string, string> = { description: "描述", procedure: "诊断流程", modelOverride: "模型覆盖", mode: "规则来源",
  noHit: "未命中规则时", hitDefaults: "命中默认值", anyOf: "触发条件", stageId: "阶段", inference: "推断",
  suggestedAction: "建议操作", analysis: "分析", id: "规则标识", rulesOrder: "规则顺序", defaultSourceSnapshotId: "默认源码快照" };
const display = (value: unknown) => value === undefined ? "未配置" : value === "default" ? "平台默认充电规则"
  : value === "custom" ? "自定义规则" : typeof value === "string" ? value : specJson(value);

export function SkillSpecDiff({ before, after }: { before: SkillSpec; after: SkillSpec }) {
  const diff = diffSkillSpecs(before, after);
  const ruleChanges = [diff.counts.added ? `新增 ${diff.counts.added}` : null,
    diff.counts.changed ? `修改 ${diff.counts.changed}` : null,
    diff.counts.removed ? `移除 ${diff.counts.removed}` : null].filter(Boolean).join(" / ");
  const summary = [diff.counts.overview ? `概览 ${diff.counts.overview} 项` : null,
    diff.counts.procedure ? `诊断流程 ${diff.counts.procedure} 项` : null,
    diff.counts.format ? `基础格式 ${diff.counts.format} 行` : null,
    diff.parsing.length ? `解析规则 ${diff.parsing.length} 项` : null,
    diff.counts.source ? `源码 ${diff.counts.source} 项` : null,
    ruleChanges ? `信号规则：${ruleChanges}` : null,
    diff.counts.signalSettings ? `规则设置 ${diff.counts.signalSettings} 项` : null].filter(Boolean).join(" · ");
  const fieldRows = (items: typeof diff.overview) => items.map((item) => <TableRow key={item.field}>
    <TableHead scope="row">{labels[item.field] ?? item.field}</TableHead><TableCell><pre>{display(item.before)}</pre></TableCell><TableCell><pre>{display(item.after)}</pre></TableCell>
  </TableRow>);
  return <div className="skill-diff" aria-label="变更摘要">
    <p>{summary || "两个版本内容相同"}</p>
    {diff.overview.length ? <section aria-label="概览差异"><h3>概览</h3><Table className="table-fixed"><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>变更前</TableHead><TableHead>变更后</TableHead></TableRow></TableHeader><TableBody>{fieldRows(diff.overview)}</TableBody></Table></section> : null}
    {diff.procedure.length ? <section aria-label="诊断流程差异"><h3>诊断流程</h3><Table className="table-fixed"><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>变更前</TableHead><TableHead>变更后</TableHead></TableRow></TableHeader><TableBody>{fieldRows(diff.procedure)}</TableBody></Table></section> : null}
    {diff.parsing.length ? <section aria-label="解析规则差异"><h3>解析规则</h3>{diff.parsing.map((extractor) => <section key={extractor.id}>
      <h4>{extractor.id} · {{ added: "新增", changed: "修改", removed: "移除" }[extractor.kind]}</h4>
      <Table className="table-fixed"><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>变更前</TableHead><TableHead>变更后</TableHead></TableRow></TableHeader><TableBody>{fieldRows(extractor.fields)}</TableBody></Table>
    </section>)}</section> : null}
    {diff.source.length ? <section aria-label="源码差异"><h3>源码</h3><Table className="table-fixed"><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>变更前</TableHead><TableHead>变更后</TableHead></TableRow></TableHeader><TableBody>{fieldRows(diff.source)}</TableBody></Table></section> : null}
    {diff.counts.format ? <section aria-label="基础格式差异"><h3>基础格式</h3><Table className="table-fixed"><TableHeader><TableRow><TableHead>变更前</TableHead><TableHead>变更后</TableHead></TableRow></TableHeader><TableBody>
      {diff.format.map((line, index) => <TableRow key={index} data-change={line.kind}><TableCell><pre>{line.kind === "add" ? "" : `${line.kind === "remove" ? "−" : " "} ${line.value}`}</pre></TableCell><TableCell><pre>{line.kind === "remove" ? "" : `${line.kind === "add" ? "+" : " "} ${line.value}`}</pre></TableCell></TableRow>)}
    </TableBody></Table></section> : null}
    {diff.rules.length || diff.signalSettings.length ? <section aria-label="信号规则差异"><h3>信号规则</h3>
      {diff.rules.map((rule) => <section key={rule.id}><h4>{rule.id} · {{ added: "新增", changed: "修改", removed: "移除" }[rule.kind]}</h4>
        <Table className="table-fixed"><TableHeader><TableRow><TableHead>字段</TableHead><TableHead>变更前</TableHead><TableHead>变更后</TableHead></TableRow></TableHeader><TableBody>{fieldRows(rule.fields)}</TableBody></Table></section>)}
      {diff.signalSettings.length ? <Table className="table-fixed"><TableHeader><TableRow><TableHead>设置</TableHead><TableHead>变更前</TableHead><TableHead>变更后</TableHead></TableRow></TableHeader><TableBody>{fieldRows(diff.signalSettings)}</TableBody></Table> : null}
    </section> : null}
  </div>;
}
