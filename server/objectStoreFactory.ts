import { createLocalObjectStore, type ObjectStore, type ObjectStoreHealthCheck } from "./modules/logs/objectStore";
import { createS3ObjectStore, type ObjectStorageFetch } from "./modules/logs/s3ObjectStore";
import type { TracingBoundary } from "./observability/tracing";

export type ObjectStoreRuntimeEnv = {
  OBJECT_STORE_MODE: "local" | "s3";
  OBJECT_STORE_ROOT: string;
  OBJECT_STORAGE_ENDPOINT?: string;
  OBJECT_STORAGE_BUCKET?: string;
  OBJECT_STORAGE_ACCESS_KEY_ID?: string;
  OBJECT_STORAGE_SECRET_ACCESS_KEY?: string;
  OBJECT_STORAGE_REGION?: string;
  fetchImpl?: ObjectStorageFetch;
};

type ObjectStoreFactoryOptions = {
  tracing?: Pick<TracingBoundary, "withSpan">;
};

export function createObjectStoreFromEnv(env: ObjectStoreRuntimeEnv, options: ObjectStoreFactoryOptions = {}): ObjectStore & ObjectStoreHealthCheck {
  const mode = env.OBJECT_STORE_MODE;
  const wrap = (store: ObjectStore & ObjectStoreHealthCheck) => traceObjectStore(store, mode, options.tracing);

  if (mode === "local") {
    return wrap(createLocalObjectStore(env.OBJECT_STORE_ROOT));
  }

  if (
    !env.OBJECT_STORAGE_ENDPOINT ||
    !env.OBJECT_STORAGE_BUCKET ||
    !env.OBJECT_STORAGE_ACCESS_KEY_ID ||
    !env.OBJECT_STORAGE_SECRET_ACCESS_KEY
  ) {
    throw new Error("S3 object storage settings are required when OBJECT_STORE_MODE=s3.");
  }

  return wrap(createS3ObjectStore({
    endpoint: env.OBJECT_STORAGE_ENDPOINT,
    bucket: env.OBJECT_STORAGE_BUCKET,
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    region: env.OBJECT_STORAGE_REGION,
    fetchImpl: env.fetchImpl
  }));
}

function traceObjectStore(
  store: ObjectStore & ObjectStoreHealthCheck,
  mode: ObjectStoreRuntimeEnv["OBJECT_STORE_MODE"],
  tracing: Pick<TracingBoundary, "withSpan"> | undefined
): ObjectStore & ObjectStoreHealthCheck {
  const trace = <T>(operation: "put" | "get" | "checkHealth", fn: () => Promise<T>) => {
    return tracing ? tracing.withSpan("object_store.operation", { operation, mode }, fn) : fn();
  };

  return {
    put(input) {
      return trace("put", () => store.put(input));
    },
    get(storageKey) {
      return trace("get", () => store.get(storageKey));
    },
    checkHealth() {
      return trace("checkHealth", () => store.checkHealth());
    }
  };
}
