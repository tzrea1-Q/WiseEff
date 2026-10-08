import { describe, expect, it } from "vitest";

import { createDeterministicPerceptionModel } from "./deterministicModel";

describe("deterministic model parameter-change routing", () => {
  it("routes `set <canonical binding id> to <value>` to action.submitParameterChange", async () => {
    // Canonical Binding ids are `pbind_<hex>`; the underscore must be part of the id.
    const bindingId = "pbind_47ba17855fa4d469ed156c548484b6dbd8536e92128e00d60b39277e549875d5";
    const model = createDeterministicPerceptionModel();
    const response = await model.invoke([
      { role: "system", content: "system prompt" },
      { role: "user", content: `set ${bindingId} to <5526>\nCurrent page: parameters` }
    ]);

    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        name: "action.submitParameterChange",
        args: expect.objectContaining({ parameterId: bindingId, targetValue: "<5526>" })
      })
    ]);
  });
});
