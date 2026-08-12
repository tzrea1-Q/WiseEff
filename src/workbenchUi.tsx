import { Check, Info } from "lucide-react";
import type { ReactNode } from "react";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

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
    parameterId: params.get("parameter") ?? "",
    logId: params.get("logId") ?? ""
  };
}

export function escapeExcelCell(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function WorkbenchLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="workbench-page" aria-label={title}>
      <div className="workbench-grid">{children}</div>
    </section>
  );
}

export function RiskBadge({ risk }: { risk: "High" | "Medium" | "Low" }) {
  return <span className={`risk-badge ${risk.toLowerCase()}`}>{riskLabels[risk]}</span>;
}

export function Badge({ children, variant = "neutral" }: { children: ReactNode; variant?: "neutral" | "tertiary" | "secondary" }) {
  return <span className={`badge ${variant}`}>{children}</span>;
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
    <Empty className="empty-state">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Info size={20} />
        </EmptyMedia>
        <EmptyTitle>暂无内容</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function PanelHeader({ title, meta }: { title: ReactNode; meta?: string }) {
  return (
    <div className="panel-header">
      <strong>{title}</strong>
      {meta ? <span>{meta}</span> : null}
    </div>
  );
}
