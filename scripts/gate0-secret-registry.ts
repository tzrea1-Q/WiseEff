import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { persistGate0ExactValuesForRescan } from "./gate0-artifact-sanitizer";

type RuntimeEnv = Record<string, string | undefined>;

export const GATE0_SECRET_REGISTRY_URL_ENV = "WISEEFF_GATE0_SECRET_REGISTRY_URL";
export const GATE0_SECRET_REGISTRY_TOKEN_ENV = "WISEEFF_GATE0_SECRET_REGISTRY_TOKEN";

const MAX_REQUEST_BYTES = 64 * 1024;
const MIN_SECRET_LENGTH = 8;

export type Gate0SecretRegistry = {
  env: Record<string, string>;
  add(values: readonly string[], persistenceRoot: string): void;
  values(): string[];
  seal(): Promise<void>;
  close(): Promise<void>;
};

/**
 * Starts a loopback-only, token-authenticated sink. The first parent
 * registration binds an owned artifact root; every accepted registration is
 * encrypted and durably published there before it is acknowledged.
 */
export async function startGate0SecretRegistry(signal?: AbortSignal): Promise<Gate0SecretRegistry> {
  const token = randomBytes(32).toString("hex");
  const values = new Set<string>([token]);
  let persistenceRoot: string | undefined;
  let sealed = false;
  const activeRegistrations = new Set<Promise<void>>();
  const commit = (secretValues: readonly string[], requestedRoot?: string) => {
    if (sealed) throw new Error("Gate0 secret registry is sealed.");
    const targetRoot = requestedRoot ?? persistenceRoot;
    if (!targetRoot) throw new Error("Gate0 secret registry persistence root is not bound.");
    if (persistenceRoot && targetRoot !== persistenceRoot) {
      throw new Error("Gate0 secret registry persistence root cannot change.");
    }
    const additions = normalized(secretValues);
    const nextValues = [...values, ...additions];
    persistGate0ExactValuesForRescan(targetRoot, nextValues);
    persistenceRoot = targetRoot;
    addNormalized(values, additions);
  };
  const server = createServer((request, response) => {
    let registration!: Promise<void>;
    registration = handleRegistrationRequest(request, response, token, commit)
      .finally(() => activeRegistrations.delete(registration));
    activeRegistrations.add(registration);
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      server.close();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Gate0 owner cancelled secret registry startup."));
    };
    const listening = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const error = (cause: Error) => {
      signal?.removeEventListener("abort", abort);
      reject(cause);
    };
    server.once("listening", listening);
    server.once("error", error);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Gate0 secret registry did not acquire a loopback port.");
  }
  const env = {
    [GATE0_SECRET_REGISTRY_URL_ENV]: `http://127.0.0.1:${address.port}/register`,
    [GATE0_SECRET_REGISTRY_TOKEN_ENV]: token,
  };
  return {
    env,
    add(secretValues, requestedRoot) {
      commit(secretValues, requestedRoot);
    },
    values() {
      return [...values].sort((left, right) => right.length - left.length || left.localeCompare(right));
    },
    async seal() {
      sealed = true;
      await Promise.all([...activeRegistrations]);
    },
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}

export async function registerGate0GeneratedSecrets(
  secretValues: readonly string[],
  env: RuntimeEnv = process.env,
) {
  const url = env[GATE0_SECRET_REGISTRY_URL_ENV]?.trim();
  const token = env[GATE0_SECRET_REGISTRY_TOKEN_ENV]?.trim();
  if (!url && !token) return;
  if (!url || !token) throw new Error("Gate0 secret registry environment is incomplete.");
  const endpoint = new URL(url);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || endpoint.pathname !== "/register") {
    throw new Error("Gate0 secret registry must be the owned loopback endpoint.");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ values: normalized(secretValues) }),
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`Gate0 secret registry rejected nested values with status ${response.status}.`);
}

async function handleRegistrationRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  token: string,
  commit: (values: readonly string[]) => void,
) {
  try {
    if (request.method !== "POST" || request.url !== "/register") {
      response.writeHead(404).end();
      return;
    }
    const presented = request.headers.authorization?.replace(/^Bearer\s+/u, "") ?? "";
    if (!sameToken(presented, token)) {
      response.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > MAX_REQUEST_BYTES) throw new Error("Gate0 secret registration payload is too large.");
      chunks.push(buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { values?: unknown };
    if (!Array.isArray(body.values) || body.values.some((value) => typeof value !== "string")) {
      throw new Error("Gate0 secret registration payload is invalid.");
    }
    commit(body.values as string[]);
    response.writeHead(204).end();
  } catch (error) {
    const unavailable = error instanceof Error && /persistence root|sealed|registry/i.test(error.message);
    response.writeHead(unavailable ? 503 : 400).end();
  }
}

function addNormalized(target: Set<string>, secretValues: readonly string[]) {
  for (const value of normalized(secretValues)) target.add(value);
}

function normalized(secretValues: readonly string[]) {
  return [...new Set(secretValues.filter((value) => value.length >= MIN_SECRET_LENGTH))];
}

function sameToken(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
