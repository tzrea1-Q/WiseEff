import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DataTable,
  LogRecordDrawer,
  PageInsightBar,
  TimeWindowSelect,
  type Column
} from "@/components/admin";
import { Button } from "@/components/ui/button";
import { canPerform } from "@/app/permissions";
import { cn } from "@/lib/utils";
import { applyTableFilters, applyTimeWindow, deriveInsight, deriveMetrics } from "@/logAdminAnalytics";
import { formatPercent } from "@/domain/format/formatPercent";
import { STAGE_LABELS, type LogRecord, type LogStatus, type PrototypeState, type TimeWindow } from "@/domain/prototype/types";
import type { LogDomain, LogFeedbackInsight, LogWebhookDelivery } from "@/domain/logs/types";
import { useTopBarActions } from "@/components/layout";
import { logRuntimeFailureNotification, type LogRuntimeActions } from "@/application/logs/logRuntime";
import type { KnowledgeRepository } from "@/application/ports/KnowledgeRepository";
import type { KnowledgeEntry } from "@/domain/knowledge/types";
import type { LogDomainKnowledgeLink } from "@/domain/logs/types";
import { wiseEffRuntimeMode } from "@/infrastructure/http/runtimeMode";
import { dispatchXiaozeOpenHandoff } from "@/features/agent/xiaozeOpenHandoff";
import type { AppAction } from "@/application/state/appState";

export type LogAdminPageProps = {
  state: PrototypeState;
  dispatch: React.Dispatch<AppAction>;
  onNavigate: (path: string) => void;
  search: string;
  logActions?: LogRuntimeActions;
  /** Published-entry catalog for the domain ↔ knowledge link editor (API mode only). */
  knowledgeRepository?: KnowledgeRepository;
};

const statusLabels: Record<LogStatus, string> = {
  Processing: "处理中",
  Complete: "已完成",
  Failed: "失败"
};

const statusBadgeClasses: Record<LogStatus, string> = {
  Processing: "bg-blue-100 text-blue-900",
  Complete: "bg-emerald-100 text-emerald-900",
  Failed: "bg-destructive/15 text-destructive"
};

function StatusBadge({ status }: { status: LogStatus }) {
  return (
    <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium", statusBadgeClasses[status])}>
      {statusLabels[status]}
    </span>
  );
}

const INSIGHT_DISMISS_KEY = "log-admin-insight-dismissed";

function todayDateKey(): string {
  const date = new Date();
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function readInsightDismissed(): boolean {
  try {
    return localStorage.getItem(INSIGHT_DISMISS_KEY) === todayDateKey();
  } catch {
    return false;
  }
}

function writeInsightDismissed(): void {
  try {
    localStorage.setItem(INSIGHT_DISMISS_KEY, todayDateKey());
  } catch {
    // Ignore storage restrictions in embedded or test environments.
  }
}

type PendingLogAction = "archive" | "reanalyze" | "feedback" | "unarchive";

function pendingKey(kind: PendingLogAction, logId: string): string {
  return `${kind}:${logId}`;
}

function runtimeAlreadyNotified(error: unknown): boolean {
  return error instanceof Error && (error as { alreadyNotified?: unknown }).alreadyNotified === true;
}

type LogDomainFormState = {
  domainId?: string;
  name: string;
  description: string;
  profileText: string;
  modelOverride: string;
};

const emptyLogDomainForm: LogDomainFormState = { name: "", description: "", profileText: "", modelOverride: "" };

function parseProfileText(profileText: string): { ok: true; profile: unknown } | { ok: false; error: string } {
  const trimmed = profileText.trim();
  if (trimmed.length === 0) {
    return { ok: true, profile: undefined };
  }
  try {
    return { ok: true, profile: JSON.parse(trimmed) };
  } catch (error) {
    return { ok: false, error: `画像 JSON 无法解析：${error instanceof Error ? error.message : String(error)}` };
  }
}

function formatProfileText(profile: unknown): string {
  if (profile === undefined || profile === null) {
    return "";
  }
  return JSON.stringify(profile, null, 2);
}

const deliveryStatusLabels: Record<LogWebhookDelivery["status"], string> = {
  delivered: "已送达",
  retrying: "重试中",
  failed: "投递失败"
};

const deliveryStatusClasses: Record<LogWebhookDelivery["status"], string> = {
  delivered: "bg-emerald-100 text-emerald-900",
  retrying: "bg-amber-100 text-amber-900",
  failed: "bg-destructive/15 text-destructive"
};

function formatDeliveryTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("zh-CN", { hour12: false });
}

/**
 * Domain result-webhook editor (P3b): URL/secret/enabled ride the same
 * `logs:admin-domains` governance path. The signing secret is write-only — the
 * API only reports configured + last four — and the recent-deliveries list shows
 * per-attempt honesty (delivered / retrying / failed with HTTP status).
 */
