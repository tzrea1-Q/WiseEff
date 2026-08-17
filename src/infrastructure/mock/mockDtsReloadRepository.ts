/**
 * Mock DtsReloadRepository adapter — restores ADR-0002 for the parameter-debugging surface:
 * mock mode serves the same semantic reload model through the same port instead of a static
 * "API mode only" page.
 *
 * Like `mockDtsStructuredRepository`, the mock owns a single fixture dataset and serves it
 * for any project id, so candidates, runs, and residue always describe the same device
 * story. It is stateful and honest about the run lifecycle: `startRun` preflights to
 * `validated`, `deployRun` refuses without the explicit `confirm-dts-reload` token (and
 * critical-sensitive targets refuse `startRun`/`restoreBaseline` without
 * `confirm-sensitive-reload`), ordinary deploys record residue bookkeeping, and
 * restore-baseline deploys clear it — mirroring the server gates the real client hits.
 */

import type {
  DeployDtsReloadRunInput,
  DtsReloadRepository,
  ListDtsReloadRunsInput,
  RestoreDtsReloadBaselineInput,
  StartDtsReloadRunInput
} from "@/application/ports/DtsReloadRepository";
import {
  DTS_RELOAD_CONFIRMATION_TOKEN,
  SENSITIVE_RELOAD_CONFIRMATION_TOKEN
} from "@/domain/dtsReload/types";
import type {
  DtsReloadCandidate,
  DtsReloadResidue,
  DtsReloadRun,
  DtsReloadRunListItem,
  OrganisationReloadConfiguration,
  ReloadConfigurationContract
} from "@/domain/dtsReload/types";
import { mockApiError } from "./mockApiError";

export const MOCK_DTS_RELOAD_BRIDGE_ID = "mock-bridge";
export const MOCK_DTS_RELOAD_DEVICE_ID = `bridge:${MOCK_DTS_RELOAD_BRIDGE_ID}`;
export const MOCK_DTS_RELOAD_TARGET_REF = "MOCK-AURORA-001";

const MOCK_PROJECT_ID = "project-teaching";
const SEED_RESIDUE_RUN_ID = "mock-reload-seed-01";
/** Deterministic clock base; created runs count forward from here so they sort newest. */
const MOCK_CLOCK_BASE_MS = Date.parse("2026-08-12T10:00:00.000Z");

/**
 * Demo/test seams for the `/dts-reload` page in mock mode: a paired, connected bridge and
 * one reachable target so the deploy confirmation flow is walkable without local hardware.
 */
export function createMockDtsReloadBridgeSeams() {
  return {
    bridges: [
      {
        id: MOCK_DTS_RELOAD_BRIDGE_ID,
        machineLabel: "Mock Bridge",
        lastSeenAt: new Date().toISOString()
      }
    ],
    probeBridgeHealth: async () => ({
      connected: true,
      bridgeId: MOCK_DTS_RELOAD_BRIDGE_ID
    }),
    detectTargets: async () => [
      {
        targetRef: MOCK_DTS_RELOAD_TARGET_REF,
        label: `Mock Bridge · ${MOCK_DTS_RELOAD_TARGET_REF}`,
        bridgeId: MOCK_DTS_RELOAD_BRIDGE_ID
      }
    ],
    // The bridge panel prefetches a pairing code while local health is still unknown;
    // mock mode must satisfy that without HTTP.
    createPairingCode: async () => ({
      code: "000000",
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    })
  };
}

