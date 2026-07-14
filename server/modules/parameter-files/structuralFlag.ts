/** Feature flag for structural DTS ingest. Default: enabled. Set `DTS_STRUCTURAL_INGEST=0|false|off` to disable. */
export function isDtsStructuralIngestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.DTS_STRUCTURAL_INGEST?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    return true;
  }
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}
