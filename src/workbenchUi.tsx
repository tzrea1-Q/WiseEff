import { Check, Info } from "lucide-react";
import type { ReactNode } from "react";

export const riskLabels: Record<"High" | "Medium" | "Low", string> = {
  High: "高",
  Medium: "中",
  Low: "低"
};

export function getContextQuery(search: string) {
  const params = new URLSearchParams(search);
  return {
    projectId: params.get("project") ?? "",
    module: params.get("module") ?? "",
    parameterId: params.get("parameter") ?? ""
  };
}

export function escapeExcelCell(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function WorkbenchLayout({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="workbench-page">
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="page-actions">{actions}</div> : null}
      </header>
      <div className="workbench-grid">{children}</div>
    </div>
  );
}

export function DataTable<T>({ headers, rows, renderRow }: { headers: string[]; rows: T[]; renderRow: (row: T) => ReactNode }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
      {rows.length === 0 ? <EmptyState text="当前筛选条件下没有数据。" /> : null}
    </div>
  );
}

export function RiskBadge({ risk }: { risk: "High" | "Medium" | "Low" }) {
  return <span className={`risk-badge ${risk.toLowerCase()}`}>{riskLabels[risk]}</span>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "tertiary" | "secondary" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function SectionLabel({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="section-label">
      {icon}
      <span>{label}</span>
    </div>
  );
}

export function Timeline({ steps, activeIndex }: { steps: string[]; activeIndex: number }) {
  return (
    <div className="timeline">
      {steps.map((step, index) => (
        <div className={index <= activeIndex ? "done" : ""} key={step}>
          <span>{index < activeIndex ? <Check size={14} /> : index + 1}</span>
          <small>{step}</small>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <div className="empty-state">
      <Info size={20} />
      {text}
    </div>
  );
}
