import type { ImpactItem } from "@/domain/parameters/types";

const KIND_LABELS: Record<ImpactItem["kind"], string> = {
  parameter: "参数",
  module: "模块",
  test: "测试",
  phandle: "phandle 引用",
  compatible: "compatible 关联",
  "config-set": "配置集"
};

const RISK_LABELS: Record<ImpactItem["risk"], string> = {
  High: "高风险",
  Medium: "中风险",
  Low: "低风险"
};

type ReviewImpactListProps = {
  items: ImpactItem[];
};

export function ReviewImpactList({ items }: ReviewImpactListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="review-impact-list" aria-label="影响面">
      <p className="review-impact-list__title">影响面</p>
      <ul className="review-impact-list__items">
        {items.map((item) => (
          <li key={`${item.kind}:${item.name}:${item.note}`} className="review-impact-list__item">
            <span className="review-impact-list__kind">{KIND_LABELS[item.kind]}</span>
            <div className="review-impact-list__body">
              <strong className="review-impact-list__name">{item.name}</strong>
              <span className="review-impact-list__note">{item.note}</span>
            </div>
            <span className="review-impact-list__risk" data-risk={item.risk}>
              {RISK_LABELS[item.risk]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
