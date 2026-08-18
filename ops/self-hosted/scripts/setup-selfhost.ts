import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { detectDefaultHost, generateUrlSafeSecret } from "./ip-lab-profile";
import {
  mergeSection,
  normalizeAnswers,
  parseSelfHostCliArgs,
  renderAnswersEnvText,
  validateAnswers,
  answersFromEnv,
  type SelfHostAnswers
} from "./selfhost-answers";
import { parseEnvText, renderSelfHostEnv, resolveSecrets } from "./selfhost-profile";

export type SetupSelfHostResult = {
  envFile: string;
  envText: string;
  answers: SelfHostAnswers;
  wrote: boolean;
  keptExisting: boolean;
};

export async function setupSelfHostEnv(
  args: readonly string[],
  writeFile = writeGeneratedEnv
): Promise<SetupSelfHostResult> {
  const options = parseSelfHostCliArgs(args);
  const envFile = resolve(options.envFile);
  const existingText = existsSync(envFile) ? readFileSync(envFile, "utf8") : undefined;
  const existingEnv = existingText ? parseEnvText(existingText) : undefined;

  let answers = normalizeAnswers(options.answers);
  if (!answers.siteHost) {
    answers.siteHost = detectDefaultHost() ?? "";
  }

  if (options.section) {
    if (!existingEnv) {
      throw new Error(`${envFile} does not exist. Run setup without a section first.`);
    }
    const base = answersFromEnv(existingEnv);
    answers = mergeSection(base, options.section, options.answers);
    if (!answers.adminPassword) {
      answers.adminPassword = existingEnv.WISEEFF_LAB_ADMIN_PASSWORD ?? "";
    }
  }

  if (!answers.adminPassword) {
    answers.adminPassword =
      existingEnv?.WISEEFF_LAB_ADMIN_PASSWORD && !options.force
        ? existingEnv.WISEEFF_LAB_ADMIN_PASSWORD
        : generateUrlSafeSecret();
  }

  const errors = validateAnswers(answers);
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }

  const secrets = resolveSecrets(existingEnv, Boolean(options.force && !options.section));
  const envText = renderSelfHostEnv(answers, secrets);

  if (options.printAnswers) {
    return {
      envFile: options.envFile,
      envText: renderAnswersEnvText(answers),
      answers,
      wrote: false,
      keptExisting: false
    };
  }
  if (options.printEnv) {
    return { envFile: options.envFile, envText, answers, wrote: false, keptExisting: false };
  }

  if (existsSync(envFile) && !options.force && !options.section) {
    throw new Error(`${envFile} already exists. Re-run with --force to overwrite.`);
  }

  await writeFile(envFile, envText);
  return { envFile, envText, answers, wrote: true, keptExisting: false };
}

async function writeGeneratedEnv(envFile: string, envText: string) {
  writeFileSync(envFile, envText, { encoding: "utf8", mode: 0o600 });
  await chmod(envFile, 0o600);
}

async function main() {
  const result = await setupSelfHostEnv(process.argv.slice(2));
  const options = parseSelfHostCliArgs(process.argv.slice(2));
  if (options.json) {
    console.log(
      JSON.stringify(
        {
          envFile: result.envFile,
          wrote: result.wrote,
          keptExisting: result.keptExisting,
          profile: result.answers.profile,
          tlsMode: result.answers.tlsMode,
          siteHost: result.answers.siteHost,
          adminUsername: result.answers.adminUsername,
          seed: result.answers.seed,
          llm: result.answers.llm
        },
        null,
        2
      )
    );
    return;
  }
  if (result.wrote) {
    console.log(`Wrote ${result.envFile} (mode 600).`);
    console.log(`Profile: ${result.answers.profile}  URL host: ${result.answers.siteHost}`);
    console.log(`Admin username: ${result.answers.adminUsername}`);
    return;
  }
  process.stdout.write(result.envText);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