function DomainWebhookEditor({
  domain,
  logActions,
  onSaved,
  onClose
}: {
  domain: LogDomain;
  logActions: LogRuntimeActions;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [enabled, setEnabled] = useState(domain.webhook?.enabled ?? false);
  const [url, setUrl] = useState(domain.webhook?.url ?? "");
  const [secretInput, setSecretInput] = useState("");
  const [secretConfigured, setSecretConfigured] = useState(domain.webhook?.secretConfigured ?? false);
  const [secretLastFour, setSecretLastFour] = useState(domain.webhook?.secretLastFour);
  const [deliveries, setDeliveries] = useState<LogWebhookDelivery[]>([]);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const refreshDeliveries = useCallback(async () => {
    setDeliveries(await logActions.listLogDomainWebhookDeliveries(domain.id, 10));
  }, [domain.id, logActions]);

  useEffect(() => {
    void refreshDeliveries();
  }, [refreshDeliveries]);

  const save = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setStatusText(null);
    setErrorText(null);
    try {
      const saved = await logActions.setLogDomainWebhook({
        domainId: domain.id,
        url: url.trim() === "" ? null : url.trim(),
        enabled,
        // Empty input keeps the stored secret; typing replaces it.
        ...(secretInput.trim() === "" ? {} : { secret: secretInput.trim() })
      });
      if (saved) {
        setSecretConfigured(saved.webhook?.secretConfigured ?? false);
        setSecretLastFour(saved.webhook?.secretLastFour);
        setSecretInput("");
        setStatusText("配置已保存");
        await onSaved();
      }
    } catch {
      setErrorText("保存失败：请检查 URL（仅支持 https，禁止私网/环回/元数据地址）与密钥。");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (testing) {
      return;
    }
    setTesting(true);
    setStatusText(null);
    setErrorText(null);
    try {
      const outcome = await logActions.sendLogDomainWebhookTest(domain.id);
      if (outcome) {
        if (outcome.status === "delivered") {
          setStatusText(`测试投递成功（HTTP ${outcome.httpStatus ?? "-"}）`);
        } else {
          setErrorText(`测试投递${outcome.status === "skipped" ? "未执行" : "失败"}：${outcome.error ?? "未知原因"}`);
        }
      }
      await refreshDeliveries();
    } catch {
      setErrorText("测试投递未完成，请稍后重试。");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      role="group"
      aria-label={`业务域 ${domain.name} 的结果回调配置`}
      data-testid="domain-webhook-editor"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">结果回调 Webhook · {domain.name}</h3>
          <p className="text-xs text-muted-foreground">
            分析到达终态（完成含降级、失败）后向该 URL 推送签名摘要（HMAC-SHA256 + 时间戳，不含原始日志内容）；投递尽力而为，失败自动重试后如实记录。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`domain-webhook-url-${domain.id}`}>
          Webhook URL（仅 https；禁止私网/环回/链路本地/元数据地址）
          <input
            id={`domain-webhook-url-${domain.id}`}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="https://hooks.example.com/wiseeff"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`domain-webhook-secret-${domain.id}`}>
          签名密钥（写入后不回显；{secretConfigured ? `已配置 · 末四位 ${secretLastFour ?? "????"}` : "未配置"}）
          <input
            id={`domain-webhook-secret-${domain.id}`}
            type="password"
            value={secretInput}
            onChange={(event) => setSecretInput(event.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={secretConfigured ? "留空保持现有密钥" : "至少 16 个字符"}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            aria-label="启用结果回调"
          />
          启用结果回调
        </label>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void sendTest()}
            disabled={testing || !secretConfigured || url.trim() === ""}
            aria-busy={testing || undefined}
          >
            发送测试投递
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving} aria-busy={saving || undefined}>
            保存配置
          </Button>
        </div>
      </div>

      {statusText ? (
        <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-900">
          {statusText}
        </p>
      ) : null}
      {errorText ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
          {errorText}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold text-foreground">最近投递</h4>
        {deliveries.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无投递记录。</p>
        ) : (
          <ul className="flex flex-col gap-1" aria-label="最近投递记录" data-testid="domain-webhook-deliveries">
            {deliveries.map((delivery) => (
              <li key={delivery.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
                <span className="font-mono text-muted-foreground">{formatDeliveryTime(delivery.createdAt)}</span>
                <span className="text-muted-foreground">{delivery.kind === "test" ? "测试" : "结果"} · 第 {delivery.attempt} 次</span>
                <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium", deliveryStatusClasses[delivery.status])}>
                  {deliveryStatusLabels[delivery.status]}
                </span>
                <span className="font-mono text-muted-foreground">{delivery.httpStatus ? `HTTP ${delivery.httpStatus}` : delivery.error ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Domain ↔ knowledge link editor (P2): the link set bounds `read_domain_knowledge`
 * retrieval, so only PUBLISHED entries are selectable; entries archived after
 * linking show up as stale and drop out of the saved set (retrieval already
 * ignores them — publishing stays the single trust gate).
 */
function DomainKnowledgeLinksEditor({
  domain,
  logActions,
  knowledgeRepository,
  onClose
}: {
  domain: LogDomain;
  logActions: LogRuntimeActions;
  knowledgeRepository?: KnowledgeRepository;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [links, setLinks] = useState<LogDomainKnowledgeLink[]>([]);
  const [publishedEntries, setPublishedEntries] = useState<KnowledgeEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSaved(false);
    void (async () => {
      const [currentLinks, entries] = await Promise.all([
        logActions.listLogDomainKnowledgeLinks(domain.id),
        knowledgeRepository
          ? knowledgeRepository.list({ status: "published" }).then((response) => response.items).catch(() => [])
          : Promise.resolve([])
      ]);
      if (cancelled) {
        return;
      }
      setLinks(currentLinks);
      setPublishedEntries(entries);
      setSelectedIds(new Set(currentLinks.filter((link) => link.entryStatus === "published").map((link) => link.knowledgeEntryId)));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [domain.id, logActions, knowledgeRepository]);

  const staleLinks = links.filter((link) => link.entryStatus !== "published");
  const filteredEntries = publishedEntries.filter((entry) =>
    filter.trim() === "" ? true : entry.title.toLowerCase().includes(filter.trim().toLowerCase())
  );

  const toggleEntry = (entryId: string) => {
    setSaved(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const save = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    try {
      const result = await logActions.setLogDomainKnowledgeLinks({
        domainId: domain.id,
        knowledgeEntryIds: [...selectedIds]
      });
      if (result) {
        setLinks(result);
        setSelectedIds(new Set(result.filter((link) => link.entryStatus === "published").map((link) => link.knowledgeEntryId)));
        setSaved(true);
      }
    } catch {
      // The runtime already surfaced a notification; keep the editor open for correction.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
      role="group"
      aria-label={`业务域 ${domain.name} 的知识条目关联`}
      data-testid="domain-knowledge-links-editor"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">关联知识条目 · {domain.name}</h3>
          <p className="text-xs text-muted-foreground">
            仅可关联<strong>已发布</strong>的知识条目；分析时 read_domain_knowledge 检索限定在关联集合内，未关联时退化为组织内通用检索。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onClose}>
          关闭
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">正在加载知识条目…</p>
      ) : (
        <>
          {staleLinks.length > 0 ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900" role="note">
              {staleLinks.length} 条已关联条目当前非已发布状态（检索已自动忽略）；保存后这些失效关联将被移除：
              {staleLinks.map((link) => ` ${link.entryTitle}`).join("、")}
            </p>
          ) : null}

          <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`domain-knowledge-filter-${domain.id}`}>
            按标题筛选已发布条目
            <input
              id={`domain-knowledge-filter-${domain.id}`}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="例如：E_THERMAL_FOLDBACK"
            />
          </label>

          {publishedEntries.length === 0 ? (
            <p className="text-xs text-muted-foreground">组织内暂无已发布的知识条目；请先在 /knowledge 发布领域知识。</p>
          ) : (
            <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2" aria-label="可关联的已发布知识条目">
              {filteredEntries.map((entry) => (
                <li key={entry.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-foreground hover:bg-muted/60">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(entry.id)}
                      onChange={() => toggleEntry(entry.id)}
                      aria-label={`关联知识条目 ${entry.title}`}
                    />
                    <span className="truncate">{entry.title}</span>
                    {entry.tags.length > 0 ? (
                      <span className="truncate text-xs text-muted-foreground">{entry.tags.join(" · ")}</span>
                    ) : null}
                  </label>
                </li>
              ))}
              {filteredEntries.length === 0 ? (
                <li className="px-1.5 py-1 text-xs text-muted-foreground">没有匹配筛选条件的已发布条目。</li>
              ) : null}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground" data-testid="domain-knowledge-links-count">
              已选 {selectedIds.size} 条
              {saved ? <span className="ml-2 text-emerald-700" role="status">已保存</span> : null}
            </p>
            <Button size="sm" onClick={() => void save()} disabled={saving} aria-busy={saving || undefined}>
              保存关联
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function LogDomainGovernanceSection({
  canGovern,
  logActions,
  knowledgeRepository
}: {
  canGovern: boolean;
  logActions?: LogRuntimeActions;
  knowledgeRepository?: KnowledgeRepository;
}) {
  const [domains, setDomains] = useState<LogDomain[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<LogDomainFormState>(emptyLogDomainForm);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [linksDomain, setLinksDomain] = useState<LogDomain | null>(null);
  const [webhookDomain, setWebhookDomain] = useState<LogDomain | null>(null);

  const refreshDomains = useCallback(async () => {
    if (!logActions) {
      return;
    }
    setDomains(await logActions.listLogDomains({ includeArchived: true }));
  }, [logActions]);

  useEffect(() => {
    void refreshDomains();
  }, [refreshDomains]);

  const openCreateForm = () => {
    setForm(emptyLogDomainForm);
    setProfileError(null);
    setFormOpen(true);
  };

  const openEditForm = (domain: LogDomain) => {
    setForm({
      domainId: domain.id,
      name: domain.name,
      description: domain.description ?? "",
      profileText: formatProfileText(domain.formatProfile),
      modelOverride: domain.modelOverride ?? ""
    });
    setProfileError(null);
    setFormOpen(true);
  };

  const submitForm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!logActions || pending) {
      return;
    }
    const parsedProfile = parseProfileText(form.profileText);
    if (!parsedProfile.ok) {
      setProfileError(parsedProfile.error);
      return;
    }
    setProfileError(null);
    setPending(true);
    try {
      let saved = form.domainId
        ? await logActions.updateLogDomain({
            domainId: form.domainId,
            name: form.name.trim(),
            description: form.description.trim() === "" ? null : form.description.trim(),
            formatProfile: form.profileText.trim() === "" ? null : parsedProfile.profile,
            modelOverride: form.modelOverride.trim() === "" ? null : form.modelOverride.trim()
          })
        : await logActions.createLogDomain({
            name: form.name.trim(),
            description: form.description.trim() === "" ? undefined : form.description.trim(),
            formatProfile: parsedProfile.profile
          });
      // Creation does not carry the override; apply it right after in the same save.
      if (saved && !form.domainId && form.modelOverride.trim() !== "") {
        saved = await logActions.updateLogDomain({ domainId: saved.id, modelOverride: form.modelOverride.trim() });
      }
      if (saved) {
        setFormOpen(false);
        setForm(emptyLogDomainForm);
        await refreshDomains();
      }
    } catch {
      // The runtime has already surfaced a notification; keep the form open for correction.
    } finally {
      setPending(false);
    }
  };

  const archiveDomain = async (domainId: string) => {
    if (!logActions || pending) {
      return;
    }
    setPending(true);
    try {
      await logActions.archiveLogDomain(domainId);
      await refreshDomains();
    } catch {
      // Already notified by the runtime.
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex flex-col gap-2" aria-label="日志业务域治理" data-testid="log-domain-governance">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">业务域治理</h2>
          <p className="text-xs text-muted-foreground">
            注册业务域（格式画像 + 分析侧重），上传时可绑定；未绑定的日志走未分类域通用分析。
          </p>
        </div>
        {canGovern ? (
          <Button size="sm" onClick={openCreateForm} disabled={!logActions}>
            新建业务域
          </Button>
        ) : null}
      </div>

      {!canGovern ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          业务域治理需要 Admin 权限（logs:admin-domains）。
        </p>
      ) : !logActions ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          业务域治理需在 API 模式下使用；mock 模式仅展示静态日志种子。
        </p>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-sm" aria-label="业务域列表">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">名称</th>
                  <th className="px-3 py-2 font-medium">描述</th>
                  <th className="px-3 py-2 font-medium">格式画像</th>
                  <th className="px-3 py-2 font-medium">模型</th>
                  <th className="px-3 py-2 font-medium">结果回调</th>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {domains.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-center text-xs text-muted-foreground">
                      暂无业务域；未分类域始终可用（通用分析）。
                    </td>
                  </tr>
                ) : (
                  domains.map((domain) => (
                    <tr key={domain.id} className={cn("border-t border-border", domain.status === "archived" && "opacity-60")}>
                      <td className="px-3 py-2 font-medium text-foreground">{domain.name}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{domain.description ?? "-"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{domain.formatProfile ? "已配置" : "未配置"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground" data-testid={`domain-model-${domain.id}`}>
                        {domain.modelOverride ? <span className="font-mono">{domain.modelOverride}</span> : "全局模型"}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground" data-testid={`domain-webhook-state-${domain.id}`}>
                        {domain.webhook?.enabled ? "已启用" : domain.webhook?.url ? "已配置未启用" : "未配置"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={cn(
                            "inline-flex h-5 items-center rounded-md px-1.5 text-[11px] font-medium",
                            domain.status === "active" ? "bg-emerald-100 text-emerald-900" : "bg-muted text-muted-foreground"
                          )}
                        >
                          {domain.status === "active" ? "启用" : "已归档"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button variant="outline" size="sm" disabled={pending} onClick={() => openEditForm(domain)}>
                            编辑
                          </Button>
                          {domain.status === "active" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() => setLinksDomain((current) => (current?.id === domain.id ? null : domain))}
                            >
                              知识条目
                            </Button>
                          ) : null}
                          {domain.status === "active" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={pending}
                              onClick={() => setWebhookDomain((current) => (current?.id === domain.id ? null : domain))}
                            >
                              结果回调
                            </Button>
                          ) : null}
                          {domain.status === "active" ? (
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={pending}
                              onClick={() => void archiveDomain(domain.id)}
                            >
                              归档
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {formOpen ? (
            <form
              className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
              aria-label={form.domainId ? "编辑业务域" : "新建业务域"}
              onSubmit={(event) => void submitForm(event)}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor="log-domain-name">
                  名称（组织内唯一）
                  <input
                    id="log-domain-name"
                    required
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    className="h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="例如：charging-power"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor="log-domain-description">
                  描述（可选）
                  <input
                    id="log-domain-description"
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    className="h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="例如：充电/电源子系统内核日志"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor="log-domain-model-override">
                模型覆盖（可选：仅替换模型名，端点 / API Key / 预算仍用全局配置）
                <input
                  id="log-domain-model-override"
                  value={form.modelOverride}
                  onChange={(event) => setForm((current) => ({ ...current, modelOverride: event.target.value }))}
                  className="h-8 rounded-md border border-border bg-background px-2.5 font-mono text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="留空使用全局模型"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor="log-domain-profile">
                格式画像 JSON（可选：timestampPattern / multiline / severityMap）
                <textarea
                  id="log-domain-profile"
                  value={form.profileText}
                  rows={6}
                  onChange={(event) => setForm((current) => ({ ...current, profileText: event.target.value }))}
                  className="rounded-md border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder={'{\n  "timestampPattern": "^\\\\[(\\\\d+\\\\.\\\\d+)\\\\]",\n  "severityMap": { "error": ["<3>"] }\n}'}
                />
              </label>
              {profileError ? (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
                  {profileError}
                </p>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setFormOpen(false)}>
                  取消
                </Button>
                <Button type="submit" size="sm" disabled={pending || form.name.trim() === ""} aria-busy={pending || undefined}>
                  {form.domainId ? "保存修改" : "创建业务域"}
                </Button>
              </div>
            </form>
          ) : null}

          {linksDomain && logActions ? (
            <DomainKnowledgeLinksEditor
              domain={linksDomain}
              logActions={logActions}
              knowledgeRepository={knowledgeRepository}
              onClose={() => setLinksDomain(null)}
            />
          ) : null}

          {webhookDomain && logActions ? (
            <DomainWebhookEditor
              domain={webhookDomain}
              logActions={logActions}
              onSaved={refreshDomains}
              onClose={() => setWebhookDomain(null)}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

const feedbackAnalysisSourceLabels: Record<"agent" | "rules-fallback" | "none", string> = {
  agent: "Agent 分析",
  "rules-fallback": "降级 · 规则回退",
  none: "未标注来源"
};

function feedbackInsightRowKey(row: LogFeedbackInsight): string {
  return `${row.logDomainId ?? "uncategorized"}:${row.analysisSource ?? "none"}:${row.promptVersion ?? "none"}`;
}

/**
 * Analysis-quality insights (P3 online monitoring, evaluation build order step 3):
 * helpful rate per log domain × analysis source × prompt version over the page's
 * shared time window. Read-only aggregation of `log_feedback` — the shared golden
 * case set stays the quality anchor; this section watches live feedback drift.
 */
function FeedbackQualityInsightsSection({
  timeWindow,
  logActions,
  refreshKey
}: {
  timeWindow: TimeWindow;
  logActions?: LogRuntimeActions;
  refreshKey: number;
}) {
  const [rows, setRows] = useState<LogFeedbackInsight[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!logActions) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void logActions
      .listFeedbackInsights({ timeWindow })
      .then((items) => {
        if (!cancelled) {
          setRows(items);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [logActions, refreshKey, timeWindow]);

  const columns: Column<LogFeedbackInsight>[] = [
    {
      key: "logDomainName",
      header: "业务域",
      render: (row) => (
        <span className={cn("text-sm", row.logDomainName ? "font-medium text-foreground" : "text-muted-foreground")}>
          {row.logDomainName ?? "未分类"}
        </span>
      ),
      sortAccessor: (row) => row.logDomainName ?? ""
    },
    {
      key: "analysisSource",
      header: "分析来源",
      render: (row) => (
        <span className="text-xs text-muted-foreground">{feedbackAnalysisSourceLabels[row.analysisSource ?? "none"]}</span>
      ),
      sortAccessor: (row) => row.analysisSource ?? "",
      widthClass: "w-36"
    },
    {
      key: "promptVersion",
      header: "Prompt 版本",
      render: (row) => <span className="font-mono text-xs text-muted-foreground">{row.promptVersion ?? "-"}</span>,
      sortAccessor: (row) => row.promptVersion ?? "",
      widthClass: "w-44"
    },
    {
      key: "totalCount",
      header: "反馈条数",
      render: (row) => <span className="font-mono text-xs">{row.totalCount}</span>,
      sortAccessor: (row) => row.totalCount,
      align: "right",
      widthClass: "w-24"
    },
    {
      key: "helpfulRate",
      header: "有帮助率",
      render: (row) => {
        const percent = Math.round(row.helpfulRate * 100);
        return (
          <span
            className={cn(
              "font-mono text-xs",
              percent >= 80 ? "text-emerald-700" : percent >= 50 ? "text-amber-700" : "text-destructive"
            )}
          >
            {percent}%（{row.helpfulCount}/{row.totalCount}）
          </span>
        );
      },
      sortAccessor: (row) => row.helpfulRate,
      align: "right",
      widthClass: "w-32"
    }
  ];

  return (
    <section className="flex flex-col gap-2" aria-label="分析质量" data-testid="feedback-quality-insights">
      <div>
        <h2 className="text-sm font-semibold text-foreground">分析质量</h2>
        <p className="text-xs text-muted-foreground">
          按业务域 × 分析来源 × Prompt 版本聚合用户反馈的有帮助率（跟随右上角时间窗口），用于监控线上分析质量漂移。
        </p>
      </div>
      {!logActions ? (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          分析质量监控需在 API 模式下使用；mock 模式仅展示静态日志种子。
        </p>
      ) : (
        <DataTable
          aria-label="分析质量反馈聚合"
          rows={rows}
          rowKey={feedbackInsightRowKey}
          columns={columns}
          pageSize={6}
          emptyState={
            <p className="text-sm text-muted-foreground">{loading ? "正在加载反馈数据…" : "暂无反馈"}</p>
          }
        />
      )}
    </section>
  );
}

export function LogAdminPage({ state, dispatch, onNavigate, search: _search, logActions, knowledgeRepository }: LogAdminPageProps) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("today");
  const [tableQuery, setTableQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<LogStatus[]>([]);
  const [moduleFilter, setModuleFilter] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "updatedAtIso", dir: "desc" });
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [undoArchive, setUndoArchive] = useState<{ logId: string; fileName: string } | null>(null);
  const [insightDismissed, setInsightDismissed] = useState<boolean>(() => readInsightDismissed());
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const [syncPending, setSyncPending] = useState(false);
  const [logView, setLogView] = useState<"active" | "archived">("active");
  const [archivedLoaded, setArchivedLoaded] = useState(false);
  const [feedbackInsightsRefreshKey, setFeedbackInsightsRefreshKey] = useState(0);

  const runPendingAction = async (kind: PendingLogAction, logId: string, action: () => Promise<void>) => {
    const key = pendingKey(kind, logId);
    setPendingActions((current) => new Set(current).add(key));
    try {
      await action();
    } catch (error) {
      if (!runtimeAlreadyNotified(error)) {
        dispatch({ type: "ADD_NOTIFICATION", message: logRuntimeFailureNotification });
      }
    } finally {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };

  useEffect(() => {
    if (!undoArchive) {
      return undefined;
    }

    // The archived view makes archiving reversible any time; the undo window
    // still gives a fast path for accidental clicks.
    const timer = window.setTimeout(() => setUndoArchive(null), 10000);
    return () => window.clearTimeout(timer);
  }, [undoArchive]);

  // Load archived records lazily when entering the archived view in API mode.
  useEffect(() => {
    if (logView !== "archived" || archivedLoaded || !logActions) {
      return;
    }
    setArchivedLoaded(true);
    void logActions.refresh({ includeArchived: true }).catch(() => {
      setArchivedLoaded(false);
    });
  }, [archivedLoaded, logActions, logView]);

  const visibleLogs = useMemo(
    () => state.logs.filter((log) => !state.archivedLogIds.includes(log.id)),
    [state.archivedLogIds, state.logs]
  );
  const archivedLogs = useMemo(
    () => state.logs.filter((log) => state.archivedLogIds.includes(log.id)),
    [state.archivedLogIds, state.logs]
  );
  const windowLogs = useMemo(() => applyTimeWindow(visibleLogs, timeWindow), [timeWindow, visibleLogs]);
  const metrics = useMemo(() => deriveMetrics(windowLogs, timeWindow, visibleLogs), [timeWindow, visibleLogs, windowLogs]);
  const tableSourceLogs = logView === "archived" ? archivedLogs : windowLogs;
  const filteredRows = useMemo(
    () => applyTableFilters(tableSourceLogs, { tableQuery, statusFilter, moduleFilter, sortBy }),
    [moduleFilter, sortBy, statusFilter, tableQuery, tableSourceLogs]
  );
  const availableModules = useMemo(
    () => Array.from(new Set(tableSourceLogs.map((log) => log.source))).sort(),
    [tableSourceLogs]
  );
  const insight = useMemo(() => deriveInsight(windowLogs, visibleLogs), [visibleLogs, windowLogs]);
  const canAct = canPerform(state.activeRoleId, "admin.access");
  const selectedRecord = selectedRecordId ? state.logs.find((log) => log.id === selectedRecordId) ?? null : null;

  const unarchiveLog = (logId: string) => {
    if (!logActions) {
      dispatch({ type: "LOG_ADMIN_UNARCHIVE_LOG", logId });
      setUndoArchive((current) => (current?.logId === logId ? null : current));
      return;
    }
    void runPendingAction("unarchive", logId, async () => {
      await logActions.unarchive(logId);
      setUndoArchive((current) => (current?.logId === logId ? null : current));
    });
  };

  const toggleStatusFilter = (status: string) => {
    if (!Object.keys(statusLabels).includes(status)) return;
    setStatusFilter((current) =>
      current.includes(status as LogStatus) ? current.filter((item) => item !== status) : [...current, status as LogStatus]
    );
  };
  const toggleModuleFilter = (module: string) => {
    setModuleFilter((current) => (current.includes(module) ? current.filter((item) => item !== module) : [...current, module]));
  };

  const columns: Column<LogRecord>[] = [
    {
      key: "reportId",
      header: "报告 ID",
      render: (record) => <span className="font-mono text-xs text-primary">{record.reportId}</span>,
      sortAccessor: (record) => record.reportId,
      widthClass: "w-28"
    },
    {
      key: "fileName",
      header: "文件名",
      render: (record) => <span className="font-medium text-foreground">{record.fileName}</span>,
      sortAccessor: (record) => record.fileName
    },
    {
      key: "source",
      header: "来源模块",
      headerFilter: {
        label: "来源模块",
        values: availableModules,
        selectedValues: moduleFilter,
        getValue: (record) => record.source,
        onToggle: toggleModuleFilter,
        onClear: () => setModuleFilter([])
      },
      render: (record) => <span className="text-muted-foreground">{record.source}</span>,
      sortAccessor: (record) => record.source,
      widthClass: "w-36"
    },
    {
      key: "stage",
      header: "分析阶段",
      render: (record) => <span className="text-xs text-muted-foreground">{STAGE_LABELS[record.stage]}</span>,
      sortAccessor: (record) => record.stage,
      widthClass: "w-28"
    },
    {
      key: "status",
      header: "状态",
      headerFilter: {
        label: "状态",
        values: ["Processing", "Complete", "Failed"],
        selectedValues: statusFilter,
        getValue: (record) => record.status,
        renderLabel: (status) => statusLabels[status as LogStatus] ?? status,
        onToggle: toggleStatusFilter,
        onClear: () => setStatusFilter([]),
        align: "right"
      },
      render: (record) => <StatusBadge status={record.status} />,
      sortAccessor: (record) => record.status,
      widthClass: "w-24"
    },
    {
      key: "confidence",
      header: "置信度",
      render: (record) =>
        record.status === "Failed" ? <span className="text-muted-foreground">-</span> : <span className="font-mono text-xs">{formatPercent(record.confidence)}</span>,
      sortAccessor: (record) => record.confidence,
      align: "right",
      widthClass: "w-24"
    },
    {
      key: "action",
      header: "",
      render: (record) =>
        logView === "archived" && canAct ? (
          <button
            type="button"
            className="text-xs font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
            disabled={pendingActions.has(pendingKey("unarchive", record.id))}
            aria-busy={pendingActions.has(pendingKey("unarchive", record.id)) || undefined}
            onClick={(event) => {
              event.stopPropagation();
              unarchiveLog(record.id);
            }}
          >
            恢复
          </button>
        ) : (
          <span className="text-xs text-primary">查看</span>
        ),
      align: "right",
      widthClass: "w-20"
    }
  ];

  const resetFilters = () => {
    setTableQuery("");
    setStatusFilter([]);
    setModuleFilter([]);
    setSortBy({ key: "updatedAtIso", dir: "desc" });
  };

  const handleInsightAction = (kind: "locate-failures" | "send-to-agent" | "dismiss") => {
    if (!insight) {
      return;
    }
    if (kind === "dismiss") {
      writeInsightDismissed();
      setInsightDismissed(true);
      return;
    }
    if (kind === "locate-failures") {
      setStatusFilter(["Failed"]);
      return;
    }

    const preset =
      insight.severity === "error"
        ? "log-admin-failures"
        : insight.severity === "warn"
          ? "log-admin-stuck"
          : "log-admin-confidence-drop";
    if (wiseEffRuntimeMode === "api") {
      dispatchXiaozeOpenHandoff(preset);
      return;
    }
    dispatch({
      type: "PUSH_NOTIFICATION",
      message: "日志治理分析需在 API 模式下通过右下角「小泽」继续。"
    });
  };

  const handleExport = () => {
    const payload = {
      generatedAt: new Date().toISOString(),
      timeWindow,
      metrics,
      rows: filteredRows.map((record) => ({
        reportId: record.reportId,
        fileName: record.fileName,
        source: record.source,
        status: record.status,
        stage: record.stage,
        confidence: record.confidence,
        updatedAtIso: record.updatedAtIso
      }))
    };

    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `log-admin-report-${todayDateKey()}.json`;
      document.body.appendChild(anchor);
      if (!navigator.userAgent.toLowerCase().includes("jsdom")) {
        anchor.click();
      }
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } catch {
      // jsdom and locked-down browser contexts may not support synthetic downloads.
    }

    dispatch({ type: "LOG_ADMIN_EXPORT_REPORT", timeWindow });
  };

  const handleSync = async () => {
    if (!logActions) {
      dispatch({ type: "LOG_ADMIN_SYNC_LOGS" });
      return;
    }

    setSyncPending(true);
    try {
      await logActions.refresh({ includeArchived: true });
    } catch (error) {
      if (!runtimeAlreadyNotified(error)) {
        dispatch({ type: "ADD_NOTIFICATION", message: logRuntimeFailureNotification });
      }
    } finally {
      setSyncPending(false);
    }
  };

  const selectedRecordArchivePending = selectedRecord ? pendingActions.has(pendingKey("archive", selectedRecord.id)) : false;
  const selectedRecordReanalyzePending = selectedRecord ? pendingActions.has(pendingKey("reanalyze", selectedRecord.id)) : false;
  const selectedRecordFeedbackPending = selectedRecord ? pendingActions.has(pendingKey("feedback", selectedRecord.id)) : false;
  const undoArchivePending = undoArchive ? pendingActions.has(pendingKey("unarchive", undoArchive.logId)) : false;

  const hasActiveFilters = tableQuery !== "" || statusFilter.length > 0 || moduleFilter.length > 0;
  useTopBarActions(
    <>
      <TimeWindowSelect value={timeWindow} onChange={setTimeWindow} />
      <Button variant="outline" size="sm" onClick={handleExport}>
        <Download data-icon="inline-start" />
        导出报表
      </Button>
      <Button size="sm" onClick={handleSync} disabled={syncPending} aria-busy={syncPending || undefined}>
        <RefreshCw data-icon="inline-start" />
        同步日志
      </Button>
    </>,
    [filteredRows, metrics, syncPending, timeWindow]
  );

  return (
    <div className="log-admin-page flex flex-col gap-5 p-6">
      {insight && !insightDismissed ? (
        <PageInsightBar
          variant={insight.severity}
          headline={insight.headline}
          description={insight.description}
          onDismiss={() => {
            writeInsightDismissed();
            setInsightDismissed(true);
          }}
          actions={insight.actions.map((action) => ({
            label: action.label,
            onClick: () => handleInsightAction(action.kind),
            variant: action.kind === "locate-failures" ? ("primary" as const) : ("subtle" as const)
          }))}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4">
        <LogDomainGovernanceSection
          canGovern={canPerform(state.activeRoleId, "logs.admin-domains")}
          logActions={logActions}
          knowledgeRepository={knowledgeRepository}
        />
        <FeedbackQualityInsightsSection
          timeWindow={timeWindow}
          logActions={logActions}
          refreshKey={feedbackInsightsRefreshKey}
        />
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">日志分析记录</h2>
            <div className="flex items-center gap-1" role="group" aria-label="日志视图切换">
              <button
                type="button"
                aria-pressed={logView === "active"}
                onClick={() => setLogView("active")}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs transition-colors",
                  logView === "active" ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"
                )}
              >
                活跃日志
              </button>
              <button
                type="button"
                aria-pressed={logView === "archived"}
                onClick={() => setLogView("archived")}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs transition-colors",
                  logView === "archived" ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted"
                )}
              >
                已归档{archivedLogs.length > 0 ? `（${archivedLogs.length}）` : ""}
              </button>
            </div>
          </div>
          <DataTable
            aria-label="日志分析记录"
            rows={filteredRows}
            rowKey={(record) => record.id}
            columns={columns}
            onRowClick={(record) => setSelectedRecordId(record.id)}
            selectedRowKey={selectedRecordId ?? undefined}
            pageSize={8}
            toolbar={
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={tableQuery}
                  onChange={(event) => setTableQuery(event.target.value)}
                  placeholder="搜索 RPT- 或文件名"
                  className="h-7 w-56 rounded-md border border-border bg-background px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  显示 {filteredRows.length} / {tableSourceLogs.length} 条
                </span>
              </div>
            }
            emptyState={
              hasActiveFilters ? (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground">未匹配任何记录</p>
                  <button type="button" onClick={resetFilters} className="mt-2 text-xs text-primary hover:underline">
                    重置筛选
                  </button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {logView === "archived" ? "暂无已归档日志" : "当前时间窗口内暂无日志"}
                </p>
              )
            }
          />
        </section>
      </div>

      <LogRecordDrawer
        record={selectedRecord}
        open={!!selectedRecord}
        onClose={() => setSelectedRecordId(null)}
        onNavigateToWorkbench={(id) => {
          const target = state.logs.find((log) => log.id === id);
          onNavigate(`/logs${target ? `?id=${target.reportId}` : ""}`);
          setSelectedRecordId(null);
        }}
        onReanalyze={(id) => {
          if (!logActions) {
            dispatch({ type: "LOG_ADMIN_REANALYZE_LOG", logId: id });
            setSelectedRecordId(null);
            return;
          }

          void runPendingAction("reanalyze", id, async () => {
            await logActions.rerun({ logId: id });
            setSelectedRecordId(null);
          });
        }}
        onArchive={(id) => {
          const log = state.logs.find((item) => item.id === id);
          if (!logActions) {
            dispatch({ type: "LOG_ADMIN_ARCHIVE_LOG", logId: id });
            if (log) {
              setUndoArchive({ logId: id, fileName: log.fileName });
            }
            setSelectedRecordId(null);
            return;
          }

          void runPendingAction("archive", id, async () => {
            await logActions.archive(id);
            // The post-archive refresh only returns active logs, so the archived
            // record drops out of local state; force the archived view to reload
            // from the server next time it opens instead of showing a stale blank.
            setArchivedLoaded(false);
            if (log) {
              setUndoArchive({ logId: id, fileName: log.fileName });
            }
            setSelectedRecordId(null);
          });
        }}
        onSubmitHelpfulFeedback={(id) => {
          if (!logActions) {
            const log = state.logs.find((item) => item.id === id);
            dispatch({ type: "ADD_NOTIFICATION", message: log ? `${log.fileName} 反馈已记录` : "日志反馈已记录" });
            return;
          }

          void runPendingAction("feedback", id, async () => {
            await logActions.submitFeedback({ logId: id, rating: "helpful" });
            setFeedbackInsightsRefreshKey((key) => key + 1);
          });
        }}
        canAct={canAct}
        reanalyzePending={selectedRecordReanalyzePending}
        archivePending={selectedRecordArchivePending}
        feedbackPending={selectedRecordFeedbackPending}
      />

      {undoArchive ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-lg"
        >
          <span className="text-sm text-foreground">
            已归档 <span className="font-mono text-xs">{undoArchive.fileName}</span>
            <span className="ml-1 text-xs text-muted-foreground">（可随时在「已归档」视图恢复）</span>
          </span>
          <button
            type="button"
            disabled={undoArchivePending}
            aria-busy={undoArchivePending || undefined}
            onClick={() => unarchiveLog(undoArchive.logId)}
            className="text-sm font-medium text-primary hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            撤销
          </button>
        </div>
      ) : null}
    </div>
  );
}
