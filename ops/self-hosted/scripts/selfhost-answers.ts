export const selfHostProfiles = ["ip-lab", "acme"] as const;
export const selfHostTlsModes = ["http", "internal", "acme"] as const;
export const selfHostSeeds = ["chargelab", "none"] as const;
export const selfHostLlmModes = ["skip", "xiaoze", "xiaoze+logs"] as const;
export const selfHostSections = ["profile", "access", "admin", "seed", "llm"] as const;
export const selfHostActions = ["init", "preflight", "up", "provision", "all"] as const;

export type SelfHostProfile = (typeof selfHostProfiles)[number];
export type SelfHostTlsMode = (typeof selfHostTlsModes)[number];
export type SelfHostSeed = (typeof selfHostSeeds)[number];
export type SelfHostLlmMode = (typeof selfHostLlmModes)[number];
export type SelfHostSection = (typeof selfHostSections)[number];
export type SelfHostAction = (typeof selfHostActions)[number];

export type SelfHostAnswers = {
  profile: SelfHostProfile;
  tlsMode: SelfHostTlsMode;
  siteHost: string;
  tlsEmail: string;
  adminUsername: string;
  adminPassword: string;
  adminName: string;
  seed: SelfHostSeed;
  llm: SelfHostLlmMode;
  agentApiBaseUrl: string;
  agentModel: string;
  agentApiKey: string;
  logAnalysisApiBaseUrl: string;
  logAnalysisModel: string;
  logAnalysisApiKey: string;
};

export type SelfHostSecrets = {
  postgresPassword: string;
  minioPassword: string;
};

