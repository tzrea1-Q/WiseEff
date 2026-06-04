import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvContent } from "./run-m5-smoke.shared";

type RuntimeEnv = Record<string, string | undefined>;
type CheckStatus = "passed" | "failed";
type BrowserRuntimeEvidenceStatus = "passed" | "failed" | "pending";

export type IdentityEvidenceCheck = {
  name: string;
  status: CheckStatus;
  statusCode?: number;
  detail: string;
};

export type IdentityEvidenceInput = {
  discovery: Omit<IdentityEvidenceCheck, "name">;
  me: Omit<IdentityEvidenceCheck, "name">;
  negativeChecks: IdentityEvidenceCheck[];
  browserRuntime: BrowserRuntimeEvidenceStatus;
};

export type IdentityEvidenceResult = {
  status: "passed" | "failed";
  blockers: string[];
  pending: string[];
};

type IdentityCheckOptions = {
  envFile: string;
  issuer: string;
  apiBaseUrl: string;
  audience: string;
  authorization: string;
  wrongIssuerAuthorization: string;
  wrongAudienceAuthorization: string;
  expiredAuthorization: string;
  browserRuntime: BrowserRuntimeEvidenceStatus;
  evidenceOut: string;
};

const requiredNegativeChecks = ["wrong issuer", "wrong audience", "expired token"] as const;
const defaultEvidenceOut = "docs/generated/m6-identity-evidence.md";

export function evaluateIdentityEvidence(input: IdentityEvidenceInput): IdentityEvidenceResult {
  const blockers: string[] = [];
  const pending: string[] = [];

  if (input.discovery.status !== "passed") {
    blockers.push("OIDC discovery/JWKS evidence failed.");
  }
  if (input.me.status !== "passed") {
    blockers.push("/api/v1/me target token evidence failed.");
  }

  for (const requiredName of requiredNegativeChecks) {
    const check = input.negativeChecks.find((candidate) => candidate.name === requiredName);
    if (!check) {
      blockers.push(`Missing required negative OIDC token check: ${requiredName}.`);
    } else if (check.status !== "passed") {
      blockers.push(`OIDC negative token check failed: ${requiredName}.`);
    }
  }

  if (input.browserRuntime === "pending") {
    pending.push("Browser token acquisition/refresh/logout evidence is pending.");
  } else if (input.browserRuntime === "failed") {
    blockers.push("Browser token acquisition/refresh/logout evidence failed.");
  }

  return {
    status: blockers.length === 0 && pending.length === 0 ? "passed" : "failed",
    blockers,
    pending
  };
}

export function buildIdentityEvidenceMarkdown(input: {
  date: string;
  issuer: string;
  apiBaseUrl: string;
  audience: string;
  evidenceScope?: string;
  browserRuntime?: BrowserRuntimeEvidenceStatus;
  result: IdentityEvidenceResult;
  checks: IdentityEvidenceCheck[];
}) {
  const checks = withBrowserRuntimeCheck(input.checks, input.browserRuntime);

  return [
    "## M6.2 Identity Evidence",
    "",
    `- Date: ${input.date}`,
    `- Status: \`${input.result.status}\``,
    `- Evidence scope: \`${redactIdentitySecret(input.evidenceScope ?? "target self-hosted OIDC")}\``,
    `- Issuer: \`${redactIdentitySecret(input.issuer)}\``,
    `- API base URL: \`${redactIdentitySecret(input.apiBaseUrl)}\``,
    `- Audience: \`${redactIdentitySecret(input.audience)}\``,
    "",
    "### Checks",
    "",
    "| Check | Status | HTTP | Detail |",
    "| --- | --- | --- | --- |",
    ...checks.map(
      (check) =>
        `| ${check.name} | ${check.status} | ${check.statusCode ?? "n/a"} | ${markdownCell(redactIdentitySecret(check.detail))} |`
    ),
    "",
    "### Blockers",
    "",
    ...(input.result.blockers.length > 0 ? input.result.blockers.map((item) => `- ${redactIdentitySecret(item)}`) : ["- none"]),
    "",
    "### Pending Evidence",
    "",
    ...(input.result.pending.length > 0 ? input.result.pending.map((item) => `- ${redactIdentitySecret(item)}`) : ["- none"]),
    ""
  ].join("\n");
}

