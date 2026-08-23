import dotenv from "dotenv";

import {
  OWNED_ACCEPTANCE_DESCRIPTOR_ENV,
  loadOwnedRuntimeDescriptorFromEnv,
  type OwnedLocalAcceptanceRuntimeDescriptorV1,
} from "./ownedRuntimeDescriptor";

type RuntimeEnv = Record<string, string | undefined>;
type DotenvLoader = (options: { path: string }) => unknown;

export const OWNED_ACCEPTANCE_RUNTIME_FLAG_ENV = "WISEEFF_ACCEPTANCE_OWNED_RUNTIME";

export type AcceptanceEnvironmentResult<TOwnedRuntime = OwnedLocalAcceptanceRuntimeDescriptorV1> =
  | { mode: "owned-descriptor"; ownedRuntime: TOwnedRuntime }
  | { mode: "owned-flag" }
  | { mode: "legacy" };

export type LoadAcceptanceEnvironmentOptions<TOwnedRuntime = OwnedLocalAcceptanceRuntimeDescriptorV1> = {
  env?: RuntimeEnv;
  loadDotenv?: DotenvLoader;
  validateOwnedRuntime?: (env: RuntimeEnv) => TOwnedRuntime | undefined;
};

/**
 * Loads acceptance configuration at the Playwright config/spec boundary.
 *
 * An owned Gate0 consumer must arrive with either a descriptor that validates
 * against its minimum process environment or the explicit owned flag used by
 * descriptor-free nested workers. Neither path may read a worktree dotenv
 * file. Legacy/manual runners retain the historical explicit dotenv behavior.
 */
export function loadAcceptanceEnvironment<TOwnedRuntime = OwnedLocalAcceptanceRuntimeDescriptorV1>(
  options: LoadAcceptanceEnvironmentOptions<TOwnedRuntime> = {},
): AcceptanceEnvironmentResult<TOwnedRuntime> {
  const env = options.env ?? process.env;
  const loadDotenv = options.loadDotenv ?? ((dotenvOptions) => dotenv.config(dotenvOptions));
  const validateOwnedRuntime = options.validateOwnedRuntime
    ?? (loadOwnedRuntimeDescriptorFromEnv as (runtimeEnv: RuntimeEnv) => TOwnedRuntime | undefined);

  if (env[OWNED_ACCEPTANCE_DESCRIPTOR_ENV]?.trim()) {
    const ownedRuntime = validateOwnedRuntime(env);
    if (!ownedRuntime) {
      throw new Error(`${OWNED_ACCEPTANCE_DESCRIPTOR_ENV} did not resolve to a valid owned runtime.`);
    }
    return { mode: "owned-descriptor", ownedRuntime };
  }

  if (env[OWNED_ACCEPTANCE_RUNTIME_FLAG_ENV] === "true") {
    return { mode: "owned-flag" };
  }

  loadDotenv({ path: env.WISEEFF_ACCEPTANCE_ENV_FILE?.trim() || ".env" });
  return { mode: "legacy" };
}
