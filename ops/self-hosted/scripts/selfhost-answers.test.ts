import { describe, expect, it } from "vitest";
import {
  answersFromEnv,
  mergeSection,
  normalizeAnswers,
  parseSelfHostCliArgs,
  validateAnswers
} from "./selfhost-answers";

describe("self-host answers", () => {
  it("parses flags and defaults IP lab Quick answers", () => {
    const options = parseSelfHostCliArgs([
      "--non-interactive",
      "--profile",
      "ip-lab",
      "--ip",
      "203.0.113.10",
      "--llm",
      "skip"
    ]);
    expect(options.nonInteractive).toBe(true);
    expect(options.answers).toMatchObject({
      profile: "ip-lab",
      tlsMode: "http",
      siteHost: "203.0.113.10",
      seed: "chargelab",
      llm: "skip",
      adminUsername: "admin.ops"
    });
    expect(validateAnswers({ ...options.answers, adminPassword: "generated-password" })).toEqual([]);
  });

  it("requires ACME email and LLM keys when those modes are selected", () => {
    expect(
      validateAnswers(
        normalizeAnswers({
          profile: "acme",
          siteHost: "wiseeff.example.com",
          tlsEmail: "",
          adminPassword: "generated-password"
        })
      )
    ).toEqual(expect.arrayContaining(["ACME profile requires --tls-email."]));

    expect(
      validateAnswers(
        normalizeAnswers({
          profile: "ip-lab",
          siteHost: "203.0.113.10",
          llm: "xiaoze",
          adminPassword: "generated-password"
        })
      )
    ).toEqual(
      expect.arrayContaining(["Xiaoze LLM requires --agent-api-base-url, --agent-model, and --agent-api-key."])
    );
  });

  it("merges one section without dropping the rest", () => {
    const base = answersFromEnv({
      WISEEFF_DEPLOY_PROFILE: "ip-lab",
      WISEEFF_TLS_MODE: "http",
      WISEEFF_SITE_HOST: "203.0.113.10",
      WISEEFF_LAB_ADMIN_USERNAME: "admin.ops",
      WISEEFF_LAB_ADMIN_PASSWORD: "KeepThisPassword",
      WISEEFF_LAB_SEED: "chargelab"
    });
    const next = mergeSection(base, "llm", {
      llm: "xiaoze",
      agentApiBaseUrl: "https://llm.example.com/v1",
      agentModel: "demo-model",
      agentApiKey: "sk-demo"
    });
    expect(next.siteHost).toBe("203.0.113.10");
    expect(next.adminPassword).toBe("KeepThisPassword");
    expect(next.llm).toBe("xiaoze");
    expect(next.agentApiKey).toBe("sk-demo");
    expect(next.logAnalysisApiKey).toBe("");
  });

  it("rejects unknown flags", () => {
    expect(() => parseSelfHostCliArgs(["--unknown"])).toThrow("Unknown or incomplete setup argument");
  });
});
