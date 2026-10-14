import path from "node:path";

export function resolvePlaywrightRuntimeLane(env: NodeJS.ProcessEnv = process.env) {
  const id = env.WISEEFF_RUNTIME_LANE;
  if (!id) return undefined;
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 10000) {
    throw new Error("WISEEFF_RUNTIME_LANE must be an integer from 1 to 10000 (no leading zeros).");
  }
  if (env.WISEEFF_ACCEPTANCE_RUNTIME_DESCRIPTOR?.trim() || env.WISEEFF_ACCEPTANCE_OWNED_RUNTIME === "true") {
    throw new Error("A local lane cannot override an owned acceptance runtime.");
  }
  if (env.OBJECT_STORE_MODE && env.OBJECT_STORE_MODE !== "local") {
    throw new Error("Isolated local lanes require a local object store.");
  }
  if (!env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required for an isolated local lane.");
  const databaseUrl = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("Local lanes require a PostgreSQL DATABASE_URL.");
  }
  const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  const laneDatabaseName = databaseName.endsWith(`_lane_${id}`) ? databaseName : `${databaseName}_lane_${id}`;
  if (!databaseName || Buffer.byteLength(laneDatabaseName) > 63) {
    throw new Error("The lane database name must be nonempty and at most 63 bytes.");
  }
  databaseUrl.pathname = `/${laneDatabaseName}`;
  const objectStoreRoot = env.OBJECT_STORE_ROOT ?? ".wiseeff-object-store";
  return {
    id,
    apiURL: `http://127.0.0.1:${20000 + Number(id) * 2}`,
    baseURL: `http://127.0.0.1:${20001 + Number(id) * 2}`,
    databaseUrl: databaseUrl.href,
    objectStoreRoot: path.basename(objectStoreRoot) === `lane-${id}` ? objectStoreRoot : path.join(objectStoreRoot, `lane-${id}`),
    outputDir: path.join("test-results", "lanes", id),
    reportDir: path.join("playwright-report", "lanes", id)
  };
}

export function applyPlaywrightRuntimeLane(env: NodeJS.ProcessEnv = process.env) {
  const lane = resolvePlaywrightRuntimeLane(env);
  if (lane) Object.assign(env, {
    PORT: new URL(lane.apiURL).port,
    WISEEFF_FRONTEND_PORT: new URL(lane.baseURL).port,
    VITE_WISEEFF_API_BASE_URL: lane.apiURL,
    WISEEFF_ACCEPTANCE_FRONTEND_URL: lane.baseURL,
    DATABASE_URL: lane.databaseUrl,
    TEST_DATABASE_URL: lane.databaseUrl,
    OBJECT_STORE_ROOT: lane.objectStoreRoot,
    WISEEFF_TEST_DATABASE_PREFIX: `pw_lane_${lane.id}`,
    WISEEFF_ACCEPTANCE_PLAYWRIGHT_OUTPUT_DIR: `${lane.outputDir}/acceptance`,
    WISEEFF_ACCEPTANCE_PLAYWRIGHT_REPORT_DIR: `${lane.reportDir}/acceptance`,
    WISEEFF_QUALITY_PLAYWRIGHT_OUTPUT_DIR: `${lane.outputDir}/quality`,
    WISEEFF_QUALITY_PLAYWRIGHT_REPORT_DIR: `${lane.reportDir}/quality`
  });
  return lane;
}