export function parseIdentityCheckArgs(args: readonly string[], env: RuntimeEnv = process.env): IdentityCheckOptions {
  const getValue = (name: string, envName: string, fallback = "") => {
    const equalsPrefix = `${name}=`;
    const equalsArg = args.find((arg) => arg.startsWith(equalsPrefix));
    if (equalsArg) {
      return equalsArg.slice(equalsPrefix.length);
    }
    const index = args.indexOf(name);
    if (index !== -1) {
      return args[index + 1] ?? fallback;
    }
    return env[`npm_config_${name.slice(2).replace(/-/g, "_")}`]?.trim() || env[envName]?.trim() || fallback;
  };

  const browserRuntime = getValue("--browser-runtime", "M6_IDENTITY_BROWSER_RUNTIME", "pending");
  if (!["passed", "failed", "pending"].includes(browserRuntime)) {
    throw new Error("--browser-runtime must be passed, failed, or pending.");
  }

  return {
    envFile: getValue("--env-file", "M6_IDENTITY_ENV_FILE", "ops/self-hosted/.env"),
    issuer: getValue("--issuer", "AUTH_OIDC_ISSUER"),
    apiBaseUrl: getValue("--api-base-url", "WISEEFF_API_BASE_URL", env.VITE_WISEEFF_API_BASE_URL?.trim() || ""),
    audience: getValue("--audience", "AUTH_OIDC_AUDIENCE"),
    authorization: getValue("--authorization", "M6_IDENTITY_AUTHORIZATION", env.M6_SELFHOSTED_SMOKE_AUTHORIZATION?.trim() || ""),
    wrongIssuerAuthorization: getValue("--wrong-issuer-authorization", "M6_IDENTITY_WRONG_ISSUER_AUTHORIZATION"),
    wrongAudienceAuthorization: getValue("--wrong-audience-authorization", "M6_IDENTITY_WRONG_AUDIENCE_AUTHORIZATION"),
    expiredAuthorization: getValue("--expired-authorization", "M6_IDENTITY_EXPIRED_AUTHORIZATION"),
    browserRuntime: browserRuntime as BrowserRuntimeEvidenceStatus,
    evidenceOut: getValue("--evidence-out", "M6_IDENTITY_EVIDENCE_OUT", defaultEvidenceOut)
  };
}

export function redactIdentitySecret(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/((?:client_)?(?:token|secret|key|password)=)([^&\s]+)/gi, "$1<redacted>");
}

async function runIdentityChecks(options: IdentityCheckOptions, fetchImpl: typeof fetch = fetch) {
  const discovery = await discoveryCheck(options, fetchImpl);
  const me = await apiCheck({
    name: "/api/v1/me",
    url: `${trimTrailingSlash(options.apiBaseUrl)}/api/v1/me`,
    authorization: options.authorization,
    expectedStatus: 200,
    fetchImpl
  });
  const negativeChecks = await Promise.all([
    apiCheck({
      name: "wrong issuer",
      url: `${trimTrailingSlash(options.apiBaseUrl)}/api/v1/me`,
      authorization: options.wrongIssuerAuthorization,
      expectedStatus: 401,
      fetchImpl
    }),
    apiCheck({
      name: "wrong audience",
      url: `${trimTrailingSlash(options.apiBaseUrl)}/api/v1/me`,
      authorization: options.wrongAudienceAuthorization,
      expectedStatus: 401,
      fetchImpl
    }),
    apiCheck({
      name: "expired token",
      url: `${trimTrailingSlash(options.apiBaseUrl)}/api/v1/me`,
      authorization: options.expiredAuthorization,
      expectedStatus: 401,
      fetchImpl
    })
  ]);
  const result = evaluateIdentityEvidence({
    discovery,
    me,
    negativeChecks,
    browserRuntime: options.browserRuntime
  });

  return {
    result,
    checks: [
      { name: "OIDC discovery/JWKS", ...discovery },
      me,
      ...negativeChecks
    ]
  };
}