export type SelfHostCliOptions = {
  section?: SelfHostSection;
  action: SelfHostAction;
  answers: SelfHostAnswers;
  envFile: string;
  force: boolean;
  printEnv: boolean;
  printAnswers: boolean;
  json: boolean;
  nonInteractive: boolean;
  skipBuild: boolean;
  skipUp: boolean;
  skipProvision: boolean;
  keepExisting: boolean;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createDefaultAnswers(): SelfHostAnswers {
  return {
    profile: "ip-lab",
    tlsMode: "http",
    siteHost: "",
    tlsEmail: "unused-ip-lab@localhost",
    adminUsername: "admin.ops",
    adminPassword: "",
    adminName: "Platform Admin",
    seed: "chargelab",
    llm: "skip",
    agentApiBaseUrl: "",
    agentModel: "",
    agentApiKey: "",
    logAnalysisApiBaseUrl: "",
    logAnalysisModel: "",
    logAnalysisApiKey: ""
  };
}

export function normalizeAnswers(input: Partial<SelfHostAnswers>): SelfHostAnswers {
  const answers = { ...createDefaultAnswers(), ...input };
  answers.profile = answers.profile === "acme" ? "acme" : "ip-lab";
  if (answers.profile === "acme") {
    answers.tlsMode = "acme";
    if (answers.tlsEmail === "unused-ip-lab@localhost") {
      answers.tlsEmail = "";
    }
  } else if (answers.tlsMode === "acme") {
    answers.tlsMode = "http";
    answers.tlsEmail = "unused-ip-lab@localhost";
  }
  answers.siteHost = answers.siteHost.trim();
  answers.tlsEmail = answers.tlsEmail.trim();
  answers.adminUsername = answers.adminUsername.trim().toLowerCase();
  answers.adminName = answers.adminName.trim() || "Platform Admin";
  answers.seed = answers.seed === "none" ? "none" : "chargelab";
  answers.llm = selfHostLlmModes.includes(answers.llm) ? answers.llm : "skip";
  answers.agentApiBaseUrl = answers.agentApiBaseUrl.trim();
  answers.agentModel = answers.agentModel.trim();
  answers.agentApiKey = answers.agentApiKey.trim();
  answers.logAnalysisApiBaseUrl = answers.logAnalysisApiBaseUrl.trim();
  answers.logAnalysisModel = answers.logAnalysisModel.trim();
  answers.logAnalysisApiKey = answers.logAnalysisApiKey.trim();
  if (answers.llm === "skip") {
    answers.agentApiBaseUrl = "";
    answers.agentModel = "";
    answers.agentApiKey = "";
    answers.logAnalysisApiBaseUrl = "";
    answers.logAnalysisModel = "";
    answers.logAnalysisApiKey = "";
  } else if (answers.llm === "xiaoze") {
    answers.logAnalysisApiBaseUrl = "";
    answers.logAnalysisModel = "";
    answers.logAnalysisApiKey = "";
  }
  return answers;
}

export function validateAnswers(answers: SelfHostAnswers): string[] {
  const normalized = normalizeAnswers(answers);
  const errors: string[] = [];
  if (!normalized.siteHost) {
    errors.push("site host is required (--ip or --host).");
  }
  if (normalized.profile === "ip-lab" && normalized.tlsMode !== "http" && normalized.tlsMode !== "internal") {
    errors.push("IP lab TLS mode must be http or internal.");
  }
  if (normalized.profile === "acme") {
    if (normalized.tlsMode !== "acme") {
      errors.push("ACME profile TLS mode must be acme.");
    }
    if (!emailPattern.test(normalized.tlsEmail)) {
      errors.push("ACME profile requires --tls-email.");
    }
  }
  if (normalized.adminUsername.length < 3) {
    errors.push("Admin username must be at least 3 characters.");
  }
  if (normalized.adminPassword && normalized.adminPassword.length < 8) {
    errors.push("Admin password must be at least 8 characters.");
  }
  if (normalized.llm === "xiaoze" || normalized.llm === "xiaoze+logs") {
    if (!normalized.agentApiBaseUrl || !normalized.agentModel || !normalized.agentApiKey) {
      errors.push("Xiaoze LLM requires --agent-api-base-url, --agent-model, and --agent-api-key.");
    }
  }
  if (normalized.llm === "xiaoze+logs") {
    if (!normalized.logAnalysisApiBaseUrl || !normalized.logAnalysisModel || !normalized.logAnalysisApiKey) {
      errors.push(
        "Log-analysis LLM requires --log-analysis-api-base-url, --log-analysis-model, and --log-analysis-api-key."
      );
    }
  }
  return errors;
}

export function answersFromEnv(env: Record<string, string | undefined>): SelfHostAnswers {
  const agentKey = env.AGENT_API_KEY?.trim() ?? "";
  const agentUrl = env.AGENT_API_BASE_URL?.trim() ?? "";
  const logKey = env.LOG_ANALYSIS_API_KEY?.trim() ?? "";
  const logUrl = env.LOG_ANALYSIS_API_BASE_URL?.trim() ?? "";
  let llm: SelfHostLlmMode = "skip";
  if (agentUrl && agentKey && logUrl && logKey) {
    llm = "xiaoze+logs";
  } else if (agentUrl && agentKey) {
    llm = "xiaoze";
  }
  const profile: SelfHostProfile = env.WISEEFF_DEPLOY_PROFILE?.trim() === "acme" ? "acme" : "ip-lab";
  const rawTls = (env.WISEEFF_TLS_MODE ?? "").trim();
  const tlsMode: SelfHostTlsMode =
    profile === "acme" ? "acme" : rawTls === "internal" ? "internal" : "http";
  return normalizeAnswers({
    profile,
    tlsMode,
    siteHost: env.WISEEFF_SITE_HOST ?? "",
    tlsEmail: env.WISEEFF_TLS_EMAIL ?? "",
    adminUsername: env.WISEEFF_LAB_ADMIN_USERNAME ?? "admin.ops",
    adminPassword: env.WISEEFF_LAB_ADMIN_PASSWORD ?? "",
    adminName: env.WISEEFF_LAB_ADMIN_NAME ?? "Platform Admin",
    seed: env.WISEEFF_LAB_SEED === "none" ? "none" : "chargelab",
    llm,
    agentApiBaseUrl: env.AGENT_API_BASE_URL ?? "",
    agentModel: env.AGENT_MODEL ?? "",
    agentApiKey: env.AGENT_API_KEY ?? "",
    logAnalysisApiBaseUrl: env.LOG_ANALYSIS_API_BASE_URL ?? "",
    logAnalysisModel: env.LOG_ANALYSIS_MODEL ?? "",
    logAnalysisApiKey: env.LOG_ANALYSIS_API_KEY ?? ""
  });
}

export function mergeSection(base: SelfHostAnswers, section: SelfHostSection, patch: Partial<SelfHostAnswers>) {
  const next = { ...base };
  if (section === "profile") {
    next.profile = patch.profile ?? next.profile;
    if (next.profile === "acme") {
      next.tlsMode = "acme";
    } else if (next.tlsMode === "acme") {
      next.tlsMode = "http";
      next.tlsEmail = "unused-ip-lab@localhost";
    }
  } else if (section === "access") {
    next.siteHost = patch.siteHost ?? next.siteHost;
    next.tlsMode = patch.tlsMode ?? next.tlsMode;
    next.tlsEmail = patch.tlsEmail ?? next.tlsEmail;
  } else if (section === "admin") {
    next.adminUsername = patch.adminUsername ?? next.adminUsername;
    next.adminPassword = patch.adminPassword ?? next.adminPassword;
    next.adminName = patch.adminName ?? next.adminName;
  } else if (section === "seed") {
    next.seed = patch.seed ?? next.seed;
  } else if (section === "llm") {
    next.llm = patch.llm ?? next.llm;
    next.agentApiBaseUrl = patch.agentApiBaseUrl ?? next.agentApiBaseUrl;
    next.agentModel = patch.agentModel ?? next.agentModel;
    next.agentApiKey = patch.agentApiKey ?? next.agentApiKey;
    next.logAnalysisApiBaseUrl = patch.logAnalysisApiBaseUrl ?? next.logAnalysisApiBaseUrl;
    next.logAnalysisModel = patch.logAnalysisModel ?? next.logAnalysisModel;
    next.logAnalysisApiKey = patch.logAnalysisApiKey ?? next.logAnalysisApiKey;
  }
  return normalizeAnswers(next);
}

export function renderAnswersEnvText(answers: SelfHostAnswers) {
  const normalized = normalizeAnswers(answers);
  return [
    `WISEEFF_DEPLOY_PROFILE=${normalized.profile}`,
    `WISEEFF_TLS_MODE=${normalized.tlsMode}`,
    `WISEEFF_SITE_HOST=${normalized.siteHost}`,
    `WISEEFF_TLS_EMAIL=${normalized.tlsEmail}`,
    `WISEEFF_LAB_ADMIN_USERNAME=${normalized.adminUsername}`,
    `WISEEFF_LAB_ADMIN_PASSWORD=${normalized.adminPassword}`,
    `WISEEFF_LAB_ADMIN_NAME=${normalized.adminName}`,
    `WISEEFF_LAB_SEED=${normalized.seed}`,
    `WISEEFF_LLM_MODE=${normalized.llm}`,
    `AGENT_API_BASE_URL=${normalized.agentApiBaseUrl}`,
    `AGENT_MODEL=${normalized.agentModel}`,
    `AGENT_API_KEY=${normalized.agentApiKey}`,
    `LOG_ANALYSIS_API_BASE_URL=${normalized.logAnalysisApiBaseUrl}`,
    `LOG_ANALYSIS_MODEL=${normalized.logAnalysisModel}`,
    `LOG_ANALYSIS_API_KEY=${normalized.logAnalysisApiKey}`,
    ""
  ].join("\n");
}

export function parseAnswersEnvText(text: string): SelfHostAnswers {
  const env: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const separator = line.indexOf("=");
    env[line.slice(0, separator).trim()] = line.slice(separator + 1);
  }
  const llm = env.WISEEFF_LLM_MODE?.trim();
  return answersFromEnv({
    ...env,
    AGENT_API_KEY: llm === "skip" ? "" : env.AGENT_API_KEY,
    LOG_ANALYSIS_API_KEY: llm === "xiaoze+logs" ? env.LOG_ANALYSIS_API_KEY : llm === "xiaoze" ? "" : env.LOG_ANALYSIS_API_KEY
  });
}

