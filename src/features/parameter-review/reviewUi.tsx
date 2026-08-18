import { Badge as UiBadge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { type ProjectParameterInitializationReview } from "@/domain/parameters/types";
import { type PrototypeState } from "@/domain/prototype/types";
import { type ReactNode } from "react";

export function getParameterInitializationReviewStatusLabel(status: ProjectParameterInitializationReview["status"]) {
  return (
    {
      pending: "待审阅",
      approved: "已通过",
      rejected: "已驳回"
    }[status] ?? (typeof status === "string" && status.trim() ? status : "未知")
  );
}

export type VerticalTimelineItem = {
  body: ReactNode;
  isCurrent?: boolean;
  marker?: string;
  time: string;
  title: string;
  /** Optional precise timestamp (or other detail) surfaced as a hover tooltip on the title. */
  titleHint?: string;
};

export function getUserName(users: PrototypeState["users"], userId?: string) {
  if (!userId) {
    return "未指派";
  }
  return users.find((user) => user.id === userId)?.name ?? userId;
}

const WORKFLOW_DISPLAY_LABELS: Record<string, string> = {
  硬件Committer检视: "硬件MDE检视",
  软件Committer检视: "软件MDE检视",
  软件User合入: "软件开发人员合入"
};

export function formatWorkflowDisplayText(text: string) {
  const raw = String(text ?? "");
  if (WORKFLOW_DISPLAY_LABELS[raw]) {
    return WORKFLOW_DISPLAY_LABELS[raw];
  }
  return raw
    .replaceAll("硬件Committer", "硬件MDE")
    .replaceAll("软件Committer", "软件MDE")
    .replaceAll("软件User", "软件开发人员")
    .replaceAll("Committer", "MDE")
    .replaceAll("User", "开发人员");
}

// MetricCard stays local: admin/MetricBentoCard is a large dashboard
// visualization card (spark/radial/pulse/peak, 160px chart area) and is not a
// drop-in replacement for this compact stat card.
export function MetricCard({ title, value, trend, tone }: { title: string; value: string; trend: string; tone: "blue" | "teal" | "purple" }) {
  return (
    <Card className={`metric-card ${tone}`} size="sm">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{trend}</p>
        <div className="metric-bar">
          <i />
        </div>
      </CardContent>
    </Card>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <UiBadge className="status-badge" variant="secondary">
      <span />
      {formatWorkflowDisplayText(status || "未知")}
    </UiBadge>
  );
}

export function VerticalTimeline({ items }: { items: VerticalTimelineItem[] }) {
  return (
    <div className="vertical-timeline">
      {items.map(({ body, isCurrent, marker, time, title, titleHint }) => (
        <div className={`vertical-timeline-item${isCurrent ? " vertical-timeline-item--current" : ""}`} key={`${time}-${title}`}>
          <span className="timeline-dot" />
          <div className="vertical-timeline-meta">
            <small>{time}</small>
            {marker ? <span className="vertical-timeline-current-badge">{marker}</span> : null}
          </div>
          <strong title={titleHint}>{formatWorkflowDisplayText(title)}</strong>
          <p>{typeof body === "string" ? formatWorkflowDisplayText(body) : body}</p>
        </div>
      ))}
    </div>
  );
}
