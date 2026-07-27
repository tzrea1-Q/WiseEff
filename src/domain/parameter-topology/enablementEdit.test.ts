import { describe, expect, it } from "vitest";

import {
  measureStatusSpelling,
  resolveEnablementWrite,
  type EnablementEditTarget
} from "./enablementEdit";

describe("measureStatusSpelling", () => {
  it("picks the majority spelling from raw status values", () => {
    expect(measureStatusSpelling(['"ok"', '"okay"', '"ok"', '"disabled"'])).toBe("ok");
    expect(measureStatusSpelling(['"okay"', '"okay"', '"ok"'])).toBe("okay");
  });

  it("falls back to ok on empty or tied samples", () => {
    expect(measureStatusSpelling([])).toBe("ok");
    expect(measureStatusSpelling(['"ok"', '"okay"'])).toBe("ok");
  });
});

describe("resolveEnablementWrite", () => {
  it("preserves existing ok/okay spelling when forcing enabled", () => {
    expect(
      resolveEnablementWrite({
        target: "force-enabled",
        currentRaw: '"okay"',
        projectSpelling: "ok"
      })
    ).toEqual({ action: "set", rawText: '"okay"' });
  });

  it("uses project spelling when creating a new enabled status", () => {
    expect(
      resolveEnablementWrite({
        target: "force-enabled",
        currentRaw: null,
        projectSpelling: "ok"
      })
    ).toEqual({ action: "set", rawText: '"ok"' });
  });

  it("writes disabled and deletes for unstated", () => {
    expect(
      resolveEnablementWrite({
        target: "force-disabled",
        currentRaw: '"ok"',
        projectSpelling: "ok"
      })
    ).toEqual({ action: "set", rawText: '"disabled"' });
    expect(
      resolveEnablementWrite({
        target: "unstated",
        currentRaw: '"disabled"',
        projectSpelling: "ok"
      })
    ).toEqual({ action: "delete", rawText: null });
  });

  it("refuses nonstandard overwrite without acknowledgement", () => {
    expect(() =>
      resolveEnablementWrite({
        target: "force-disabled" as EnablementEditTarget,
        currentRaw: '"reserved"',
        projectSpelling: "ok",
        acknowledgeNonstandard: false
      })
    ).toThrow(/nonstandard/i);
  });
});
