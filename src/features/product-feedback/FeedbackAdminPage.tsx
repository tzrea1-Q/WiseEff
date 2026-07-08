import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProductFeedbackRepository } from "@/application/ports/ProductFeedbackRepository";
import type { ProductFeedback, ProductFeedbackStatus, ProductFeedbackType } from "@/domain/productFeedback/types";
import {
  productFeedbackStatuses,
  productFeedbackStatusLabels,
  productFeedbackTypeLabels,
  productFeedbackTypes
} from "@/domain/productFeedback/types";
import { DataTable, PageInsightBar, type Column } from "@/components/admin";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FeedbackAdminDrawer } from "./FeedbackAdminDrawer";

export type FeedbackAdminPageProps = {
  productFeedbackRepository: ProductFeedbackRepository;
};

const statusBadgeClasses: Record<ProductFeedbackStatus, string> = {
  open: "bg-amber-100 text-amber-950",
  in_progress: "bg-blue-100 text-blue-900",
  closed: "bg-emerald-100 text-emerald-900"
};

function StatusBadge({ status }: { status: ProductFeedbackStatus }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium", statusBadgeClasses[status])}>
      {productFeedbackStatusLabels[status]}
    </span>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function snippet(value: string) {
  return value.length > 42 ? `${value.slice(0, 42)}...` : value;
}

function submitterLabel(feedback: ProductFeedback) {
  return feedback.submitterUserId ?? "内测用户";
}

function includesQuery(feedback: ProductFeedback, query: string) {
  const haystack = [
    feedback.pageTitle,
    feedback.pagePath,
    feedback.description,
    submitterLabel(feedback),
    productFeedbackStatusLabels[feedback.status],
    productFeedbackTypeLabels[feedback.feedbackType]
  ]
    .join(" ")
    .toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

export function FeedbackAdminPage({ productFeedbackRepository }: FeedbackAdminPageProps) {
  const [rows, setRows] = useState<ProductFeedback[]>([]);
  const [statusFilter, setStatusFilter] = useState<ProductFeedbackStatus | "all">("all");
  const [typeFilter, setTypeFilter] = useState<ProductFeedbackType | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadFeedback = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const result = await productFeedbackRepository.list();
      setRows(result.items);
    } catch (error) {
      setErrorMessage(error instanceof Error && error.message ? error.message : "反馈列表加载失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFeedback();
  }, [productFeedbackRepository]);

  const filteredRows = useMemo(
    () =>
      rows.filter((feedback) => {
        if (statusFilter !== "all" && feedback.status !== statusFilter) return false;
        if (typeFilter !== "all" && feedback.feedbackType !== typeFilter) return false;
        if (query.trim() && !includesQuery(feedback, query.trim())) return false;
        return true;
      }),
    [query, rows, statusFilter, typeFilter]
  );
  const openCount = useMemo(() => rows.filter((feedback) => feedback.status === "open").length, [rows]);
  const selectedFeedback = selectedId ? rows.find((feedback) => feedback.id === selectedId) ?? null : null;
  const hasActiveFilters = statusFilter !== "all" || typeFilter !== "all" || query.trim() !== "";

  const columns: Column<ProductFeedback>[] = [
    {
      key: "status",
      header: "状态",
      render: (feedback) => <StatusBadge status={feedback.status} />,
      sortAccessor: (feedback) => feedback.status,
      widthClass: "w-24"
    },
    {
      key: "type",
      header: "类型",
      render: (feedback) => <span className="text-xs text-muted-foreground">{productFeedbackTypeLabels[feedback.feedbackType]}</span>,
      sortAccessor: (feedback) => feedback.feedbackType,
      widthClass: "w-32"
    },
    {
      key: "page",
      header: "页面",
      render: (feedback) => (
        <div className="min-w-0">
          <p className="font-medium text-foreground">{feedback.pageTitle}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">{feedback.pagePath}</p>
        </div>
      ),
      sortAccessor: (feedback) => feedback.pageTitle
    },
    {
      key: "description",
      header: "描述",
      render: (feedback) => <span className="text-muted-foreground">{snippet(feedback.description)}</span>,
      sortAccessor: (feedback) => feedback.description
    },
    {
      key: "submitter",
      header: "提交人",
      render: (feedback) => <span className="text-xs text-muted-foreground">{submitterLabel(feedback)}</span>,
      sortAccessor: submitterLabel,
      widthClass: "w-28"
    },
    {
      key: "attachments",
      header: "附件",
      render: (feedback) => <span className="font-mono text-xs">{feedback.attachments.length}</span>,
      sortAccessor: (feedback) => feedback.attachments.length,
      align: "right",
      widthClass: "w-20"
    },
    {
      key: "createdAt",
      header: "创建时间",
      render: (feedback) => <span className="text-xs text-muted-foreground">{formatDateTime(feedback.createdAt)}</span>,
      sortAccessor: (feedback) => feedback.createdAt,
      widthClass: "w-28"
    }
  ];

  const resetFilters = () => {
    setStatusFilter("all");
    setTypeFilter("all");
    setQuery("");
  };

  const updateFeedback = async (id: string, patch: { status?: ProductFeedbackStatus; adminNote?: string | null }) => {
    const updated = await productFeedbackRepository.update(id, patch);
    setRows((current) => current.map((item) => (item.id === id ? updated : item)));
    return updated;
  };

  return (
    <div className="feedback-admin-page flex flex-col gap-5 p-6">
      <PageInsightBar
        severity={openCount > 0 ? "warn" : "info"}
        headline={`待处理 ${openCount} 条`}
        description="集中查看内测问题反馈，按状态、类型和页面关键词推进分诊。"
        actions={[
          {
            label: "只看待处理",
            onClick: () => setStatusFilter("open"),
            tone: "primary"
          }
        ]}
      />

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">产品反馈记录</h2>
          <Button variant="outline" size="sm" onClick={() => void loadFeedback()} disabled={loading} aria-busy={loading || undefined}>
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
        </div>

        {errorMessage ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{errorMessage}</p> : null}

        <DataTable
          aria-label="产品反馈记录"
          rows={filteredRows}
          rowKey={(feedback) => feedback.id}
          columns={columns}
          onRowClick={(feedback) => setSelectedId(feedback.id)}
          selectedRowKey={selectedId ?? undefined}
          pageSize={8}
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="状态筛选"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as ProductFeedbackStatus | "all")}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">全部状态</option>
                {productFeedbackStatuses.map((status) => (
                  <option key={status} value={status}>
                    {productFeedbackStatusLabels[status]}
                  </option>
                ))}
              </select>
              <select
                aria-label="类型筛选"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as ProductFeedbackType | "all")}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="all">全部类型</option>
                {productFeedbackTypes.map((type) => (
                  <option key={type} value={type}>
                    {productFeedbackTypeLabels[type]}
                  </option>
                ))}
              </select>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索页面、路径、描述或提交人"
                aria-label="搜索反馈"
                className="h-7 w-64 rounded-md border border-border bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="h-7 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  重置
                </button>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                显示 {filteredRows.length} / {rows.length} 条
              </span>
            </div>
          }
          emptyState={
            loading ? (
              <p className="text-sm text-muted-foreground">正在加载反馈...</p>
            ) : hasActiveFilters ? (
              <div className="text-center">
                <p className="text-sm text-muted-foreground">未匹配任何反馈</p>
                <button type="button" onClick={resetFilters} className="mt-2 text-xs text-primary hover:underline">
                  重置筛选
                </button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">暂无产品反馈</p>
            )
          }
        />
      </section>

      <FeedbackAdminDrawer
        feedback={selectedFeedback}
        open={Boolean(selectedFeedback)}
        onClose={() => setSelectedId(null)}
        onUpdate={updateFeedback}
        getAttachmentObjectUrl={productFeedbackRepository.getAttachmentObjectUrl}
      />
    </div>
  );
}
