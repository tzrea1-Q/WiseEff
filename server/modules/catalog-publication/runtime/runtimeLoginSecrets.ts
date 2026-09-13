import { lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";

export type RuntimeLoginSecretFiles = {
  readonly directory: string;
  readonly api: string;
  readonly worker: string;
  readonly manager: string;
};

const lstatOrUndefined = (path: string) => {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
};

const assertNotSymlink = (path: string, label: string): void => {
  const st = lstatOrUndefined(path);
  if (st?.isSymbolicLink()) {
    throw new Error(`${label} refuses to use a symbolic link: ${path}`);
  }
};

const assertSafeDirectory = (directory: string): void => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNotSymlink(directory, "credential directory");
  const st = lstatSync(directory);
  if (!st.isDirectory()) {
    throw new Error(`credential directory is not a directory: ${directory}`);
  }
  if ((st.mode & 0o077) !== 0) {
    throw new Error(`credential directory must not be group/world accessible: ${directory}`);
  }
};

const writeOne = (path: string, contents: string, overwrite: boolean): void => {
  assertNotSymlink(path, "credential file");
  const existing = lstatOrUndefined(path);
  if (existing) {
    if (existing.isDirectory()) {
      throw new Error(`refusing to overwrite a directory: ${path}`);
    }
    if (!overwrite) {
      throw new Error(`refusing to overwrite existing credential file: ${path}`);
    }
  }
  const tmp = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  writeFileSync(tmp, contents, { mode: 0o600, flag: "wx" });
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best-effort cleanup of the temporary file.
    }
    throw error;
  }
};

export function writeRuntimeLoginSecrets(input: {
  readonly directory: string;
  readonly apiUrl: string;
  readonly workerUrl: string;
  readonly managerUrl: string;
  readonly overwrite?: boolean;
}): RuntimeLoginSecretFiles {
  const directory = resolve(input.directory);
  assertSafeDirectory(directory);
  const api = resolve(directory, "api.dsn");
  const worker = resolve(directory, "worker.dsn");
  const manager = resolve(directory, "manager.dsn");
  for (const file of [api, worker, manager]) {
    if (dirname(file) !== directory) {
      throw new Error(`credential file escaped directory: ${file}`);
    }
  }
  const overwrite = input.overwrite === true;
  writeOne(api, `${input.apiUrl}\n`, overwrite);
  writeOne(worker, `${input.workerUrl}\n`, overwrite);
  writeOne(manager, `${input.managerUrl}\n`, overwrite);
  return { directory, api, worker, manager };
}

export function redactPostgresUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = "redacted";
    }
    return parsed.toString();
  } catch {
    return "redacted";
  }
}
