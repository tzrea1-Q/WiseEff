import { createLocalObjectStore, type ObjectStore, type ObjectStoreHealthCheck } from "./modules/logs/objectStore";
import { createS3ObjectStore, type ObjectStorageFetch } from "./modules/logs/s3ObjectStore";

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

export function createObjectStoreFromEnv(env: ObjectStoreRuntimeEnv): ObjectStore & ObjectStoreHealthCheck {
  if (env.OBJECT_STORE_MODE === "local") {
    return createLocalObjectStore(env.OBJECT_STORE_ROOT);
  }

  if (
    !env.OBJECT_STORAGE_ENDPOINT ||
    !env.OBJECT_STORAGE_BUCKET ||
    !env.OBJECT_STORAGE_ACCESS_KEY_ID ||
    !env.OBJECT_STORAGE_SECRET_ACCESS_KEY
  ) {
    throw new Error("S3 object storage settings are required when OBJECT_STORE_MODE=s3.");
  }

  return createS3ObjectStore({
    endpoint: env.OBJECT_STORAGE_ENDPOINT,
    bucket: env.OBJECT_STORAGE_BUCKET,
    accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID,
    secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    region: env.OBJECT_STORAGE_REGION,
    fetchImpl: env.fetchImpl
  });
}
