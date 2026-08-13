import { describe, expect, it } from "vitest";

import type { ReloadRunDto, ReloadRunStatus } from "../dts-reload/types";
import {
  buildReloadDistillationDraft,
  isReloadRunDistillable,
  RELOAD_DISTILLABLE_STATUSES,
  RELOAD_DISTILLATION_TAGS,
  RELOAD_TERMINAL_STATE_TAGS
} from "./reloadDistillation";

function makeRun(overrides: Partial<ReloadRunDto> = {}): ReloadRunDto {
  return {
    id: "run-kbr-1",
    projectId: "project-aurora",
    configRevisionId: null,
    status: "unverifiable",
    purpose: "ordinary",
    restoresSourceRunId: null,
    failureCode: null,
    targets: [
      {
        bindingId: "binding-watchdog",
        nodePath: "/amba/i2c@FF120000/charger@6E",
        propertyKey: "watchdog_time",
        baselineValue: "<6000>",
        debugValue: "<7000>"
      },
      {
        bindingId: "binding-current",
        nodePath: "/amba/i2c@FF120000/charger@6E",
        propertyKey: "input_current_limit",
        baselineValue: "<3000>",
        debugValue: "<3500>"
      }
    ],
    steps: [],
    diagnostics: [],
    toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
    overlaySource: null,
    overlaySourceSha256: null,
    artifact: { fileName: "debug-overlay.dtbo", sha256: "artifact-sha", sizeBytes: 128 },
    deviceId: "bridge:mock-bridge",
    bridgeId: "mock-bridge",
    bridgeMachineLabel: "Lab Bridge",
    targetRef: "AURORA-01",
    protocol: "hdc",
    integrityCheck: "sha256",
    reloadSnapshot: {
      libraryBaselines: [
        {
          bindingId: "binding-watchdog",
          propertyKey: "watchdog_time",
          nodePath: "/amba/i2c@FF120000/charger@6E",
          baselineValue: "<6000>"
        }
      ],
      artifactDigest: { sha256: "artifact-sha", onDeviceDigest: "artifact-sha", integrityCheck: "sha256" },
      kernelSignal: {
        command: "dmesg",
        captureStatus: "obtained",
        captureError: null,
        rawText: "kernel: watchdog_time applied\nkernel: overlay reload ok\n",
        truncated: false,
        matchedByParameter: [
          {
            parameterName: "watchdog_time",
            bindingId: "binding-watchdog",
            lines: ["kernel: watchdog_time applied", "kernel: watchdog rearm", "kernel: watchdog extra line"]
          },
          { parameterName: "input_current_limit", bindingId: "binding-current", lines: [] }
        ],
        excerpt: null
      },
      behaviouralVerification: {
        outcomes: [
          {
            bindingId: "binding-watchdog",
            propertyKey: "watchdog_time",
            outcome: "verified",
            debugNodeId: "dbg-1",
            nodePath: "/sys/class/wiseeff/watchdog_time",
            expectedValue: "<7000>",
            readValue: "7000",
            reason: null
          },
          {
            bindingId: "binding-current",
            propertyKey: "input_current_limit",
            outcome: "unbound",
            debugNodeId: null,
            nodePath: null,
            expectedValue: "<3500>",
            readValue: null,
            reason: "No readable debug-node binding for this parameter and protocol."
          }
        ]
      }
    },
    artifactRetentionExpired: false,
    createdAt: "2026-08-13T02:00:00.000Z",
    completedAt: "2026-08-13T02:05:00.000Z",
    ...overrides
  };
}

describe("isReloadRunDistillable", () => {
  it("accepts exactly the post-device-write terminals", () => {
    expect(RELOAD_DISTILLABLE_STATUSES).toEqual(["verified", "unverifiable", "contradicted", "failed"]);
    for (const status of RELOAD_DISTILLABLE_STATUSES) {
      expect(isReloadRunDistillable(status)).toBe(true);
    }
    for (const status of ["pending", "blocked", "validated", "deploying"] as ReloadRunStatus[]) {
      expect(isReloadRunDistillable(status)).toBe(false);
    }
  });
});

