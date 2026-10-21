import type { KnowledgeExtractionStatus, KnowledgeOrigin, KnowledgeStatus } from "@/domain/knowledge/types";
import { knowledgeExtractionStatusLabels, knowledgeOriginLabels, knowledgeStatusLabels } from "@/domain/knowledge/types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function KnowledgeUnsearchableBadge() {
  return <Badge className="bg-[var(--warning-soft)] text-[var(--warning)]">不可检索</Badge>;
}

const statusBadgeClasses: Record<KnowledgeStatus, string> = {
  draft: "bg-amber-100 text-amber-950",
  published: "bg-emerald-100 text-emerald-900",
  archived: "bg-slate-200 text-slate-700"
};

export function KnowledgeOriginBadge({ origin }: { origin: KnowledgeOrigin }) {
  return <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground" data-origin={origin}>{knowledgeOriginLabels[origin]}</span>;
}

export function KnowledgeStatusBadge({ status }: { status: KnowledgeStatus }) {
  return (
    <span
      className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium", statusBadgeClasses[status])}
      data-status={status}
      data-row-status
    >
      {knowledgeStatusLabels[status]}
    </span>
  );
}

const extractionBadgeClasses: Record<KnowledgeExtractionStatus, string> = {
  pending: "bg-blue-100 text-blue-900",
  succeeded: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-900"
};

export function KnowledgeExtractionBadge({
  status,
  error
}: {
  status: KnowledgeExtractionStatus;
  error?: string | null;
}) {
  return (
    <span
      className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium", extractionBadgeClasses[status])}
      data-extraction-status={status}
      title={status === "failed" && error ? error : undefined}
    >
      {knowledgeExtractionStatusLabels[status]}
    </span>
  );
}

export function KnowledgeTagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-[11px] text-muted-foreground">
          {tag}
        </span>
      ))}
    </span>
  );
}
