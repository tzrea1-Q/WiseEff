import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { LogDomain, LogWebhookDelivery } from "@/domain/logs/types";
import type { LogAnalysisRepository } from "@/application/ports/LogAnalysisRepository";
import { formatAbsolute } from "@/domain/format/formatDateTime";

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
  return formatAbsolute(iso).replaceAll("-", "/").slice(0, 16);
}

/**
 * Domain result-webhook editor (P3b): URL/secret/enabled ride the same
 * `logs:admin-domains` governance path. The signing secret is write-only — the
 * API only reports configured + last four — and the recent-deliveries list shows
 * per-attempt honesty (delivered / retrying / failed with HTTP status).
 */
export function SkillWebhookEditor({
  domain,
  logActions,
  onSaved,
  disabled = false
}: {
  domain: LogDomain;
  logActions: Required<Pick<LogAnalysisRepository, "listLogDomainWebhookDeliveries" | "setLogDomainWebhook" | "sendLogDomainWebhookTest">>;
  onSaved: () => Promise<void>;
  disabled?: boolean;
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
    void refreshDeliveries().catch(() => setErrorText("无法加载投递记录，请重试。"));
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
      setErrorText("保存失败：请检查回调地址与签名密钥。");
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
          setErrorText(outcome.status === "skipped" ? "测试投递未执行，请检查回调配置。" : "测试投递失败，请检查回调服务后重试。");
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
      aria-label={`分析技能 ${domain.name} 的结果回调配置`}
      data-testid="domain-webhook-editor"
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">结果回调 · {domain.name}</h3>
          <p className="text-xs text-muted-foreground">
            分析结束后向回调地址推送签名摘要和时间戳，不含原始日志；投递失败会自动重试并记录结果。
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">
          <label htmlFor={`domain-webhook-url-${domain.id}`}>回调地址</label>
          <Input
            id={`domain-webhook-url-${domain.id}`}
            disabled={disabled || saving || testing}
            aria-describedby={`domain-webhook-url-help-${domain.id}`}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="https://hooks.example.com/wiseeff"
          />
          <span id={`domain-webhook-url-help-${domain.id}`}>仅支持 HTTPS；禁止私网、环回、链路本地和元数据地址。</span>
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`domain-webhook-secret-${domain.id}`}>
          签名密钥（写入后不回显；{secretConfigured ? `已配置 · 末四位 ${secretLastFour ?? "????"}` : "未配置"}）
          <Input
            id={`domain-webhook-secret-${domain.id}`}
            type="password"
            disabled={disabled || saving || testing}
            value={secretInput}
            onChange={(event) => setSecretInput(event.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder={secretConfigured ? "留空保持现有密钥" : "至少 16 个字符"}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="skill-webhook-toggle flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            disabled={disabled || saving || testing}
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
            disabled={disabled || testing || saving || !secretConfigured || url.trim() === ""}
            aria-busy={testing || undefined}
          >
            发送测试投递
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={disabled || saving || testing} aria-busy={saving || undefined}>
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
                <span className={cn("inline-flex h-5 items-center rounded-md px-1.5 text-xs font-medium", deliveryStatusClasses[delivery.status])}>
                  {deliveryStatusLabels[delivery.status]}
                </span>
                <span className="font-mono text-muted-foreground">{delivery.httpStatus ? `HTTP ${delivery.httpStatus}` : delivery.error ? "回调服务暂不可用" : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