describe("buildReloadDistillationDraft", () => {
  it("assembles title, tags, and body from the stored run/snapshot DTO only", () => {
    const draft = buildReloadDistillationDraft(makeRun());

    expect(draft.title).toBe("参数调试重载:watchdog_time、input_current_limit(bridge:mock-bridge · AURORA-01)");
    expect(draft.tags).toEqual([...RELOAD_DISTILLATION_TAGS, "不可验证"]);

    // Provenance header references the run as the evidence subject.
    expect(draft.contentMarkdown).toContain("由 DTS 重载运行沉淀");
    expect(draft.contentMarkdown).toContain("`run-kbr-1`");
    expect(draft.contentMarkdown).toContain("Bridge Lab Bridge");

    // Parameter set with baseline → debug values.
    expect(draft.contentMarkdown).toContain("## 参数集(基线 → 调试值)");
    expect(draft.contentMarkdown).toContain("`<6000>` → `<7000>`");
    expect(draft.contentMarkdown).toContain("`<3000>` → `<3500>`");

    // Per-parameter behavioural verification outcomes.
    expect(draft.contentMarkdown).toContain("行为验证:已验证,读回 `7000`");
    expect(draft.contentMarkdown).toContain("行为验证:缺少调试节点绑定(No readable debug-node binding for this parameter and protocol.)");

    // Artifact digest.
    expect(draft.contentMarkdown).toContain("Overlay 产物 SHA256:`artifact-sha`");
    expect(draft.contentMarkdown).toContain("完整性校验:sha256");
  });

  it("pins the honest unverifiable wording: never collapsed into success", () => {
    const draft = buildReloadDistillationDraft(makeRun({ status: "unverifiable" }));
    expect(draft.contentMarkdown).toContain(
      "不可验证:命令全部成功且产物完整落盘,但平台无法确认驱动观察到了新值——这不等于成功。"
    );
    expect(draft.tags).toContain("不可验证");
  });

  it("pins the honest contradicted and failed wording", () => {
    const contradicted = buildReloadDistillationDraft(makeRun({ status: "contradicted" }));
    expect(contradicted.contentMarkdown).toContain("行为矛盾:至少一个调试节点读回与调试值不一致——绝不视为已验证。");
    expect(contradicted.tags).toContain(RELOAD_TERMINAL_STATE_TAGS.contradicted);

    const failed = buildReloadDistillationDraft(makeRun({ status: "failed", failureCode: "transfer-failed" }));
    expect(failed.contentMarkdown).toContain("部署失败:某个部署步骤失败,设备可能未应用(或部分应用)本次调试值。");
    expect(failed.contentMarkdown).toContain("失败码:`transfer-failed`");
    expect(failed.tags).toContain("部署失败");
  });

  it("references kernel-log excerpts without inlining the whole capture", () => {
    const draft = buildReloadDistillationDraft(makeRun());

    // At most two excerpt lines per parameter; the remainder points at the run.
    expect(draft.contentMarkdown).toContain("> `kernel: watchdog_time applied`");
    expect(draft.contentMarkdown).toContain("> `kernel: watchdog rearm`");
    expect(draft.contentMarkdown).not.toContain("kernel: watchdog extra line");
    expect(draft.contentMarkdown).toContain("(其余 1 行见运行记录)");
    // The unfiltered raw capture never lands in the draft.
    expect(draft.contentMarkdown).not.toContain("kernel: overlay reload ok");
    expect(draft.contentMarkdown).toContain("平台不据此判定成败");
  });

  it("states restore-baseline purpose and residue source honestly", () => {
    const draft = buildReloadDistillationDraft(
      makeRun({ purpose: "restore-baseline", restoresSourceRunId: "run-residue-source", status: "verified" })
    );
    expect(draft.title).toContain("恢复基线重载:");
    expect(draft.contentMarkdown).toContain("补偿性恢复基线重载(不是撤销)");
    expect(draft.contentMarkdown).toContain("`run-residue-source`");
  });

  it("stays honest when the run left no snapshot (failed before capture)", () => {
    const draft = buildReloadDistillationDraft(
      makeRun({ status: "failed", failureCode: "mount-failed", reloadSnapshot: null })
    );
    expect(draft.contentMarkdown).toContain("本运行未留下内核日志采集");
    expect(draft.contentMarkdown).toContain("行为验证:未尝试");
  });

  it("refuses non-terminal runs", () => {
    expect(() => buildReloadDistillationDraft(makeRun({ status: "validated" }))).toThrowError(
      /not in a distillable terminal state/
    );
  });
});
