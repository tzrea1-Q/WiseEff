import type { ProductFeedback, ProductFeedbackResolutionCode, ProductFeedbackStatus } from "@/domain/productFeedback/types";
import {
  productFeedbackResolutionLabels,
  productFeedbackStatusLabels
} from "@/domain/productFeedback/types";
import { cn } from "@/lib/utils";

export type FeedbackDisplayStatus = "draft" | ProductFeedbackStatus;

const statusBadgeClasses: Record<FeedbackDisplayStatus, string> = {
  draft: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  open: "bg-amber-100 text-amber-950 dark:bg-amber-950/60 dark:text-amber-200",
  in_progress: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200",
  resolved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200",
  closed: "bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-300"
};

export function getFeedbackDisplayStatus(feedback: Pick<ProductFeedback, "status" | "submittedAt">): FeedbackDisplayStatus {
  if (feedback.submittedAt === null || feedback.submittedAt === undefined) {
    return "draft";
  }
  return feedback.status;
}

export function FeedbackStatusBadge({
  status,
  resolutionCode,
  className
}: {
  status: FeedbackDisplayStatus;
  resolutionCode?: ProductFeedbackResolutionCode | null;
  className?: string;
}) {
  const label = status === "draft" ? "草稿" : productFeedbackStatusLabels[status];
  const resolutionText =
    (status === "resolved" || status === "closed") && resolutionCode
      ? ` · ${productFeedbackResolutionLabels[resolutionCode]}`
      : "";

  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium tracking-tight",
        statusBadgeClasses[status],
        className
      )}
    >
      {label}
      {resolutionText}
    </span>
  );
}
