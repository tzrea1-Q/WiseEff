import type {
  DtsCompareBaselineResult,
  DtsStructuralChange
} from "@/application/ports/DtsStructuredRepository";
import {
  sourceNodePathForChange,
  type StructuredChangeSet
} from "@/application/parameters/structuredChangeSet";

export type StructuredDiffViewProps = {
  result: DtsCompareBaselineResult;
  changeSet?: StructuredChangeSet;
};

const KIND_LABEL: Record<DtsStructuralChange["kind"], string> = {
  node_added: "节点新增",
  node_removed: "节点删除",
  prop_added: "属性新增",
  prop_removed: "属性删除",
  prop_changed: "属性变更"
};

function changeKey(fileId: string, change: DtsStructuralChange, index: number): string {
  return `${fileId}:${change.kind}:${sourceNodePathForChange(change)}:${index}`;
}

function StructuralChangeRow({ change }: { change: DtsStructuralChange }) {
  const label = KIND_LABEL[change.kind];
  const path = sourceNodePathForChange(change);

  if (change.kind === "node_added" || change.kind === "node_removed") {
    return (
      <li className="structured-diff-view__change" data-kind={change.kind}>
        <span className="structured-diff-view__kind">{label}</span>
        <code className="structured-diff-view__path">{path}</code>
      </li>
    );
  }

  return (
    <li className="structured-diff-view__change" data-kind={change.kind}>
      <span className="structured-diff-view__kind">{label}</span>
      <code className="structured-diff-view__path">{path}</code>
      {change.kind === "prop_changed" || change.kind === "prop_removed" ? (
        <code className="structured-diff-view__before">{change.before ?? ""}</code>
      ) : null}
      {change.kind === "prop_changed" ? <span aria-hidden="true">→</span> : null}
      {change.kind === "prop_changed" || change.kind === "prop_added" ? (
        <code className="structured-diff-view__after">{change.after ?? ""}</code>
      ) : null}
    </li>
  );
}

export function StructuredDiffView({ result, changeSet }: StructuredDiffViewProps) {
  const membersWithDiff = result.members.filter(
    (member) => (member.structuralDiff?.length ?? 0) > 0
  );
  const hasChanges = membersWithDiff.length > 0;

  return (
    <section className="structured-diff-view" aria-label="结构化差异">
      {!hasChanges ? (
        <p className="structured-diff-view__empty" role="status">
          无结构化差异（无节点/属性级变更）
        </p>
      ) : (
        <ul className="structured-diff-view__members" aria-label="差异成员">
          {membersWithDiff.map((member) => (
            <li key={member.fileId} className="structured-diff-view__member">
              <h4 className="structured-diff-view__file">{member.fileName ?? member.fileId}</h4>
              <ul className="structured-diff-view__changes" aria-label={`${member.fileName ?? member.fileId} 变更`}>
                {(member.structuralDiff ?? []).map((change, index) => (
                  <StructuralChangeRow
                    key={changeKey(member.fileId, change, index)}
                    change={change}
                  />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {changeSet ? (
        <section className="structured-diff-view__changeset" aria-label="变更集">
          <h4>变更集</h4>
          <p>
            已映射 {changeSet.items.length} 项 · 未映射 {changeSet.unmapped.length} 项
          </p>
          {changeSet.items.length > 0 ? (
            <ul aria-label="已映射变更">
              {changeSet.items.map((item) => (
                <li key={item.parameterId}>
                  <code>{item.parameterId}</code>
                  <span> → </span>
                  <code>{item.targetValue || "(删除)"}</code>
                </li>
              ))}
            </ul>
          ) : null}
          {changeSet.unmapped.length > 0 ? (
            <ul aria-label="未映射变更">
              {changeSet.unmapped.map((entry, index) => (
                <li key={`${entry.fileId}-${index}`}>
                  <span>未映射</span>{" "}
                  <code>
                    {entry.fileName ?? entry.fileId}:{sourceNodePathForChange(entry.change)}
                  </code>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
