import { describe, expect, it } from "vitest";
import { nodeRowSubtitle } from "./nodeRowSubtitle";

describe("nodeRowSubtitle", () => {
  it("prefers legacy parameter keys when they differ from the row id", () => {
    expect(
      nodeRowSubtitle({
        id: "dbg-charge-input-current",
        key: "charger.input_current_limit_ma",
        description: "限制充电器输入端的最大电流。"
      })
    ).toBe("charger.input_current_limit_ma");
  });

  it("shows catalog description when the runtime key is the node id", () => {
    expect(
      nodeRowSubtitle({
        id: "1c6056b4-fd97-494a-a260-d061d2920280",
        key: "1c6056b4-fd97-494a-a260-d061d2920280",
        description: "Q值简述"
      })
    ).toBe("Q值简述");
  });
});