function takeValue(args: readonly string[], index: number, name: string) {
  const next = args[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`Missing value for ${name}.`);
  }
  return next;
}

export function parseSelfHostCliArgs(args: readonly string[]): SelfHostCliOptions {
  const options: SelfHostCliOptions = {
    action: "all",
    answers: createDefaultAnswers(),
    envFile: "ops/self-hosted/.env",
    force: false,
    printEnv: false,
    printAnswers: false,
    json: false,
    nonInteractive: false,
    skipBuild: false,
    skipUp: false,
    skipProvision: false,
    keepExisting: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      continue;
    }
    if ((selfHostSections as readonly string[]).includes(arg)) {
      options.section = arg as SelfHostSection;
      continue;
    }
    if ((selfHostActions as readonly string[]).includes(arg)) {
      options.action = arg as SelfHostAction;
      continue;
    }
    if ((arg === "--ip" || arg === "--host") && args[index + 1]) {
      options.answers.siteHost = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--profile" && args[index + 1]) {
      const value = takeValue(args, index, arg);
      if (value !== "ip-lab" && value !== "acme") {
        throw new Error("Profile must be ip-lab or acme.");
      }
      options.answers.profile = value;
      index += 1;
    } else if (arg === "--tls-mode" && args[index + 1]) {
      const value = takeValue(args, index, arg);
      if (value !== "http" && value !== "internal" && value !== "acme") {
        throw new Error("TLS mode must be http, internal, or acme.");
      }
      options.answers.tlsMode = value;
      index += 1;
    } else if (arg === "--tls-email" && args[index + 1]) {
      options.answers.tlsEmail = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--admin-username" && args[index + 1]) {
      options.answers.adminUsername = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--admin-password" && args[index + 1]) {
      options.answers.adminPassword = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--admin-name" && args[index + 1]) {
      options.answers.adminName = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--seed" && args[index + 1]) {
      const value = takeValue(args, index, arg);
      if (value !== "chargelab" && value !== "none") {
        throw new Error("Seed must be chargelab or none.");
      }
      options.answers.seed = value;
      index += 1;
    } else if (arg === "--llm" && args[index + 1]) {
      const value = takeValue(args, index, arg);
      if (value !== "skip" && value !== "xiaoze" && value !== "xiaoze+logs") {
        throw new Error("LLM mode must be skip, xiaoze, or xiaoze+logs.");
      }
      options.answers.llm = value;
      index += 1;
    } else if (arg === "--agent-api-base-url" && args[index + 1]) {
      options.answers.agentApiBaseUrl = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--agent-model" && args[index + 1]) {
      options.answers.agentModel = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--agent-api-key" && args[index + 1]) {
      options.answers.agentApiKey = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--log-analysis-api-base-url" && args[index + 1]) {
      options.answers.logAnalysisApiBaseUrl = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--log-analysis-model" && args[index + 1]) {
      options.answers.logAnalysisModel = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--log-analysis-api-key" && args[index + 1]) {
      options.answers.logAnalysisApiKey = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--env-file" && args[index + 1]) {
      options.envFile = takeValue(args, index, arg);
      index += 1;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--print-env") {
      options.printEnv = true;
    } else if (arg === "--print-answers") {
      options.printAnswers = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--non-interactive") {
      options.nonInteractive = true;
    } else if (arg === "--skip-build") {
      options.skipBuild = true;
    } else if (arg === "--skip-up") {
      options.skipUp = true;
    } else if (arg === "--skip-provision") {
      options.skipProvision = true;
    } else if (arg === "--keep-existing") {
      options.keepExisting = true;
    } else {
      throw new Error(`Unknown or incomplete setup argument: ${arg}`);
    }
  }

  options.answers = normalizeAnswers(options.answers);
  return options;
}
