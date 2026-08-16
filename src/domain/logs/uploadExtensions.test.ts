import { describe, expect, it } from "vitest";

import {
  isSupportedLogUploadFileName,
  isSupportedTextLogFileName,
  mockLogUploadAccept,
  supportedTextLogExtensions
} from "./uploadExtensions";

describe("log upload extensions", () => {
  it("accepts the same text set the server allowlists, including .json and .csv", () => {
    expect([...supportedTextLogExtensions]).toEqual(["log", "txt", "csv", "json"]);
    expect(mockLogUploadAccept).toBe(".log,.txt,.csv,.json");

    for (const fileName of ["events.log", "events.txt", "events.csv", "events.json"]) {
      expect(isSupportedTextLogFileName(fileName)).toBe(true);
      expect(isSupportedLogUploadFileName(fileName, false)).toBe(true);
    }
  });

  it("keeps archives API-only so mock does not pretend to unpack them", () => {
    expect(isSupportedLogUploadFileName("events.log.gz", false)).toBe(false);
    expect(isSupportedLogUploadFileName("events.zip", false)).toBe(false);
    expect(isSupportedLogUploadFileName("events.log.gz", true)).toBe(true);
    expect(isSupportedLogUploadFileName("events.zip", true)).toBe(true);
    expect(isSupportedLogUploadFileName("events.bin", true)).toBe(false);
    expect(isSupportedTextLogFileName("events")).toBe(false);
  });
});
