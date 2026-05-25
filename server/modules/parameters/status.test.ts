import { describe, expect, it } from "vitest";
import { getNextParameterStatus, parameterStatusLabels } from "./status";

describe("parameter status helpers", () => {
  it("labels review and terminal statuses", () => {
    expect(parameterStatusLabels).toMatchObject({
      submitted: "待审阅",
      hardware_review: "硬件Committer检视",
      software_review: "软件Committer检视",
      software_merge: "软件User合入",
      merged: "已合入",
      rejected: "已打回",
      withdrawn: "已撤回",
      stashed: "已暂存"
    });
  });

  it("advances statuses through review and merge", () => {
    expect(getNextParameterStatus("submitted")).toBe("software_review");
    expect(getNextParameterStatus("hardware_review")).toBe("software_review");
    expect(getNextParameterStatus("software_review")).toBe("software_merge");
    expect(getNextParameterStatus("software_merge")).toBe("merged");
    expect(getNextParameterStatus("rejected")).toBe("rejected");
  });
});
