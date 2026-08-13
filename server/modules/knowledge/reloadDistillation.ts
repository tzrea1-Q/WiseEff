import type {
  ParameterVerificationRecordDto,
  ReloadRunDto,
  ReloadRunStatus
} from "../dts-reload/types";

/**
 * Knowledge distillation prefill, source #2 (design deferred roadmap item 3):
 * a terminal DTS reload run becomes a pre-filled markdown draft. This builder
 * couples ONLY to the stored run/snapshot DTO (`ReloadRunDto`) — never to
 * bridge internals, deploy steps, or kernel-signal capture code — so device
 * plumbing changes cannot break it. The honest outcome is part of the
 * knowledge value: unverifiable, contradicted, and failed runs distil with
 * their terminal state stated plainly, never softened into success.
 */

export const RELOAD_DISTILLATION_TAGS = ["参数调试", "DTS重载"] as const;

/**
 * Post-device-write terminals only: something happened on a device, so there
 * is a debugging outcome to distil. Pre-deploy states (pending / blocked /
 * validated / deploying) have no outcome yet and are refused.
 */
export const RELOAD_DISTILLABLE_STATUSES = ["verified", "unverifiable", "contradicted", "failed"] as const;

export type ReloadDistillableStatus = (typeof RELOAD_DISTILLABLE_STATUSES)[number];

export function isReloadRunDistillable(status: ReloadRunStatus): status is ReloadDistillableStatus {
  return (RELOAD_DISTILLABLE_STATUSES as readonly ReloadRunStatus[]).includes(status);
}

/** Terminal-state tags/wording, aligned with the /dts-reload status labels. */
export const RELOAD_TERMINAL_STATE_TAGS: Record<ReloadDistillableStatus, string> = {
  verified: "行为已验证",
  unverifiable: "不可验证",
  contradicted: "行为矛盾",
  failed: "部署失败"
};

/** Honest one-line statement of what each terminal actually means. */
const RELOAD_TERMINAL_STATEMENTS: Record<ReloadDistillableStatus, string> = {
  verified: "行为已验证:每个有可读调试节点绑定的参数都读回并与调试值一致。",
  unverifiable: "不可验证:命令全部成功且产物完整落盘,但平台无法确认驱动观察到了新值——这不等于成功。",
  contradicted: "行为矛盾:至少一个调试节点读回与调试值不一致——绝不视为已验证。",
  failed: "部署失败:某个部署步骤失败,设备可能未应用(或部分应用)本次调试值。"
};

const VERIFICATION_OUTCOME_LABELS: Record<ParameterVerificationRecordDto["outcome"], string> = {
  verified: "已验证",
  contradicted: "矛盾",
  unbound: "缺少调试节点绑定",
  "read-failed": "读取失败"
};

const PURPOSE_LABELS: Record<ReloadRunDto["purpose"], string> = {
  ordinary: "参数调试重载",
  "restore-baseline": "恢复基线重载"
};

const MAX_TITLE_CHARS = 200;
const MAX_EXCERPT_LINES_PER_PARAMETER = 2;

export type ReloadDistillationDraft = {
  title: string;
  tags: string[];
  contentMarkdown: string;
};

function deviceContext(run: ReloadRunDto): string {
  const parts = [run.deviceId, run.targetRef].filter((value): value is string => Boolean(value?.trim()));
  return parts.length > 0 ? parts.join(" · ") : "未绑定设备";
}

function propertySummary(run: ReloadRunDto): string {
  const keys = run.targets.map((target) => target.propertyKey);
  if (keys.length === 0) return "无参数";
  if (keys.length <= 2) return keys.join("、");
  return `${keys.slice(0, 2).join("、")} 等 ${keys.length} 项`;
}

