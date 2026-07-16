import type { Page, TestInfo, TestType } from "playwright/test";

type BrowserIssue =
  | { type: "pageerror"; message: string }
  | { type: "console"; level: string; message: string }
  | { type: "requestfailed"; url: string; failureText?: string }
  | { type: "response"; url: string; method?: string; status: number; allowFailure?: boolean };

export type ExpectedApiFailure = {
  method: string;
  path: string;
  status: number;
};

export type BrowserDiagnosticsOptions = {
  expectedApiFailures?: ExpectedApiFailure[];
};

export function classifyBrowserIssue(
  issue: BrowserIssue,
  expectedApiFailures: ExpectedApiFailure[] = []
): { action: "fail" | "ignore"; reason?: string } {
  if ("allowFailure" in issue && issue.allowFailure) {
    return { action: "ignore" };
  }

  if (issue.type === "pageerror") {
    return { action: "fail", reason: `Unexpected page error: ${issue.message}` };
  }

  if (issue.type === "console" && issue.level === "error") {
    // Chromium emits this for every non-2xx fetch; API status is asserted via the response listener.
    if (/Failed to load resource: the server responded with a status of \d+/i.test(issue.message)) {
      return { action: "ignore" };
    }
    return { action: "fail", reason: `Unexpected console error: ${issue.message}` };
  }

  if (issue.type === "requestfailed" && isNavigationAbort(issue.failureText)) {
    return { action: "ignore" };
  }

  if (issue.type === "requestfailed" && isWiseEffUrl(issue.url)) {
    return {
      action: "fail",
      reason: `Unexpected request failure for ${pathOf(issue.url)}: ${issue.failureText ?? "unknown failure"}`
    };
  }

  if (issue.type === "response" && issue.status >= 400 && isCriticalApiUrl(issue.url)) {
    if (isExpectedApiFailure(issue, expectedApiFailures)) {
      return { action: "ignore" };
    }
    return { action: "fail", reason: `Unexpected API response ${issue.status} for ${pathOf(issue.url)}` };
  }

  return { action: "ignore" };
}

export function installBrowserDiagnostics(page: Page, testInfo: TestInfo, options: BrowserDiagnosticsOptions = {}) {
  const failures: string[] = [];
  const record = (issue: BrowserIssue) => {
    const result = classifyBrowserIssue(issue, options.expectedApiFailures ?? []);
    if (result.action === "fail" && result.reason) {
      failures.push(result.reason);
    }
  };

  page.on("pageerror", (error) => record({ type: "pageerror", message: error.message }));
  page.on("console", (message) => record({ type: "console", level: message.type(), message: message.text() }));
  page.on("requestfailed", (request) =>
    record({ type: "requestfailed", url: request.url(), failureText: request.failure()?.errorText })
  );
  page.on("response", (response) =>
    record({
      type: "response",
      url: response.url(),
      method: response.request().method(),
      status: response.status()
    })
  );

  testInfo.attach("browser-diagnostics-enabled", {
    body: Buffer.from("Browser diagnostics are installed for unexpected console, page, request, and API failures."),
    contentType: "text/plain"
  });

  return {
    assertNoBrowserDiagnosticsFailures() {
      if (failures.length > 0) {
        throw new Error(`Browser diagnostics failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
      }
    }
  };
}

export function useBrowserDiagnostics(test: TestType<{ page: Page }, object>, options: BrowserDiagnosticsOptions = {}) {
  const diagnostics = new WeakMap<Page, ReturnType<typeof installBrowserDiagnostics>>();

  test.beforeEach(async ({ page }, testInfo) => {
    diagnostics.set(page, installBrowserDiagnostics(page, testInfo, options));
  });

  test.afterEach(async ({ page }) => {
    diagnostics.get(page)?.assertNoBrowserDiagnosticsFailures();
  });
}

function isWiseEffUrl(url: string) {
  return url.includes("127.0.0.1") || url.includes("localhost");
}

function isCriticalApiUrl(url: string) {
  if (!isWiseEffUrl(url) || !url.includes("/api/")) return false;
  if (url.includes("/api/v1/audit-events")) return false;
  return url.includes("/api/v1/") || url.includes("/api/v2/");
}

function isNavigationAbort(failureText: string | undefined) {
  return failureText === "net::ERR_ABORTED";
}

function isExpectedApiFailure(issue: Extract<BrowserIssue, { type: "response" }>, rules: ExpectedApiFailure[]) {
  const method = issue.method?.toUpperCase();
  const path = pathOf(issue.url);

  return rules.some(
    (rule) =>
      rule.status === issue.status &&
      rule.method.toUpperCase() === method &&
      (rule.path === path || path.startsWith(rule.path.endsWith("/") ? rule.path : `${rule.path}/`) || path.startsWith(rule.path))
  );
}

function pathOf(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
