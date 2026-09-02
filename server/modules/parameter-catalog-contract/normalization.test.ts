import { describe, expect, it } from "vitest";

import {
  canonicalIdentityFailureReasons,
  parseCanonicalCompatibleSelector,
  parseCanonicalNodeName,
  parseCanonicalPropertyKey,
  type CanonicalIdentityFailureReason,
  type DriverCompatible,
  type NormalizedNodeTypeName,
  type PropertyKey
} from "./index";

const acceptCompatible = (input: unknown): DriverCompatible => {
  const result = parseCanonicalCompatibleSelector(input);
  if (!result.ok) {
    throw new Error(`Expected compatible selector, received ${result.error}`);
  }
  return result.value;
};

const acceptPropertyKey = (input: unknown): PropertyKey => {
  const result = parseCanonicalPropertyKey(input);
  if (!result.ok) {
    throw new Error(`Expected property key, received ${result.error}`);
  }
  return result.value;
};

const rejectPropertyKey = (input: unknown): CanonicalIdentityFailureReason => {
  const result = parseCanonicalPropertyKey(input);
  if (result.ok) {
    throw new Error(`Expected rejection, received ${result.value}`);
  }
  return result.error;
};

const acceptNodeName = (input: unknown): NormalizedNodeTypeName => {
  const result = parseCanonicalNodeName(input);
  if (!result.ok) {
    throw new Error(`Expected node name, received ${result.error}`);
  }
  return result.value;
};

const rejectNodeName = (input: unknown): CanonicalIdentityFailureReason => {
  const result = parseCanonicalNodeName(input);
  if (result.ok) {
    throw new Error(`Expected rejection, received ${result.value}`);
  }
  return result.error;
};

const rejectCompatible = (input: unknown): CanonicalIdentityFailureReason => {
  const result = parseCanonicalCompatibleSelector(input);
  if (result.ok) {
    throw new Error(`Expected rejection, received ${result.value}`);
  }
  return result.error;
};

describe("canonical parameter identity parsing", () => {
  it("freezes the exact closed failure reason registry", () => {
    expect(canonicalIdentityFailureReasons).toEqual([
      "not-string",
      "empty",
      "control-character",
      "non-ascii",
      "surrounding-whitespace",
      "whitespace-forbidden",
      "quoted-source-token",
      "wildcard-forbidden",
      "unit-address-present",
      "length-out-of-range",
      "invalid-syntax",
      "structural-property"
    ]);
    expect(Object.isFrozen(canonicalIdentityFailureReasons)).toBe(true);
  });

  it("accepts compatible selectors without changing their bytes", () => {
    expect(acceptCompatible("vendor,driver")).toBe("vendor,driver");
    expect(acceptCompatible("simple")).toBe("simple");
    expect(acceptCompatible("vendor+tag,driver.rev/1")).toBe(
      "vendor+tag,driver.rev/1"
    );
  });

  it("rejects compatible selectors with deterministic closed reasons", () => {
    expect(rejectCompatible(42)).toBe("not-string");
    expect(rejectCompatible("")).toBe("empty");
    expect(rejectCompatible("vendor,\0driver")).toBe("control-character");
    expect(rejectCompatible("véndor,driver")).toBe("non-ascii");
    expect(rejectCompatible(" vendor,driver")).toBe("surrounding-whitespace");
    expect(rejectCompatible("vendor, driver")).toBe("whitespace-forbidden");
    expect(rejectCompatible('"vendor,driver"')).toBe("quoted-source-token");
    expect(rejectCompatible("vendor,*")).toBe("wildcard-forbidden");
    expect(rejectCompatible("vendor,driver,extra")).toBe("invalid-syntax");
  });

  it("classifies common failures before compatible-specific failures", () => {
    expect(rejectCompatible(" vendor,*")).toBe("surrounding-whitespace");
    expect(rejectCompatible('"vendor,*"')).toBe("quoted-source-token");
  });

  it("accepts node names byte-for-byte and rejects invalid identities", () => {
    expect(acceptNodeName("/")).toBe("/");
    expect(acceptNodeName("charging_core")).toBe("charging_core");
    expect(acceptNodeName("usb-controller")).toBe("usb-controller");

    expect(rejectNodeName("node@1")).toBe("unit-address-present");
    expect(rejectNodeName("a".repeat(32))).toBe("length-out-of-range");
    expect(rejectNodeName("charging core")).toBe("whitespace-forbidden");
    expect(rejectNodeName("'node'")).toBe("quoted-source-token");
    expect(rejectNodeName("1node")).toBe("invalid-syntax");
  });

  it("classifies common node failures before unit-address and length checks", () => {
    expect(rejectNodeName(" node@1")).toBe("surrounding-whitespace");
    expect(rejectNodeName("'node@1'")).toBe("quoted-source-token");
  });

  it("accepts property keys without normalization", () => {
    expect(acceptPropertyKey("iin_max")).toBe("iin_max");
    expect(acceptPropertyKey("init_para")).toBe("init_para");
    expect(acceptPropertyKey("vendor,limit?")).toBe("vendor,limit?");
  });

  it("rejects the complete case-insensitive structural property set", () => {
    for (const property of [
      "compatible",
      "DEVICE_TYPE",
      "gpio-controller",
      "INTERRUPT-CONTROLLER",
      "linux,phandle",
      "PHANDLE",
      "ranges",
      "REG",
      "STATUS",
      "#address-cells",
      "#GPIO-CELLS",
      "#interrupt-cells",
      "#size-cells",
      "#custom"
    ]) {
      expect(rejectPropertyKey(property)).toBe("structural-property");
    }
  });

  it("applies property length, structure, and syntax checks in order", () => {
    expect(rejectPropertyKey("a".repeat(32))).toBe("length-out-of-range");
    expect(rejectPropertyKey("#" + "a".repeat(31))).toBe(
      "length-out-of-range"
    );
    expect(rejectPropertyKey("#bad/property")).toBe("structural-property");
    expect(rejectPropertyKey("bad/property")).toBe("invalid-syntax");
    expect(rejectPropertyKey("bad\tkey")).toBe("control-character");
    expect(rejectPropertyKey("'STATUS'")).toBe("quoted-source-token");
  });
});
