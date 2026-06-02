import { describe, expect, it } from "vitest";
import { classifyBrowserIssue } from "../e2e/acceptance/helpers/browserDiagnostics";

describe("browser acceptance diagnostics", () => {
  it("fails unexpected WiseEff API 401 responses", () => {
    expect(classifyBrowserIssue({ type: "response", url: "http://127.0.0.1:8787/api/v1/me", status: 401 })).toEqual({
      action: "fail",
      reason: "Unexpected API response 401 for /api/v1/me"
    });
  });

  it("allows explicit negative-path API assertions", () => {
    expect(
      classifyBrowserIssue({
        type: "response",
        url: "http://127.0.0.1:8787/api/v1/me",
        status: 401,
        allowFailure: true
      })
    ).toEqual({ action: "ignore" });
  });

  it("allows expected browser API failures by method, path, and status", () => {
    expect(
      classifyBrowserIssue(
        {
          type: "response",
          url: "http://127.0.0.1:8787/api/v1/parameter-submission-rounds",
          method: "POST",
          status: 400
        },
        [{ method: "POST", path: "/api/v1/parameter-submission-rounds", status: 400 }]
      )
    ).toEqual({ action: "ignore" });
  });

  it("ignores WiseEff requests aborted by normal page navigation", () => {
    expect(
      classifyBrowserIssue({
        type: "requestfailed",
        url: "http://127.0.0.1:8787/api/v1/parameters?projectId=aurora",
        failureText: "net::ERR_ABORTED"
      })
    ).toEqual({ action: "ignore" });
  });

  it("still fails when an expected browser API failure rule does not match", () => {
    expect(
      classifyBrowserIssue(
        {
          type: "response",
          url: "http://127.0.0.1:8787/api/v1/parameter-submission-rounds",
          method: "POST",
          status: 500
        },
        [{ method: "POST", path: "/api/v1/parameter-submission-rounds", status: 400 }]
      )
    ).toEqual({
      action: "fail",
      reason: "Unexpected API response 500 for /api/v1/parameter-submission-rounds"
    });
  });

  it("fails page errors and console errors", () => {
    expect(classifyBrowserIssue({ type: "pageerror", message: "TypeError: failed" }).action).toBe("fail");
    expect(classifyBrowserIssue({ type: "console", message: "Failed to load resource", level: "error" }).action).toBe(
      "fail"
    );
  });

  it("ignores non-critical external responses", () => {
    expect(classifyBrowserIssue({ type: "response", url: "https://example.com/asset.png", status: 404 })).toEqual({
      action: "ignore"
    });
  });
});
