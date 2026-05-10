import { ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { RiskLevel } from "../../mockData";

export type ParameterKeyTooltipProps = {
  parameterKey: string;
  module: string;
  description: string;
  risk: RiskLevel;
  children?: ReactNode;
  onOpenDetail?: (parameterKey: string) => void;
};

export function ParameterKeyTooltip({ parameterKey, module, description, risk, children, onOpenDetail }: ParameterKeyTooltipProps) {
  const [visible, setVisible] = useState(false);

  return (
    <span className="param-tooltip" onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
      <button
        className="comparison-row--v2__key-button"
        type="button"
        onClick={() => onOpenDetail?.(parameterKey)}
        onBlur={() => setVisible(false)}
        onFocus={() => setVisible(true)}
      >
        {children ?? parameterKey}
      </button>
      {visible ? (
        <span className="param-tooltip__popover" role="tooltip">
          <span className="param-tooltip__desc">{description}</span>
          <span className="param-tooltip__meta">
            <strong>模块</strong>
            {module}
            <span className="param-tooltip__sep">/</span>
            <strong>风险</strong>
            {risk}
          </span>
          {onOpenDetail ? (
            <button className="param-tooltip__link" type="button" onMouseDown={() => onOpenDetail(parameterKey)}>
              查看详情
              <ExternalLink size={12} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