/** Candidates spanning every supported reload value shape plus honest blocked rows. */
function createCandidateFixtures(): DtsReloadCandidate[] {
  return [
    {
      bindingId: "mock-binding-watchdog",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "watchdog_time",
      displayName: "Watchdog 超时",
      module: "充电管理",
      moduleId: null,
      nodePath: "/amba/i2c@FF120000/charger@6E",
      compatible: "vendor,charger123",
      baselineValue: "<6000>",
      description: "充电看门狗超时时间；超时未喂狗则复位充电 IC。",
      valueShapeKind: "cells",
      resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
      unit: "ms",
      constraints: { min: 0, max: 20000, cells: 1 },
      debuggable: true,
      sensitiveMatch: null,
      lastReload: {
        runId: SEED_RESIDUE_RUN_ID,
        debugValue: "<7000>",
        attemptedAt: "2026-08-10T12:00:00.000Z",
        outcome: "unverifiable",
        purpose: "ordinary"
      }
    },
    {
      bindingId: "mock-binding-input-current",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "input_current_limit",
      displayName: "输入限流",
      module: "充电管理",
      moduleId: null,
      nodePath: "/amba/i2c@FF120000/charger@6E",
      compatible: "vendor,charger123",
      baselineValue: "<3000>",
      description: "适配器输入电流上限；过高会触发硬件保护。",
      valueShapeKind: "cells",
      resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
      unit: "mA",
      constraints: { min: 100, max: 12000, cells: 1 },
      debuggable: true,
      sensitiveMatch: {
        riskTier: "critical",
        requiredCapability: "parameter:edit-critical",
        ruleId: "mock-rule-critical-charger",
        matchType: "path",
        pattern: "/amba/i2c@FF120000/charger@6E",
        requiresElevatedCapability: true,
        requiresConfirmation: true
      }
    },
    {
      bindingId: "mock-binding-thermal-steps",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "thermal_derate_steps",
      displayName: "温控降档阈值",
      module: "温控",
      moduleId: null,
      nodePath: "/soc/thermal-zone@0",
      compatible: "vendor,thermal-zone",
      baselineValue: "<85 90 95>",
      description: "三档温度降额阈值（摄氏度），从轻降到停机。",
      valueShapeKind: "cells",
      resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 3, groups: 1 },
      unit: "°C",
      constraints: { min: 40, max: 125, cells: 3 },
      debuggable: true,
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-calibration",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "calibration_bytes",
      displayName: "校准字节表",
      module: "传感器",
      moduleId: null,
      nodePath: "/amba/i2c@FF130000/sensor@40",
      compatible: "vendor,temp-sensor",
      baselineValue: "/bits/ 8 <0x0A 0x14 0x1E 0x28>",
      description: "温度传感器四点校准字节，按 /bits/ 8 编写。",
      valueShapeKind: "bytes",
      resolvedValueShape: { kind: "cells", bits: 8, cellsPerGroup: 4, groups: 1 },
      unit: null,
      constraints: { cells: 4 },
      debuggable: true,
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-sensor-gain",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "sensor_gain_table",
      displayName: "增益表",
      module: "传感器",
      moduleId: null,
      nodePath: "/amba/i2c@FF130000/sensor@40",
      compatible: "vendor,temp-sensor",
      baselineValue: "/bits/ 16 <256 512>",
      description: "两级采样增益，按 /bits/ 16 编写。",
      valueShapeKind: "cells",
      resolvedValueShape: { kind: "cells", bits: 16, cellsPerGroup: 2, groups: 1 },
      unit: null,
      constraints: { cells: 2 },
      debuggable: true,
      sensitiveMatch: {
        riskTier: "high",
        requiredCapability: "parameter:edit-critical",
        ruleId: "mock-rule-high-sensor",
        matchType: "compatible",
        pattern: "vendor,temp-sensor",
        requiresElevatedCapability: true,
        requiresConfirmation: false
      }
    },
    {
      bindingId: "mock-binding-status",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "status",
      displayName: "节点状态",
      module: "电源",
      moduleId: null,
      nodePath: "/soc/regulator@1",
      compatible: "vendor,regulator",
      baselineValue: '"okay"',
      description: "节点启用状态字符串。",
      valueShapeKind: "string",
      resolvedValueShape: { kind: "string" },
      unit: null,
      constraints: {},
      debuggable: true,
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-compatible",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "compatible",
      displayName: "兼容标识列表",
      module: "电源",
      moduleId: null,
      nodePath: "/soc/regulator@1",
      compatible: "vendor,regulator",
      baselineValue: '"vendor,regulator", "vendor,regulator-v2"',
      description: "驱动匹配的 compatible 字符串列表。",
      valueShapeKind: "string-list",
      resolvedValueShape: { kind: "string-list" },
      unit: null,
      constraints: {},
      debuggable: true,
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-enable-gpios",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "enable-gpios",
      displayName: "使能 GPIO",
      module: "电源",
      moduleId: null,
      nodePath: "/soc/regulator@1",
      compatible: "vendor,regulator",
      baselineValue: "<&gpio13 29 0>",
      description: "GPIO 风格 phandle 数组：控制器引用 + 引脚号 + 标志。",
      valueShapeKind: "phandle-list",
      resolvedValueShape: { kind: "phandle-cells", bits: 32, cellsPerGroup: 3, groups: 1 },
      unit: null,
      constraints: { cells: 3 },
      debuggable: true,
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-keep-power",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "keep-power",
      displayName: "保持供电",
      module: "电源",
      moduleId: null,
      nodePath: "/soc/regulator@1",
      compatible: "vendor,regulator",
      baselineValue: "",
      description: "布尔属性：存在即保持供电。",
      valueShapeKind: "boolean",
      resolvedValueShape: { kind: "boolean" },
      unit: null,
      constraints: {},
      debuggable: true,
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-ranges",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "ranges",
      displayName: "地址范围",
      module: "总线",
      moduleId: null,
      nodePath: "/amba/i2c@FF120000",
      compatible: "vendor,i2c",
      baselineValue: "",
      description: "空属性：声明地址翻译但无 ranges 表。",
      valueShapeKind: "empty",
      resolvedValueShape: { kind: "empty" },
      unit: null,
      constraints: {},
      debuggable: true,
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-interrupt-parent",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "interrupt-parent",
      displayName: "中断父节点",
      module: "电源",
      moduleId: null,
      nodePath: "/soc/regulator@1",
      compatible: "vendor,regulator",
      baselineValue: "<&gic>",
      description: "裸 phandle 列表，指向中断控制器。",
      valueShapeKind: "phandle-list",
      resolvedValueShape: { kind: "phandle-list", bits: 32, cellsPerGroup: 1, groups: 1 },
      unit: null,
      constraints: {},
      debuggable: true,
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-aux-map",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "aux-map",
      displayName: "辅助映射",
      module: "电源",
      moduleId: null,
      nodePath: "/soc/regulator@1",
      compatible: "vendor,regulator",
      baselineValue: '"aux", <1 0>',
      description: "mixed 字符串 + cell，不猜测为 GPIO 或纯 cell。",
      valueShapeKind: "mixed",
      resolvedValueShape: { kind: "mixed" },
      unit: null,
      constraints: {},
      debuggable: true,
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-blocked-shape",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "boot_slot_uuid",
      displayName: "启动槽位 UUID",
      module: "系统",
      moduleId: null,
      nodePath: "/chosen",
      compatible: null,
      baselineValue: "uuid:9f2c…",
      description: null,
      valueShapeKind: "opaque",
      resolvedValueShape: null,
      unit: null,
      constraints: {},
      debuggable: false,
      blockReason: "unsupported-value-shape",
      sensitiveMatch: null
    },
    {
      bindingId: "mock-binding-blocked-baseline",
      projectId: MOCK_PROJECT_ID,
      propertyKey: "precharge_voltage",
      displayName: "预充电压",
      module: "充电管理",
      moduleId: null,
      nodePath: "/amba/i2c@FF120000/charger@6E",
      compatible: "vendor,charger123",
      baselineValue: null,
      description: null,
      valueShapeKind: "cells",
      resolvedValueShape: { kind: "cells", bits: 32, cellsPerGroup: 1, groups: 1 },
      unit: "mV",
      constraints: { cells: 1 },
      debuggable: false,
      blockReason: "no-baseline-value",
      sensitiveMatch: null
    }
  ];
}

