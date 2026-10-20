/**
 * Presentation-only helpers for `DtsReloadPage` (TD-069 split): labels, badge classes,
 * formatters, and the pure display components for run evidence, deploy confirmation, and
 * residue bookkeeping. No orchestration — that lives in
 * `src/application/dts-reload/dtsReloadRunSession.ts`.
 */

import {
  dtsReloadPurposeLabels,
  dtsReloadStatusLabels,
  dtsReloadVerificationOutcomeLabels,
  isStreamingKernelLogCommand
} from "@/domain/dtsReload/types";
import type {
  DtsReloadCandidate,
  DtsReloadIntegrityCheck,
  DtsReloadParameterVerification,
  DtsReloadResidue,
  DtsReloadRun,
  DtsReloadRunListItem,
  DtsReloadSnapshot
} from "@/domain/dtsReload/types";
import type { DtsWorkbenchTreeNode } from "@/application/parameters/buildDtsTopologyTree";
import type { DeviceBridgeRecord, LocalBridgeHealthState } from "@/infrastructure/http/deviceBridgeClient";
import type { LocalBridgeProbeResult } from "@/infrastructure/http/bridgeConnectLauncher";
import { BookPlus, FilePlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { ParameterValueDiff } from "@/components/ParameterValueDiff";
import { formatAuditAbsoluteTime } from "@/domain/audit/formatAuditTime";

import "./dts-reload-presentation.css";

export const BRIDGE_UPGRADE_ENTRY_PATH = "/node-debugging";

const UNCLASSIFIED_MODULE_LABEL = "未分类";

export function candidateModuleLabel(candidate: Pick<DtsReloadCandidate, "module">): string {
  return candidate.module.trim() || UNCLASSIFIED_MODULE_LABEL;
}

export function findWorkbenchTreeNode(
  nodes: DtsWorkbenchTreeNode[],
  nodeId: string
): DtsWorkbenchTreeNode | null {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const nested = findWorkbenchTreeNode(node.children, nodeId);
    if (nested) return nested;
  }
  return null;
}

export function asDeviceBridgeRecords(
  options: Array<{ id: string; machineLabel: string; lastSeenAt?: string | null }>
): DeviceBridgeRecord[] {
  return options.map((item) => ({
    id: item.id,
    machineLabel: item.machineLabel,
    platform: "darwin",
    arch: "arm64",
    clientVersion: null,
    capabilities: {},
    createdAt: "1970-01-01T00:00:00.000Z",
    lastSeenAt: item.lastSeenAt ?? null,
    revokedAt: null
  }));
}

export function adaptProbeBridgeHealth(
  probe: () => Promise<Pick<LocalBridgeHealthState, "connected" | "bridgeId"> | null>
): () => Promise<LocalBridgeProbeResult> {
  return async () => {
    const partial = await probe();
    if (!partial) {
      return { health: null, reachability: "offline" };
    }
    return {
      health: {
        ok: true,
        paired: true,
        connected: partial.connected,
        bridgeId: partial.bridgeId,
        updatedAt: new Date().toISOString(),
        tools: {
          adb: { available: true },
          hdc: { available: true }
        }
      },
      reachability: "ok"
    };
  };
}

export const dtsReloadStepLabels: Record<string, string> = {
  "compile-base": "编译基础设备树",
  "compile-overlay": "编译 Overlay",
  "dry-run-merge": "干运行合并",
  "assert-effect": "断言效果",
  "mount-target": "挂载目标",
  "transfer-artifact": "传输产物",
  "trigger-reload": "触发重载"
};

export const dtsReloadStepOutcomeLabels: Record<string, string> = {
  passed: "通过",
  failed: "失败",
  skipped: "跳过",
  pending: "等待",
  running: "进行中"
};

export function sensitiveBadgeLabel(candidate: DtsReloadCandidate): string | null {
  const match = candidate.sensitiveMatch;
  if (!match) return null;
  return match.riskTier === "critical" ? "敏感 · 关键风险" : "敏感 · 高风险";
}

export function formatAttemptedAt(value: string): string {
  return formatAuditAbsoluteTime(value);
}

