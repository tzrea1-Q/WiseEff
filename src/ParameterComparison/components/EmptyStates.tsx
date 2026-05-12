import { CheckCircle2, SearchX } from "lucide-react";

export type ComparisonEmptyStateProps = {
  kind: "all-synced" | "filtered";
  onReset?: () => void;
};

const copy = {
  "all-synced": {
    title: "项目参数已同步",
    body: "当前项目组合没有发现差异参数。"
  },
  filtered: {
    title: "没有匹配参数",
    body: "调整搜索词或筛选条件后再试。"
  }
} satisfies Record<ComparisonEmptyStateProps["kind"], { title: string; body: string }>;

export function ComparisonEmptyState({ kind, onReset }: ComparisonEmptyStateProps) {
  const Icon = kind === "all-synced" ? CheckCircle2 : SearchX;
  const stateCopy = copy[kind];

  return (
    <div className="comparison-empty">
      <Icon size={24} aria-hidden="true" />
      <h3>{stateCopy.title}</h3>
      <p>{stateCopy.body}</p>
      {kind === "filtered" && onReset ? (
        <button className="comparison-empty__cta" type="button" onClick={onReset}>
          清除筛选
        </button>
      ) : null}
    </div>
  );
}