function overlayAssignment(propertyKey: string, debugValue: string): string {
  const trimmed = debugValue.trim();
  if (trimmed === "/delete-property/" || trimmed === "false") {
    return `/delete-property/ ${propertyKey};`;
  }
  if (trimmed === "" || trimmed === "true") {
    return `${propertyKey};`;
  }
  return `${propertyKey} = ${trimmed};`;
}

function overlaySourceFor(targets: DtsReloadRun["targets"]): string {
  const fragments = targets
    .map(
      (target, index) =>
        `\tfragment@${index} {\n\t\ttarget-path = "${target.nodePath}";\n\t\t__overlay__ {\n\t\t\t${overlayAssignment(target.propertyKey, target.debugValue)}\n\t\t};\n\t};`
    )
    .join("\n");
  return `/dts-v1/;\n/plugin/;\n\n/ {\n${fragments}\n};\n`;
}

function pseudoSha256(seedText: string): string {
  let hash = 0;
  for (const char of seedText) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `mock${hash.toString(16).padStart(8, "0")}`.padEnd(16, "0");
}

/** Best-effort read-back projection for behavioural verification (e.g. `<7000>` → `7000`). */
function readBackValue(debugValue: string): string {
  const single = /^<\s*(-?\d+|0x[0-9a-fA-F]+)\s*>$/.exec(debugValue.trim());
  if (single) return String(Number(single[1]));
  return debugValue.trim().replace(/^"|"$/g, "");
}

