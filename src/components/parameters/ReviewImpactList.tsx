import type { ImpactItem } from "@/domain/parameters/types";

const KIND_LABELS: Record<ImpactItem["kind"], string> = {
  parameter: "parameter",
  module: "module",
  test: "test",
  phandle: "phandle",
  compatible: "compatible",
  "config-set": "config-set"
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
              {item.risk}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
