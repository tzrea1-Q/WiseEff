import { describe, expect, it } from "vitest";

import { dtsValueToPayload, importTextToDtsValue, payloadToBindingView, rawTextToPayload } from "./catalogProjectValueSync";

describe("catalog project value payload mapping", () => {
  it("maps a DTS integer cell to a number payload and back", () => {
    const payload = rawTextToPayload("iin_max", "<1000>");
    expect(payload).toEqual({ kind: "number", value: 1000 });
    expect(payloadToBindingView(payload).rawValue).toBe("<1000>");
  });

  it("maps a DTS string to a string payload", () => {
    expect(dtsValueToPayload({ kind: "strings", values: ["acme"] })).toEqual({
      kind: "string",
      value: "acme",
    });
  });

  it("maps a bare imported number to a DTS cell", () => {
    expect(importTextToDtsValue("iin_max", "3000")).toEqual({
      kind: "cells",
      bits: 32,
      groups: [[{ kind: "integer", raw: "3000", value: "3000" }]],
    });
  });
});
