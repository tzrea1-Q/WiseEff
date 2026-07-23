import { describe, expect, it } from "vitest";

import type { ParameterDraftDto } from "@/application/ports/ParameterRepository";
import type { ParameterRecord } from "./types";

import { buildDraftSubmissionRounds } from "./buildDraftSubmissionRounds";

const gpioParameter: ParameterRecord = {
  id: "aurora-dts-source-sc8562-6e-gpio-int-899a3e1c04",
  name: "gpio_int",
  description: "",
  explanation: "",
  configFormat: "DTS",
  module: "Charge Pump IC",
  projectId: "aurora",
  currentValue: "<&gpio13 28 0>",
  recommendedValue: "",
  range: "",
  unit: "phandle",
  risk: "High",
  valueKind: "complex",
  projectParameterBindingId: "09bf2b18-054a-4000-b19f-5948906f08d2",
  updatedAt: "just now",
  updatedAtTs: "2026-07-22T12:00:00.000Z",
  history: []
};

describe("buildDraftSubmissionRounds", () => {
  it("uses draft write-lock baseline as currentValue when catalog lookup would miss binding ids", () => {
    const draft: ParameterDraftDto = {
      id: "e6cf6d01-947d-4a47-9fbc-0cfa8f42024c",
      projectId: "aurora",
      parameterId: "09bf2b18-054a-4000-b19f-5948906f08d2",
      projectParameterBindingId: "09bf2b18-054a-4000-b19f-5948906f08d2",
      name: "gpio_int",
      module: "Charge Pump IC",
      currentValue: "<&gpio13 28 27>",
      targetValue: "<&gpio13 27 27>",
      reason: "测试",
      updatedAt: "2026-07-22T12:13:37.997Z"
    };

    const [round] = buildDraftSubmissionRounds(
      [draft],
      [gpioParameter],
      [{ id: "aurora", name: "Aurora 量产平台", code: "AURORA" }],
      "Xu Yun"
    );

    expect(round.status).toBe("已暂存");
    expect(round.items[0]).toMatchObject({
      name: "gpio_int",
      module: "Charge Pump IC",
      currentValue: "<&gpio13 28 27>",
      targetValue: "<&gpio13 27 27>"
    });
    expect(round.items[0].name).not.toBe(draft.parameterId);
    expect(round.items[0].currentValue).not.toBe("");
  });

  it("resolves catalog metadata via projectParameterBindingId when parameterId is a binding id", () => {
    const draft: ParameterDraftDto = {
      id: "draft-1",
      projectId: "aurora",
      parameterId: "09bf2b18-054a-4000-b19f-5948906f08d2",
      projectParameterBindingId: "09bf2b18-054a-4000-b19f-5948906f08d2",
      targetValue: "<&gpio13 27 27>",
      reason: "测试",
      updatedAt: "2026-07-22T12:13:37.997Z"
    };

    const [round] = buildDraftSubmissionRounds(
      [draft],
      [gpioParameter],
      [{ id: "aurora", name: "Aurora 量产平台", code: "AURORA" }],
      "Xu Yun"
    );

    expect(round.items[0].name).toBe("gpio_int");
    expect(round.items[0].module).toBe("Charge Pump IC");
    // Without draft.currentValue, falls back to catalog (may be stale tip/PPV).
    expect(round.items[0].currentValue).toBe("<&gpio13 28 0>");
  });
});