async function discoveryCheck(options: IdentityCheckOptions, fetchImpl: typeof fetch): Promise<Omit<IdentityEvidenceCheck, "name">> {
  try {
    if (!options.issuer.trim()) {
      return { status: "failed", detail: "AUTH_OIDC_ISSUER or --issuer is required." };
    }
    const discoveryUrl = `${trimTrailingSlash(options.issuer)}/.well-known/openid-configuration`;
    const discoveryResponse = await fetchImpl(discoveryUrl, { headers: { Accept: "application/json" } });
    const discoveryBody = await responseJson(discoveryResponse);
    const jwksUri = stringField(discoveryBody, "jwks_uri");
    const issuer = stringField(discoveryBody, "issuer");
    if (discoveryResponse.status !== 200 || issuer !== options.issuer || !jwksUri) {
      return {
        status: "failed",
        statusCode: discoveryResponse.status,
        detail: `discovery issuer=${issuer || "missing"} jwks_uri=${jwksUri || "missing"}`
      };
    }

    const jwksResponse = await fetchImpl(jwksUri, { headers: { Accept: "application/json" } });
    const jwksBody = await responseJson(jwksResponse);
    const keys = Array.isArray(jwksBody.keys) ? jwksBody.keys : [];
    return {
      status: jwksResponse.status === 200 && keys.length > 0 ? "passed" : "failed",
      statusCode: jwksResponse.status,
      detail: `issuer and jwks_uri discovered; signing keys=${keys.length}`
    };
  } catch (error) {
    return {
      status: "failed",
      statusCode: 0,
      detail: error instanceof Error ? error.message : "fetch failed"
    };
  }
}

async function apiCheck(input: {
  name: string;
  url: string;
  authorization: string;
  expectedStatus: number;
  fetchImpl: typeof fetch;
}): Promise<IdentityEvidenceCheck> {
  try {
    if (!input.authorization.trim()) {
      return {
        name: input.name,
        status: "failed",
        detail: "authorization token is required."
      };
    }
    const response = await input.fetchImpl(input.url, {
      headers: { Accept: "application/json", Authorization: input.authorization }
    });
    const text = await response.text();
    return {
      name: input.name,
      status: response.status === input.expectedStatus ? "passed" : "failed",
      statusCode: response.status,
      detail: text ? summarize(text) : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      name: input.name,
      status: "failed",
      statusCode: 0,
      detail: error instanceof Error ? error.message : "fetch failed"
    };
  }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function stringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] : "";
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function summarize(value: string) {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value;
}

function markdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function withBrowserRuntimeCheck(
  checks: IdentityEvidenceCheck[],
  browserRuntime: BrowserRuntimeEvidenceStatus | undefined
): IdentityEvidenceCheck[] {
  if (!browserRuntime || checks.some((check) => check.name === "browser token acquisition/refresh/logout")) {
    return checks;
  }

  return [
    ...checks,
    {
      name: "browser token acquisition/refresh/logout",
      status: browserRuntime === "passed" ? "passed" : "failed",
      detail:
        browserRuntime === "passed"
          ? "target browser runtime evidence recorded"
          : `browser runtime evidence ${browserRuntime}`
    }
  ];
}

async function main() {
  const initialCli = parseIdentityCheckArgs(process.argv.slice(2));
  const env = existsSync(initialCli.envFile) ? loadEnvContent(readFileSync(initialCli.envFile, "utf8"), process.env) : process.env;
  const cli = parseIdentityCheckArgs(process.argv.slice(2), env);
  const { result, checks } = await runIdentityChecks(cli);
  const evidence = buildIdentityEvidenceMarkdown({
    date: new Date().toISOString(),
    issuer: cli.issuer,
    apiBaseUrl: cli.apiBaseUrl,
    audience: cli.audience,
    browserRuntime: cli.browserRuntime,
    result,
    checks
  });

  mkdirSync(dirname(cli.evidenceOut), { recursive: true });
  writeFileSync(cli.evidenceOut, evidence, "utf8");
  console.log(evidence);
  process.exit(result.status === "passed" ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
