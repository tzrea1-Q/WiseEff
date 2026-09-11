import { describe, expect, it } from "vitest";

import { ApiError } from "../../shared/http/errors";

import {
  dtsValueToPayload,
  importTextToDtsValue,
  matchCatalogImportRow,
  parseConfigSetSourceRef,
  payloadToBindingView,
  rawTextToPayload
} from "./catalogProjectValueSync";

const candidate = (
  overrides: Partial<{
    id: string;
    name: string;
    projectParameterValueId: string;
  }> = {}
) => ({
  id: "pdef_acme_power_iin_max",
  name: "iin_max",
  description: "",
  explanation: "",
  configFormat: "DTS",
  module: "",
  range: "",
  unit: "",
  risk: "Low" as const,
  projectParameterValueId: "pbind-a",
  currentValue: "1000",
  ...overrides
});

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

describe("catalog import identity matching", () => {
  const bindingA = candidate({ projectParameterValueId: "pbind-a" });
  const bindingB = candidate({ projectParameterValueId: "pbind-b" });

  it("uses a precise binding identity even when another same-name row is listed first", () => {
    expect(matchCatalogImportRow({ id: "pbind-a", name: "iin_max" }, [bindingB, bindingA])).toEqual(bindingA);
    expect(matchCatalogImportRow({ id: "pbind-b", name: "iin_max" }, [bindingA, bindingB])).toEqual(bindingB);
  });

  it("refuses a unique-looking definition identity that maps to two project values", () => {
    expect(() => matchCatalogImportRow({ id: "pdef_acme_power_iin_max", name: "iin_max" }, [bindingA, bindingB])).toThrow(
      ApiError
    );
    try {
      matchCatalogImportRow({ id: "pdef_acme_power_iin_max", name: "iin_max" }, [bindingA, bindingB]);
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFLICT" });
    }
  });

  it("refuses a name-only import when more than one published value shares the name", () => {
    expect(() => matchCatalogImportRow({ name: "iin_max" }, [bindingB, bindingA])).toThrow(ApiError);
    try {
      matchCatalogImportRow({ name: "iin_max" }, [bindingA, bindingB]);
    } catch (error) {
      expect(error).toMatchObject({ code: "CONFLICT" });
    }
  });

  it("does not fall back to a same-name value when the precise identity is missing", () => {
    expect(() => matchCatalogImportRow({ id: "pbind-missing", name: "iin_max" }, [bindingA])).toThrow(ApiError);
    try {
      matchCatalogImportRow({ id: "pbind-missing", name: "iin_max" }, [bindingA]);
    } catch (error) {
      expect(error).toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("refuses a precise identity when the candidate set is empty", () => {
    expect(() => matchCatalogImportRow({ id: "pbind-from-project-b", name: "iin_max" }, [])).toThrow(ApiError);
    expect(matchCatalogImportRow({ name: "iin_max" }, [])).toBeNull();
  });

  it("matches a unique name when no precise identity is supplied", () => {
    expect(matchCatalogImportRow({ name: "iin_max" }, [bindingA])).toEqual(bindingA);
  });
});

describe("config-set source refs", () => {
  it("parses a real config-set source and rejects placeholders", () => {
    expect(parseConfigSetSourceRef("config-set:dcs-1")).toBe("dcs-1");
    expect(parseConfigSetSourceRef("canonical-binding-identity")).toBeNull();
    expect(parseConfigSetSourceRef("config-set:")).toBeNull();
  });
});