export function buildReloadDistillationDraft(run: ReloadRunDto): ReloadDistillationDraft {
  if (!isReloadRunDistillable(run.status)) {
    throw new Error(`Reload run ${run.id} is not in a distillable terminal state: ${run.status}`);
  }
  const status = run.status;
  const stateTag = RELOAD_TERMINAL_STATE_TAGS[status];
  const title = `${PURPOSE_LABELS[run.purpose]}:${propertySummary(run)}(${deviceContext(run)})`.slice(
    0,
    MAX_TITLE_CHARS
  );

  const snapshot = run.reloadSnapshot;
  const verificationByBinding = new Map<string, ParameterVerificationRecordDto>(
    (snapshot?.behaviouralVerification?.outcomes ?? []).map((outcome) => [outcome.bindingId, outcome])
  );

  const lines: string[] = [
    `> 由 DTS 重载运行沉淀。运行 \`${run.id}\`(项目 \`${run.projectId}\`,设备 ${deviceContext(run)}${
      run.bridgeMachineLabel ? `,Bridge ${run.bridgeMachineLabel}` : ""
    }),完成时间 ${run.completedAt ?? run.createdAt}。`,
    ""
  ];

  lines.push("## 运行结果", "", RELOAD_TERMINAL_STATEMENTS[status]);
  if (run.failureCode) {
    lines.push("", `失败码:\`${run.failureCode}\``);
  }
  if (run.purpose === "restore-baseline") {
    lines.push(
      "",
      `本次为补偿性恢复基线重载(不是撤销)${run.restoresSourceRunId ? `,补偿的残留来源运行:\`${run.restoresSourceRunId}\`` : ""}。`
    );
  }
  lines.push("");

  lines.push("## 参数集(基线 → 调试值)", "");
  if (run.targets.length === 0) {
    lines.push("(本运行没有参数目标记录。)", "");
  } else {
    for (const target of run.targets) {
      lines.push(`### ${target.propertyKey}`, "");
      lines.push(`- 节点:\`${target.nodePath}\``);
      lines.push(`- 值变更:\`${target.baselineValue ?? "—"}\` → \`${target.debugValue}\``);
      const verification = verificationByBinding.get(target.bindingId);
      if (verification) {
        const readBack =
          verification.readValue !== null && verification.readValue !== undefined
            ? `,读回 \`${verification.readValue}\``
            : "";
        const reason = verification.reason ? `(${verification.reason})` : "";
        lines.push(`- 行为验证:${VERIFICATION_OUTCOME_LABELS[verification.outcome]}${readBack}${reason}`);
      } else {
        lines.push("- 行为验证:未尝试(运行未留下该参数的验证记录)");
      }
      lines.push("");
    }
  }

  const digest = snapshot?.artifactDigest ?? null;
  if (digest || run.artifact) {
    lines.push("## 产物摘要", "");
    const sha = digest?.sha256 ?? run.artifact?.sha256;
    if (sha) lines.push(`- Overlay 产物 SHA256:\`${sha}\``);
    if (digest?.onDeviceDigest) lines.push(`- 设备端摘要:\`${digest.onDeviceDigest}\``);
    if (digest?.integrityCheck) lines.push(`- 完整性校验:${digest.integrityCheck}`);
    lines.push("");
  }

  lines.push("## 内核日志证据(未判定)", "");
  const signal = snapshot?.kernelSignal ?? null;
  if (signal) {
    lines.push(
      `重载运行 \`${run.id}\` 保存了完整的内核日志采集(命令 \`${signal.command}\`),以下仅为按参数名匹配的摘录;平台不据此判定成败。`,
      ""
    );
    const groupsWithLines = signal.matchedByParameter.filter((group) => group.lines.length > 0);
    if (signal.captureStatus === "not-obtained") {
      lines.push(`未获得内核日志信号${signal.captureError ? `:${signal.captureError}` : "。"}`, "");
    } else if (groupsWithLines.length === 0) {
      lines.push("已采集到内核日志,但没有匹配到本运行参数名的行。", "");
    } else {
      for (const group of groupsWithLines) {
        lines.push(`**${group.parameterName}**`, "");
        lines.push(...group.lines.slice(0, MAX_EXCERPT_LINES_PER_PARAMETER).map((line) => `> \`${line}\``));
        if (group.lines.length > MAX_EXCERPT_LINES_PER_PARAMETER) {
          lines.push(`> (其余 ${group.lines.length - MAX_EXCERPT_LINES_PER_PARAMETER} 行见运行记录)`);
        }
        lines.push("");
      }
    }
  } else {
    lines.push(`本运行未留下内核日志采集;完整证据以重载运行 \`${run.id}\` 的运行记录为准。`, "");
  }

  return {
    title,
    tags: [...RELOAD_DISTILLATION_TAGS, stateTag],
    contentMarkdown: `${lines.join("\n").trimEnd()}\n`
  };
}
