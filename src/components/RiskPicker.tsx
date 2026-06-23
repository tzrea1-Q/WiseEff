import type { KeyboardEvent } from "react";
import type { RiskLevel } from "../mockData";

const ORDER: RiskLevel[] = ["High", "Medium", "Low"];
const LABEL: Record<RiskLevel, string> = { High: "高", Medium: "中", Low: "低" };
const CLASS_NAME: Record<RiskLevel, string> = { High: "high", Medium: "medium", Low: "low" };

export function RiskPicker({ value, onChange }: { value: RiskLevel; onChange: (next: RiskLevel) => void }) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = ORDER.indexOf(value);
    if (index < 0) {
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(ORDER[(index + 1) % ORDER.length]);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(ORDER[(index - 1 + ORDER.length) % ORDER.length]);
    }
  };

  return (
    <div className="risk-picker" role="radiogroup" aria-label="风险" tabIndex={0} onKeyDown={handleKeyDown}>
      {ORDER.map((level) => (
        <button
          aria-checked={value === level}
          className={`risk-picker-option risk-${CLASS_NAME[level]}${value === level ? " active" : ""}`}
          key={level}
          role="radio"
          type="button"
          onClick={() => onChange(level)}
        >
          <span aria-hidden="true">●</span>
          {LABEL[level]}
        </button>
      ))}
    </div>
  );
}