export function integrityCheckLabel(check: DtsReloadIntegrityCheck): string {
  switch (check) {
    case "byte-length":
      return "仅长度校验";
    case "md5":
      return "MD5 摘要匹配";
    case "sha256":
      return "SHA256 摘要匹配";
    default:
      return check;
  }
}

export function statusBadgeClass(status: DtsReloadRun["status"]): string {
  switch (status) {
    case "validated":
    case "verified":
      return "bg-emerald-100 text-emerald-900";
    case "deploying":
      return "bg-sky-100 text-sky-900";
    case "failed":
    case "contradicted":
      return "bg-rose-100 text-rose-950";
    case "unverifiable":
      return "bg-amber-100 text-amber-950";
    case "blocked":
      return "bg-amber-100 text-amber-950";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function verificationOutcomeClass(outcome: DtsReloadParameterVerification["outcome"]): string {
  switch (outcome) {
    case "verified":
      return "text-emerald-800";
    case "contradicted":
      return "text-rose-900";
    case "read-failed":
      return "text-amber-900";
    case "unbound":
    default:
      return "text-muted-foreground";
  }
}

function verificationOutcomeDescription(entry: DtsReloadParameterVerification): string {
  switch (entry.outcome) {
    case "verified":
      return "调试节点读回与调试值在参数值形状下一致。";
    case "contradicted":
      return "调试节点读回与调试值不一致。";
    case "unbound":
      return "该参数没有可用的调试节点绑定，因此无法行为验证——这不是读取失败。";
    case "read-failed":
      return entry.reason?.trim()
        ? `调试节点读取失败：${entry.reason}`
        : "调试节点读取失败；该参数保持未验证，不影响整次运行成败。";
    default:
      return entry.reason ?? "";
  }
}

function stepOutcomeClass(outcome: string): string {
  switch (outcome) {
    case "passed":
      return "text-emerald-800";
    case "failed":
      return "text-rose-900";
    case "running":
      return "text-sky-800";
    case "skipped":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground";
  }
}

export function ReloadSnapshotSummary({ snapshot }: { snapshot: DtsReloadSnapshot }) {
  const digest = snapshot.artifactDigest;
  const signal = snapshot.kernelSignal;
  const verification = snapshot.behaviouralVerification;
  const obtained = signal?.captureStatus === "obtained";
  const matchedGroups = signal?.matchedByParameter ?? [];
  const hasMatches = matchedGroups.some((group) => group.lines.length > 0);
  const outcomes = verification?.outcomes ?? [];

  return (
    <div className="rounded-md border bg-muted/20 p-3 text-xs">
      <p className="font-medium">重载快照</p>
      <p className="mt-1 text-muted-foreground">
        库基线记录 {snapshot.libraryBaselines.length} 条
      </p>
      {digest ? (
        <div className="mt-2 space-y-1 font-mono">
          <p>产物 SHA256：{digest.sha256}</p>
          {digest.onDeviceDigest ? <p>设备端摘要：{digest.onDeviceDigest}</p> : null}
          {digest.integrityCheck ? (
            <p>完整性校验：{integrityCheckLabel(digest.integrityCheck)}</p>
          ) : null}
        </div>
      ) : null}
      {outcomes.length > 0 ? (
        <div className="mt-3 space-y-2 border-t pt-3" aria-label="行为验证结果">
          <p className="font-medium">行为验证（按参数）</p>
          <p className="text-muted-foreground">
            通过已有调试节点绑定读取驱动表面值，并按参数声明的值形状与调试值比较。缺少绑定是诚实缺口，不是失败。
          </p>
          <ul className="space-y-2">
            {outcomes.map((entry) => (
              <li key={entry.bindingId} className="rounded-md border bg-background p-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium font-mono">{entry.propertyKey}</span>
                  <span className={cn("font-medium", verificationOutcomeClass(entry.outcome))}>
                    {dtsReloadVerificationOutcomeLabels[entry.outcome]}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">{verificationOutcomeDescription(entry)}</p>
                {entry.nodePath ? (
                  <p className="mt-1 font-mono text-muted-foreground">节点：{entry.nodePath}</p>
                ) : null}
                {entry.readValue !== null && entry.readValue !== undefined ? (
                  <div className="mt-1">
                    <p>读回：</p>
                    <pre className="parameter-value-content" role="region" aria-label={`${entry.propertyKey} 读回值`} tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- This overflowing value scrollport must support keyboard scrolling. */}>{entry.readValue}</pre>
                  </div>
                ) : null}
                {entry.outcome !== "unbound" && entry.expectedValue ? (
                  <div className="mt-1 text-muted-foreground">
                    <p>期望：</p>
                    <pre className="parameter-value-content" role="region" aria-label={`${entry.propertyKey} 期望值`} tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- This overflowing value scrollport must support keyboard scrolling. */}>{entry.expectedValue}</pre>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {signal ? (
        <div className="mt-3 space-y-2 border-t pt-3" aria-label="内核日志证据">
          <p className="font-medium">内核日志证据（未判定）</p>
          <p className="text-muted-foreground">
            以下内容仅为采集到的内核日志证据。平台<strong>没有</strong>据此推断重载成功或失败。
          </p>
          <p className="font-mono text-muted-foreground">命令：{signal.command}</p>
          {obtained ? (
            <>
              {signal.truncated ? (
                <p className="text-amber-900">
                  {isStreamingKernelLogCommand(signal.command)
                    ? "采集超过字节上限，已截断并保留最早输出。"
                    : "采集超过字节上限，已截断并保留最新输出。"}
                </p>
              ) : null}
              {hasMatches ? (
                <div className="space-y-2" aria-label="按参数名分组的匹配行">
                  {matchedGroups.map((group) =>
                    group.lines.length > 0 ? (
                      <div key={`${group.bindingId}-${group.parameterName}`}>
                        <p className="font-medium font-mono">{group.parameterName}</p>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-2 font-mono text-[11px]">
                          {group.lines.join("\n")}
                        </pre>
                      </div>
                    ) : null
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">已采集到内核日志，但没有匹配到本运行参数名或节点名的行。</p>
              )}
              {signal.rawText ? (
                <details className="rounded-md border bg-background p-2">
                  <summary className="cursor-pointer font-medium">查看未过滤的完整采集</summary>
                  <pre
                    aria-label="未过滤的内核日志采集"
                    className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px]"
                  >
                    {signal.rawText}
                  </pre>
                </details>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">
              未获得内核日志信号
              {signal.captureError ? `：${signal.captureError}` : "。"}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function RunStepsList({ steps }: { steps: DtsReloadRun["steps"] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="dts-reload-run-steps" aria-label="运行步骤">
      {steps.map((step, index) => (
        <li
          key={`${step.step}-${index}`}
          className="dts-reload-run-steps__item"
          data-outcome={step.outcome}
        >
          <div className="dts-reload-run-steps__head">
            <span className="dts-reload-run-steps__name">
              {dtsReloadStepLabels[step.step] ?? step.step}
            </span>
            <span className={cn("dts-reload-run-steps__outcome", stepOutcomeClass(step.outcome))}>
              {dtsReloadStepOutcomeLabels[step.outcome] ?? step.outcome}
            </span>
          </div>
          {step.error ? <p className="dts-reload-run-steps__error">{step.error}</p> : null}
        </li>
      ))}
    </ol>
  );
}

export function DeployConfirmBody({
  run,
  deviceId,
  targetRef,
  bridgeMachineLabel,
  residue
}: {
  run: DtsReloadRun;
  deviceId: string;
  targetRef: string;
  bridgeMachineLabel: string;
  residue: DtsReloadResidue | null;
}) {
  const isRestore = run.purpose === "restore-baseline";
  return (
    <div className="flex flex-col gap-3 text-sm">
      {isRestore ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          这是一次<strong>补偿性重载</strong>，不是撤销。已应用的调试 overlay
          无法卸载；本次会以库基线值作为调试值重新部署一层。
        </p>
      ) : null}
      {residue ? <ResidueIndicator residue={residue} deviceId={deviceId} /> : null}
      <dl className="grid gap-1 text-xs">
        <div>
          <dt className="font-medium">目标设备</dt>
          <dd className="font-mono text-muted-foreground">
            {deviceId} · {targetRef}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Bridge 机器</dt>
          <dd>{bridgeMachineLabel}</dd>
        </div>
        <div>
          <dt className="font-medium">参数数量</dt>
          <dd>{run.targets.length}</dd>
        </div>
      </dl>
      {run.targets.length > 0 ? (
        <div>
          <p className="mb-1 text-xs font-medium">{isRestore ? "将部署的基线值" : "参数变更"}</p>
          <ul className="max-h-40 space-y-2 overflow-y-auto rounded-md border p-2 text-xs">
            {run.targets.map((target) => (
              <li key={target.bindingId}>
                <div className="font-medium">{target.propertyKey}</div>
                <div className="font-mono text-muted-foreground">{target.nodePath}</div>
                {!isRestore ? <div>
                  <p>库基线</p>
                  <pre className="parameter-value-content" role="region" aria-label={`${target.propertyKey} 库基线`} tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- This overflowing value scrollport must support keyboard scrolling. */}>{target.baselineValue ?? "—"}</pre>
                </div> : null}
                <div>
                  <p>{isRestore ? "将部署的基线值" : "调试值"}</p>
                  <pre className="parameter-value-content" role="region" aria-label={`${target.propertyKey} ${isRestore ? "将部署的基线值" : "调试值"}`} tabIndex={0 /* eslint-disable-line jsx-a11y/no-noninteractive-tabindex -- This overflowing value scrollport must support keyboard scrolling. */}>{target.debugValue}</pre>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {run.overlaySource ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium">Overlay 源码</span>
          <textarea
            aria-label="部署确认 Overlay 源码"
            className="min-h-[180px] rounded-md border bg-muted/20 p-2 font-mono text-xs"
            readOnly
            value={run.overlaySource}
          />
        </label>
      ) : null}
    </div>
  );
}

export function RunResultSection({
  run,
  deviceId,
  targetRef,
  canStartRun,
  canRetryDeploy,
  deployReady,
  deploying,
  onDownload,
  onDeploy,
  onDistil,
  distilPending = false,
  onPromote,
  promotePending = false,
  candidates = []
}: {
  run: DtsReloadRun;
  deviceId: string;
  targetRef: string;
  canStartRun: boolean;
  canRetryDeploy: boolean;
  deployReady: boolean;
  deploying: boolean;
  onDownload: () => void;
  onDeploy: () => void;
  /** Distil-to-knowledge handoff; the page gates it to terminal runs + knowledge:edit. */
  onDistil?: () => void;
  distilPending?: boolean;
  /** Promote stored debug values into parameter drafts; stops before submit/CR. */
  onPromote?: () => void;
  promotePending?: boolean;
  candidates?: readonly DtsReloadCandidate[];
}) {
  const nextStep: Record<DtsReloadRun["status"], string> = {
    pending: "正在检查参数与编译产物，请等待预检完成。",
    blocked: "预检已阻断。请根据诊断修正参数或配置，再重新预检。",
    validated: deployReady ? "预检已通过。核对下方参数差异后，点击部署到设备并人工确认。" : "预检已通过。请先连接 Bridge 并选择目标设备，再确认部署。",
    deploying: "正在部署到设备，请等待部署与验证结果。",
    unverifiable: "部署已完成，但行为尚未验证。请查看重载证据，在设备上核对实际效果。",
    verified: "设备读回与调试值一致。可结合实际设备表现继续调试，或将结果沉淀为知识。",
    contradicted: "设备读回与调试值不一致。请查看重载证据与日志，核对节点和实际设备状态。",
    failed: "部署失败。请查看诊断与执行详情，排除原因后重试。"
  };
  return (
    <section className="debug-table dts-reload-run-result" aria-live="polite">
      <div className="panel-header">
        <strong>运行结果</strong>
        <span className={cn("dts-reload-status-pill", statusBadgeClass(run.status))}>
          {dtsReloadStatusLabels[run.status]}
        </span>
      </div>
      <div className="dts-reload-run-result__body">
        <p className="dts-reload-result-next" role="status">{nextStep[run.status]}</p>
        {run.targets.length > 0 ? <section className="dts-reload-run-slice" aria-label="本次参数变更">
          <h3 className="dts-reload-run-slice__title">{run.purpose === "restore-baseline" ? "本次恢复值" : "本次参数变更"} · {run.targets.length} 项</h3>
          <ul className="dts-reload-result-changes">
            {run.targets.map((target) => {
              const candidate = candidates.find((item) => item.bindingId === target.bindingId);
              return <li key={target.bindingId}>
                <strong>{candidate?.displayName || target.propertyKey}</strong>
                <small>{target.propertyKey} · {target.nodePath}</small>
                <ParameterValueDiff baseValue={target.baselineValue ?? ""} targetValue={target.debugValue} />
              </li>;
            })}
          </ul>
        </section> : null}
        {run.failureCode ||
        run.purpose === "restore-baseline" ||
        run.bridgeMachineLabel ||
        run.targetRef ||
        run.integrityCheck ? (
          <section className="dts-reload-run-slice" aria-label="运行摘要">
            <h3 className="dts-reload-run-slice__title">运行信息</h3>
            <dl className="dts-reload-run-summary">
              {run.failureCode ? (
                <div className="dts-reload-run-summary__row">
                  <dt>失败码</dt>
                  <dd className="font-mono">{run.failureCode}</dd>
                </div>
              ) : null}
              {run.purpose === "restore-baseline" ? (
                <div className="dts-reload-run-summary__row">
                  <dt>目的</dt>
                  <dd className="dts-reload-run-purpose">
                    {dtsReloadPurposeLabels["restore-baseline"]}
                    {run.restoresSourceRunId ? `（源运行 ${run.restoresSourceRunId}）` : ""}
                  </dd>
                </div>
              ) : null}
              {run.bridgeMachineLabel || run.targetRef ? (
                <div className="dts-reload-run-summary__row">
                  <dt>目标设备</dt>
                  <dd>
                    <span className="font-mono">
                      {run.deviceId ?? deviceId} · {run.targetRef ?? targetRef}
                    </span>
                    {run.bridgeMachineLabel ? ` · Bridge ${run.bridgeMachineLabel}` : ""}
                    {run.purpose === "restore-baseline" ? " · 补偿性恢复基线" : ""}
                  </dd>
                </div>
              ) : null}
              {run.integrityCheck ? (
                <div className="dts-reload-run-summary__row">
                  <dt>完整性校验</dt>
                  <dd>{integrityCheckLabel(run.integrityCheck)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}

        {run.diagnostics.length > 0 ? (
          <section className="dts-reload-run-slice dts-reload-run-slice--danger" aria-label="诊断信息">
            <h3 className="dts-reload-run-slice__title">诊断</h3>
            <ul className="dts-reload-diagnostics">
              {run.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${index}`}>{diagnostic.message}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {run.steps.length > 0 ? (
          <details className="dts-reload-run-slice dts-reload-result-details" aria-label="预检步骤">
            <summary>执行详情 · {run.steps.length} 个步骤</summary>
            <RunStepsList steps={run.steps} />
          </details>
        ) : null}

        {run.reloadSnapshot ? (
          <details className="dts-reload-run-slice dts-reload-result-details" aria-label="重载证据">
            <summary>重载证据 · 设备读回与日志</summary>
            <ReloadSnapshotSummary snapshot={run.reloadSnapshot} />
          </details>
        ) : null}

        {run.overlaySource ? (
          <details className="dts-reload-run-slice dts-reload-result-details">
            <summary>Overlay 源码</summary>
            <div className="dts-reload-overlay-source">
              <textarea aria-label="Overlay 源码" readOnly value={run.overlaySource} />
            </div>
          </details>
        ) : null}

        {run.artifact || (canRetryDeploy && canStartRun) || onDistil || onPromote ? (
          <section className="dts-reload-run-slice dts-reload-run-slice--actions" aria-label="产物与操作">
            <h3 className="dts-reload-run-slice__title">产物与操作</h3>
            {run.artifact ? (
              <div className="dts-reload-artifact">
                <button
                  type="button"
                  className="button subtle dts-reload-artifact__download"
                  disabled={run.artifactRetentionExpired === true}
                  title={run.artifact.fileName}
                  onClick={onDownload}
                >
                  {run.artifactRetentionExpired
                    ? "产物已过期（不可下载）"
                    : "下载编译产物"}
                </button>
                <details className="dts-reload-result-details"><summary>产物信息与校验摘要</summary><p className="font-mono">{run.artifact.fileName}</p><p className="font-mono">SHA256 {run.artifact.sha256}</p></details>
              </div>
            ) : null}
            {onDistil ? (
              <button
                type="button"
                className="button subtle"
                disabled={distilPending}
                aria-busy={distilPending || undefined}
                onClick={onDistil}
              >
                <BookPlus size={16} strokeWidth={1.9} aria-hidden="true" />
                沉淀为知识
              </button>
            ) : null}
            {onPromote ? (
              <button
                type="button"
                className="button subtle"
                disabled={promotePending}
                aria-busy={promotePending || undefined}
                onClick={onPromote}
              >
                <FilePlus size={16} strokeWidth={1.9} aria-hidden="true" />
                晋升为草稿
              </button>
            ) : null}
            {canRetryDeploy && canStartRun ? (
              <button
                type="button"
                className="submit-round-button debugging-deploy-button"
                data-primary-action="true"
                disabled={!deployReady || deploying}
                onClick={onDeploy}
              >
                {run.status === "failed" ? "重试部署到设备" : "部署到设备"}
              </button>
            ) : null}
          </section>
        ) : null}
      </div>
    </section>
  );
}

export function RunHistorySection({
  historyItems,
  historyLoading,
  historyLoadingMore,
  historyRunLoading = false,
  historyError,
  historyNextCursor,
  historyFilterDevice,
  deviceId,
  activeRunId,
  onFilterDeviceChange,
  onOpenRun,
  onLoadMore,
  onRetry,
  candidates = []
}: {
  historyItems: DtsReloadRunListItem[];
  historyLoading: boolean;
  historyLoadingMore: boolean;
  historyRunLoading?: boolean;
  historyError: string;
  historyNextCursor: string | null;
  historyFilterDevice: boolean;
  deviceId: string;
  activeRunId: string | null;
  onFilterDeviceChange: (value: boolean) => void;
  onOpenRun: (runId: string) => void;
  onLoadMore: () => void;
  onRetry: () => void;
  candidates?: readonly DtsReloadCandidate[];
}) {
  return (
    <details className="operation-history-panel dts-reload-history" aria-label="运行历史">
      <summary id="dts-reload-history-title">
        <strong>运行历史</strong>
        <span>
          {historyLoading
            ? "加载中…"
            : historyItems.length > 0
              ? `${historyItems.length} 条`
              : "暂无记录"}
        </span>
      </summary>
      <div className="dts-reload-history__body" aria-busy={historyRunLoading || historyLoading}>
        {historyRunLoading ? <p role="status">正在加载运行详情…</p> : null}
        <p className="dts-reload-history__hint">
          按项目列出（可选设备过滤），含已阻断与失败运行；恢复基线运行单独标注。
        </p>
        <label className="dts-reload-history__filter">
          <input
            type="checkbox"
            checked={Boolean(historyFilterDevice && deviceId.trim())}
            disabled={!deviceId.trim()}
            onChange={(event) => onFilterDeviceChange(event.target.checked)}
            aria-label="仅显示当前设备的运行"
          />
          仅当前设备
          {deviceId.trim() ? `（${deviceId.trim()}）` : "（先连接并选择设备）"}
        </label>
        {historyError ? (
          <p role="alert" className="dts-reload-history__error">
            {historyError}
            <button type="button" className="button subtle" disabled={historyLoading} onClick={onRetry}>重新加载历史</button>
          </p>
        ) : null}
        {historyLoading ? (
          <p>加载运行历史…</p>
        ) : historyItems.length === 0 ? (
          <p>暂无运行记录。</p>
        ) : (
          <ul className="dts-reload-history__list">
            {historyItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(activeRunId === item.id && "is-active")}
                  aria-current={activeRunId === item.id ? "true" : undefined}
                  onClick={() => onOpenRun(item.id)}
                >
                  <div className="dts-reload-history__row-head">
                    <span className={cn("dts-reload-status-pill", statusBadgeClass(item.status))}>
                      {dtsReloadStatusLabels[item.status]}
                    </span>
                    {item.purpose === "restore-baseline" ? (
                      <span className="dts-reload-purpose-pill">
                        {dtsReloadPurposeLabels["restore-baseline"]}
                      </span>
                    ) : null}
                    <span>{formatAttemptedAt(item.createdAt)}</span>
                  </div>
                  <div className="dts-reload-history__row-meta">
                    {item.deviceId ?? "未绑定设备"} · {item.targetCount} 个参数
                    {item.propertyKeys.length > 0 ? <span title={item.propertyKeys.join("、")}> · {item.propertyKeys.slice(0, 3).map((key) => candidates.find((candidate) => candidate.propertyKey === key)?.displayName || key).join("、")}{item.propertyKeys.length > 3 ? " 等" : ""}</span> : null}
                    {item.failureCode ? ` · ${item.failureCode}` : ""}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {historyNextCursor ? (
          <button
            type="button"
            className="button subtle"
            disabled={historyLoadingMore || historyLoading}
            onClick={onLoadMore}
          >
            {historyLoadingMore ? "加载中…" : "加载更多"}
          </button>
        ) : null}
      </div>
    </details>
  );
}

export function RestoreConfirmBody({
  residue,
  deviceId,
  restoreHasSensitive,
  restoreHasCriticalSensitive,
  restoreCriticalConfirmed,
  residueSensitiveCandidates,
  onRestoreCriticalConfirmedChange
}: {
  residue: DtsReloadResidue;
  deviceId: string;
  restoreHasSensitive: boolean;
  restoreHasCriticalSensitive: boolean;
  restoreCriticalConfirmed: boolean;
  residueSensitiveCandidates: DtsReloadCandidate[];
  onRestoreCriticalConfirmedChange: (value: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs leading-relaxed">
        将使用产生残留的那次运行记录中的<strong>库基线值</strong>，启动一次<strong>新的重载运行</strong>。
        这是<strong>补偿性重载</strong>，不是撤销；已应用的 Overlay 无法卸载。
      </p>
      <ResidueIndicator residue={residue} deviceId={deviceId} />
      <p className="text-xs text-muted-foreground">
        恢复基线会先预检；预检通过后，请核对设备并单独确认部署。
      </p>
      {restoreHasSensitive ? (
        <div className="text-xs text-amber-950">
          残留包含敏感参数，恢复基线仍需相应授权。
          <details><summary>权限说明</summary>
          {Array.from(
            new Set(
              residueSensitiveCandidates
                .map((candidate) => candidate.sensitiveMatch?.requiredCapability)
                .filter((value): value is string => Boolean(value))
            )
          ).join(" / ") || "parameter:edit-critical"}
          </details>
        </div>
      ) : null}
      {restoreHasCriticalSensitive ? (
        <label className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-950">
          <input
            type="checkbox"
            className="mt-1"
            checked={restoreCriticalConfirmed}
            onChange={(event) => onRestoreCriticalConfirmedChange(event.target.checked)}
            aria-label="确认关键风险参数恢复基线"
          />
          <span>
            我确认要以库基线值对关键风险参数启动补偿性恢复；设备部署仍需单独确认。
          </span>
        </label>
      ) : null}
    </div>
  );
}

export function ResidueIndicator({
  residue,
  deviceId
}: {
  residue: DtsReloadResidue;
  deviceId: string;
}) {
  const parameterNames = residue.parameters.map((entry) => entry.propertyKey).join("、") || "（无参数）";
  return (
    <aside
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950"
      aria-label="重载残留指示"
      data-testid="reload-residue-indicator"
    >
      <p className="font-semibold">设备可能携带调试残留</p>
      <p className="mt-1 text-xs">
        设备 <span className="font-mono">{deviceId || residue.deviceId}</span> 的平台记账显示，运行{" "}
        <span className="font-mono">{residue.sourceRunId}</span> 曾部署调试值（参数：{parameterNames}）。
      </p>
      <p className="mt-2 text-xs leading-relaxed">
        这是<strong>平台根据运行历史做的记账</strong>，无法从设备侧确认。重启、重新刷机，或在平台之外做的任何改动，都会使该指示失效。
      </p>
    </aside>
  );
}