type MockRunSeed = {
  id: string;
  status: DtsReloadRun["status"];
  purpose: DtsReloadRun["purpose"];
  createdAt: string;
  failureCode?: string | null;
  deviceBound?: boolean;
  restoresSourceRunId?: string | null;
  debugValue?: string;
};

function passedSteps(steps: string[]): DtsReloadRun["steps"] {
  return steps.map((step) => ({ step, outcome: "passed" as const }));
}

const PREFLIGHT_STEPS = ["compile-base", "compile-overlay", "dry-run-merge", "assert-effect"];
const DEPLOY_STEPS = [...PREFLIGHT_STEPS, "mount-target", "transfer-artifact", "trigger-reload"];

export function createMockDtsReloadRepository(): DtsReloadRepository {
  const candidates = createCandidateFixtures();
  const watchdog = candidates[0]!;
  const runs = new Map<string, DtsReloadRun>();
  const residueByDevice = new Map<string, DtsReloadResidue>();
  let runCounter = 0;
  let clockCounter = 0;
  let organisationConfiguration: OrganisationReloadConfiguration = {
    scope: "organisation",
    source: "seeded-default",
    destinationDirectory: "/data/local/tmp/wiseeff",
    destinationFilename: "debug-overlay.dtbo",
    triggerNodePath: "/sys/kernel/wiseeff/reload",
    triggerPayload: "1",
    kernelLogCommand: "dmesg",
    updatedAt: null,
    updatedByUserId: null
  };

  function nextTimestamp(): string {
    clockCounter += 1;
    return new Date(MOCK_CLOCK_BASE_MS + clockCounter * 1000).toISOString();
  }

  function candidateByBindingId(bindingId: string): DtsReloadCandidate | undefined {
    return candidates.find((candidate) => candidate.bindingId === bindingId);
  }

  function reloadSnapshotFor(run: DtsReloadRun): NonNullable<DtsReloadRun["reloadSnapshot"]> {
    const artifactSha = run.artifact?.sha256 ?? pseudoSha256(run.id);
    return {
      libraryBaselines: run.targets.map((target) => ({
        bindingId: target.bindingId,
        propertyKey: target.propertyKey,
        nodePath: target.nodePath,
        baselineValue: target.baselineValue
      })),
      artifactDigest: {
        sha256: artifactSha,
        onDeviceDigest: artifactSha,
        integrityCheck: "sha256"
      },
      kernelSignal: {
        command: organisationConfiguration.kernelLogCommand,
        captureStatus: "obtained",
        captureError: null,
        rawText: run.targets
          .map((target) => `kernel: ${target.propertyKey} applied\n`)
          .join("")
          .concat("kernel: overlay reload ok\n"),
        truncated: false,
        matchedByParameter: run.targets.map((target) => ({
          parameterName: target.propertyKey,
          bindingId: target.bindingId,
          lines: [`kernel: ${target.propertyKey} applied`]
        })),
        excerpt: null
      },
      behaviouralVerification: {
        outcomes: run.targets.map((target, index) =>
          index === 0
            ? {
                bindingId: target.bindingId,
                propertyKey: target.propertyKey,
                outcome: "verified" as const,
                debugNodeId: `mock-debug-node-${target.bindingId}`,
                nodePath: `/sys/class/wiseeff/${target.propertyKey}`,
                expectedValue: target.debugValue,
                readValue: readBackValue(target.debugValue),
                reason: null
              }
            : {
                bindingId: target.bindingId,
                propertyKey: target.propertyKey,
                outcome: "unbound" as const,
                debugNodeId: null,
                nodePath: null,
                expectedValue: target.debugValue,
                readValue: null,
                reason: "No readable debug-node binding for this parameter and protocol."
              }
        )
      }
    };
  }

  function seedRun(seed: MockRunSeed): void {
    const debugValue = seed.debugValue ?? "<7000>";
    const targets = [
      {
        bindingId: watchdog.bindingId,
        nodePath: watchdog.nodePath!,
        propertyKey: watchdog.propertyKey,
        baselineValue: watchdog.baselineValue,
        debugValue: seed.purpose === "restore-baseline" ? watchdog.baselineValue ?? "" : debugValue
      }
    ];
    const overlaySource = overlaySourceFor(targets);
    const blocked = seed.status === "blocked";
    const deployed = seed.status !== "validated" && !blocked;
    const run: DtsReloadRun = {
      id: seed.id,
      projectId: MOCK_PROJECT_ID,
      configRevisionId: null,
      status: seed.status,
      purpose: seed.purpose,
      restoresSourceRunId: seed.restoresSourceRunId ?? null,
      failureCode: seed.failureCode ?? null,
      targets,
      steps: blocked
        ? [
            { step: "compile-base", outcome: "failed", error: "dtc exited with status 1" },
            { step: "compile-overlay", outcome: "skipped" },
            { step: "dry-run-merge", outcome: "skipped" },
            { step: "assert-effect", outcome: "skipped" }
          ]
        : seed.status === "failed"
          ? [
              ...passedSteps([...PREFLIGHT_STEPS, "mount-target"]),
              { step: "transfer-artifact", outcome: "failed", error: "hdc file send timed out" },
              { step: "trigger-reload", outcome: "skipped" }
            ]
          : deployed
            ? passedSteps(DEPLOY_STEPS)
            : passedSteps(PREFLIGHT_STEPS),
      diagnostics: blocked
        ? [
            {
              stage: "compile-base",
              code: "base-compile-failed",
              message: "The compiled base device tree could not be read back for verification."
            }
          ]
        : [],
      toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
      overlaySource: blocked ? null : overlaySource,
      overlaySourceSha256: blocked ? null : pseudoSha256(overlaySource),
      artifact: blocked
        ? null
        : {
            fileName: `debug-overlay-${seed.id}.dtbo`,
            sha256: pseudoSha256(seed.id),
            sizeBytes: overlaySource.length
          },
      deviceId: seed.deviceBound === false ? null : MOCK_DTS_RELOAD_DEVICE_ID,
      bridgeId: seed.deviceBound === false ? null : MOCK_DTS_RELOAD_BRIDGE_ID,
      bridgeMachineLabel: seed.deviceBound === false ? null : "Mock Bridge",
      targetRef: seed.deviceBound === false ? null : MOCK_DTS_RELOAD_TARGET_REF,
      protocol: seed.deviceBound === false ? null : "hdc",
      integrityCheck: blocked ? null : "sha256",
      artifactRetentionExpired: false,
      createdAt: seed.createdAt,
      completedAt: seed.createdAt
    };
    if (seed.status === "verified" || seed.status === "unverifiable") {
      run.reloadSnapshot = reloadSnapshotFor(run);
    }
    runs.set(run.id, run);
  }

  // Seeded device story: the latest deploy left debug residue on the mock device (making the
  // restore-baseline flow demoable), earlier attempts show failure/blocked/restore shapes,
  // and enough older runs exist for the history list to paginate past its 10-item page.
  seedRun({
    id: SEED_RESIDUE_RUN_ID,
    status: "unverifiable",
    purpose: "ordinary",
    createdAt: "2026-08-10T12:00:00.000Z"
  });
  seedRun({
    id: "mock-reload-seed-02",
    status: "failed",
    purpose: "ordinary",
    failureCode: "transfer-failed",
    createdAt: "2026-08-10T11:00:00.000Z"
  });
  seedRun({
    id: "mock-reload-seed-03",
    status: "blocked",
    purpose: "ordinary",
    failureCode: "base-compile-failed",
    deviceBound: false,
    createdAt: "2026-08-10T10:00:00.000Z"
  });
  seedRun({
    id: "mock-reload-seed-04",
    status: "verified",
    purpose: "restore-baseline",
    restoresSourceRunId: "mock-reload-seed-05",
    createdAt: "2026-08-09T18:00:00.000Z"
  });
  for (let index = 5; index <= 12; index += 1) {
    seedRun({
      id: `mock-reload-seed-${String(index).padStart(2, "0")}`,
      status: index % 2 === 0 ? "verified" : "unverifiable",
      purpose: "ordinary",
      debugValue: `<${6000 + index * 100}>`,
      createdAt: `2026-08-0${9 - Math.floor(index / 10)}T${String(17 - index).padStart(2, "0")}:00:00.000Z`
    });
  }

  residueByDevice.set(MOCK_DTS_RELOAD_DEVICE_ID, {
    deviceId: MOCK_DTS_RELOAD_DEVICE_ID,
    projectId: MOCK_PROJECT_ID,
    sourceRunId: SEED_RESIDUE_RUN_ID,
    parameters: [
      {
        bindingId: watchdog.bindingId,
        propertyKey: watchdog.propertyKey,
        nodePath: watchdog.nodePath!,
        baselineValue: watchdog.baselineValue,
        debugValue: "<7000>"
      }
    ],
    recordedAt: "2026-08-10T12:00:00.000Z"
  });

  function requireRun(runId: string): DtsReloadRun {
    const run = runs.get(runId);
    if (!run) {
      throw mockApiError("NOT_FOUND", `未找到重载运行：${runId}`, { runId });
    }
    return run;
  }

  function assertSensitiveToken(
    matchedCandidates: DtsReloadCandidate[],
    confirmationToken: string | undefined
  ): void {
    const critical = matchedCandidates.some(
      (candidate) => candidate.sensitiveMatch?.riskTier === "critical"
    );
    if (critical && confirmationToken !== SENSITIVE_RELOAD_CONFIRMATION_TOKEN) {
      throw mockApiError("VALIDATION_FAILED", `critical 敏感参数需要确认令牌 ${SENSITIVE_RELOAD_CONFIRMATION_TOKEN}。`);
    }
  }

  return {
    /** Single fixture dataset for any project id, like the structured DTS mock. */
    async listCandidates(_projectId: string) {
      return { items: candidates.map((candidate) => ({ ...candidate })) };
    },

    async listRuns(input: ListDtsReloadRunsInput) {
      const limit = input.limit ?? 20;
      const filtered = [...runs.values()]
        .filter((run) => (input.deviceId ? run.deviceId === input.deviceId : true))
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)
        );
      // Keyset cursor (createdAt|id): stays stable when new runs are created between pages,
      // mirroring the server's cursor semantics instead of a drifting offset.
      const cursorIndex = input.cursor
        ? filtered.findIndex((run) => `${run.createdAt}|${run.id}` === input.cursor)
        : -1;
      const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
      const page = filtered.slice(start, start + limit);
      const lastOfPage = page[page.length - 1];
      const items: DtsReloadRunListItem[] = page.map((run) => ({
        id: run.id,
        projectId: run.projectId,
        deviceId: run.deviceId ?? null,
        status: run.status,
        purpose: run.purpose,
        failureCode: run.failureCode,
        targetCount: run.targets.length,
        propertyKeys: run.targets.map((target) => target.propertyKey),
        artifact: run.artifact ? { ...run.artifact } : null,
        integrityCheck: run.integrityCheck ?? null,
        createdAt: run.createdAt,
        completedAt: run.completedAt
      }));
      return {
        items,
        nextCursor:
          lastOfPage && start + page.length < filtered.length
            ? `${lastOfPage.createdAt}|${lastOfPage.id}`
            : null
      };
    },

    async startRun(input: StartDtsReloadRunInput) {
      if (input.targets.length === 0) {
        throw mockApiError("VALIDATION_FAILED", "至少需要一个参数目标。");
      }
      const matched = input.targets.map((target) => {
        const candidate = candidateByBindingId(target.bindingId);
        if (!candidate || !candidate.debuggable || !candidate.nodePath) {
          throw mockApiError("INTERNAL_ERROR", `参数不可调试：${target.bindingId}`, { bindingId: target.bindingId });
        }
        return candidate;
      });
      assertSensitiveToken(matched, input.confirmationToken);
      runCounter += 1;
      const targets = input.targets.map((target, index) => ({
        bindingId: target.bindingId,
        nodePath: matched[index]!.nodePath!,
        propertyKey: matched[index]!.propertyKey,
        baselineValue: matched[index]!.baselineValue,
        debugValue: target.debugValue
      }));
      const overlaySource = overlaySourceFor(targets);
      const createdAt = nextTimestamp();
      const run: DtsReloadRun = {
        id: `mock-reload-run-${runCounter}`,
        projectId: input.projectId,
        configRevisionId: null,
        status: "validated",
        purpose: "ordinary",
        restoresSourceRunId: null,
        failureCode: null,
        targets,
        steps: passedSteps(PREFLIGHT_STEPS),
        diagnostics: [],
        toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
        overlaySource,
        overlaySourceSha256: pseudoSha256(overlaySource),
        artifact: {
          fileName: `debug-overlay-mock-reload-run-${runCounter}.dtbo`,
          sha256: pseudoSha256(`mock-reload-run-${runCounter}`),
          sizeBytes: overlaySource.length
        },
        artifactRetentionExpired: false,
        createdAt,
        completedAt: null
      };
      runs.set(run.id, run);
      return { ...run };
    },

    async restoreBaseline(input: RestoreDtsReloadBaselineInput) {
      const residue = residueByDevice.get(input.deviceId);
      if (!residue) {
        throw mockApiError("INTERNAL_ERROR", "该设备没有可恢复的调试残留记录。");
      }
      const matched = residue.parameters
        .map((parameter) => candidateByBindingId(parameter.bindingId))
        .filter((candidate): candidate is DtsReloadCandidate => Boolean(candidate));
      assertSensitiveToken(matched, input.confirmationToken);
      runCounter += 1;
      const targets = residue.parameters.map((parameter) => ({
        bindingId: parameter.bindingId,
        nodePath: parameter.nodePath,
        propertyKey: parameter.propertyKey,
        baselineValue: parameter.baselineValue,
        debugValue: parameter.baselineValue ?? ""
      }));
      const overlaySource = overlaySourceFor(targets);
      const createdAt = nextTimestamp();
      const run: DtsReloadRun = {
        id: `mock-reload-run-${runCounter}`,
        projectId: input.projectId,
        configRevisionId: null,
        status: "validated",
        purpose: "restore-baseline",
        restoresSourceRunId: residue.sourceRunId,
        failureCode: null,
        targets,
        steps: passedSteps(PREFLIGHT_STEPS),
        diagnostics: [],
        toolVersions: { dtc: "1.7.0", fdtoverlay: "1.7.0" },
        overlaySource,
        overlaySourceSha256: pseudoSha256(overlaySource),
        artifact: {
          fileName: `debug-overlay-mock-reload-run-${runCounter}.dtbo`,
          sha256: pseudoSha256(`mock-reload-run-${runCounter}`),
          sizeBytes: overlaySource.length
        },
        artifactRetentionExpired: false,
        createdAt,
        completedAt: null
      };
      runs.set(run.id, run);
      return { ...run };
    },

    async getResidue(deviceId: string) {
      const residue = residueByDevice.get(deviceId);
      return residue ? { ...residue, parameters: residue.parameters.map((p) => ({ ...p })) } : null;
    },

    async deployRun(input: DeployDtsReloadRunInput) {
      if (!input.confirmationTokens.includes(DTS_RELOAD_CONFIRMATION_TOKEN)) {
        throw mockApiError("VALIDATION_FAILED", `设备部署需要确认令牌 ${DTS_RELOAD_CONFIRMATION_TOKEN}。`);
      }
      const run = requireRun(input.runId);
      if (run.status !== "validated" && run.status !== "failed") {
        throw mockApiError("INTERNAL_ERROR", "该运行不可部署：仅预检通过或部署失败的运行可以（重试）部署。");
      }
      const deployed: DtsReloadRun = {
        ...run,
        status: "verified",
        steps: passedSteps(DEPLOY_STEPS),
        deviceId: input.deviceId,
        bridgeId: input.bridgeId,
        bridgeMachineLabel: "Mock Bridge",
        targetRef: input.targetRef,
        protocol: input.protocol,
        integrityCheck: "sha256",
        completedAt: nextTimestamp()
      };
      deployed.reloadSnapshot = reloadSnapshotFor(deployed);
      runs.set(deployed.id, deployed);
      if (deployed.purpose === "restore-baseline") {
        residueByDevice.delete(input.deviceId);
      } else {
        residueByDevice.set(input.deviceId, {
          deviceId: input.deviceId,
          projectId: deployed.projectId,
          sourceRunId: deployed.id,
          parameters: deployed.targets.map((target) => ({
            bindingId: target.bindingId,
            propertyKey: target.propertyKey,
            nodePath: target.nodePath,
            baselineValue: target.baselineValue,
            debugValue: target.debugValue
          })),
          recordedAt: deployed.completedAt ?? nextTimestamp()
        });
      }
      return { ...deployed };
    },

    async getRun(runId: string) {
      return { ...requireRun(runId) };
    },

    async downloadArtifact(runId: string) {
      const run = requireRun(runId);
      if (!run.artifact) {
        throw mockApiError("INTERNAL_ERROR", "该运行没有可下载的编译产物。");
      }
      if (run.artifactRetentionExpired) {
        throw mockApiError("INTERNAL_ERROR", "编译产物已超过保留期。");
      }
      return new Blob([run.overlaySource ?? run.artifact.fileName], {
        type: "application/octet-stream"
      });
    },

    async getReloadConfiguration() {
      return { organisation: { ...organisationConfiguration } };
    },

    async updateOrganisationReloadConfiguration(contract: ReloadConfigurationContract) {
      organisationConfiguration = {
        ...organisationConfiguration,
        ...contract,
        source: "organisation",
        updatedAt: nextTimestamp(),
        updatedByUserId: "mock-user-admin"
      };
      return { ...organisationConfiguration };
    }
  };
}
