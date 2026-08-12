import { describe, expect, it } from "vitest";

import {
  buildNotObtainedKernelSignal,
  buildObtainedKernelSignal,
  kernelLogMatchKeywords,
  matchKernelLogLinesByParameter,
  parseKernelSignal
} from "./kernelSignal";

describe("kernelSignal filtering", () => {
  const targets = [
    {
      bindingId: "b1",
      nodePath: "/n",
      propertyKey: "watchdog_time",
      baselineValue: "<1>",
      debugValue: "<2>"
    },
    {
      bindingId: "b2",
      nodePath: "/n2",
      propertyKey: "charge_current",
      baselineValue: "<3>",
      debugValue: "<4>"
    }
  ];

  it("groups matched lines by propertyKey without requiring whole-line equality", () => {
    const raw = [
      "kernel: watchdog_time set to 7000",
      "kernel: unrelated noise",
      "kernel: charge_current applied",
      "kernel: watchdog_time confirm"
    ].join("\n");

    expect(matchKernelLogLinesByParameter(raw, targets)).toEqual([
      {
        parameterName: "watchdog_time",
        bindingId: "b1",
        lines: ["kernel: watchdog_time set to 7000", "kernel: watchdog_time confirm"]
      },
      {
        parameterName: "charge_current",
        bindingId: "b2",
        lines: ["kernel: charge_current applied"]
      }
    ]);
  });

  it("matches case-insensitively, like the grep -i engineers run by hand", () => {
    const raw = [
      "kernel: Watchdog_Time set to 7000",
      "kernel: CHARGE_CURRENT applied",
      "kernel: unrelated noise"
    ].join("\n");

    const [watchdog, charge] = matchKernelLogLinesByParameter(raw, targets);
    expect(watchdog?.lines).toEqual(["kernel: Watchdog_Time set to 7000"]);
    expect(charge?.lines).toEqual(["kernel: CHARGE_CURRENT applied"]);
  });

  it("matches driver lines that print the node name instead of the property key", () => {
    const wirelessTarget = {
      bindingId: "b3",
      nodePath: "/soc/wireless@0",
      propertyKey: "tx-power-max",
      baselineValue: "<1>",
      debugValue: "<2>"
    };
    const raw = [
      "Wireless: overlay reload ok",
      "wireless@0: probe complete",
      "kernel: unrelated noise",
      "kernel: tx-power-max applied"
    ].join("\n");

    const [group] = matchKernelLogLinesByParameter(raw, [wirelessTarget]);
    expect(group?.lines).toEqual([
      "Wireless: overlay reload ok",
      "wireless@0: probe complete",
      "kernel: tx-power-max applied"
    ]);
  });

  it("derives keywords but drops short node segments that would match noise", () => {
    expect(kernelLogMatchKeywords({ propertyKey: "tx-power-max", nodePath: "/soc/wireless@0" })).toEqual([
      "tx-power-max",
      "wireless@0",
      "wireless"
    ]);
    expect(kernelLogMatchKeywords({ propertyKey: "reg", nodePath: "/a" })).toEqual(["reg"]);
    expect(kernelLogMatchKeywords({ propertyKey: "", nodePath: "" })).toEqual([]);
  });

  it("keeps obtained captures with zero matches distinct from not-obtained failures", () => {
    const obtained = buildObtainedKernelSignal({
      command: "dmesg",
      rawText: "kernel: boot complete\n",
      truncated: false,
      targets
    });
    const failed = buildNotObtainedKernelSignal({
      command: "dmesg",
      captureError: "HDC exited with 1."
    });

    expect(obtained.captureStatus).toBe("obtained");
    expect(obtained.rawText).toContain("boot complete");
    expect(obtained.matchedByParameter.every((group) => group.lines.length === 0)).toBe(true);

    expect(failed.captureStatus).toBe("not-obtained");
    expect(failed.rawText).toBeNull();
    expect(failed.captureError).toBeTruthy();
  });

  it("parses legacy { command, excerpt } stubs without dropping the excerpt", () => {
    const parsed = parseKernelSignal({ command: "dmesg", excerpt: "overlay applied" });
    expect(parsed).toMatchObject({
      command: "dmesg",
      captureStatus: "obtained",
      rawText: "overlay applied",
      excerpt: "overlay applied"
    });
  });
});
