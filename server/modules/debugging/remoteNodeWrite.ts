export function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function shouldUseBase64Write(value: string) {
  return /[\r\n\u0000]/.test(value);
}

export function buildRemoteWriteShellCommand(nodePath: string, value: string) {
  if (shouldUseBase64Write(value)) {
    const encoded = Buffer.from(value, "utf8").toString("base64");
    return `echo ${shellQuote(encoded)} | base64 -d > ${shellQuote(nodePath)}`;
  }

  return `printf %s ${shellQuote(value)} > ${shellQuote(nodePath)}`;
}

export function normalizeRemoteReadValue(stdout: string, preserveExact: boolean) {
  if (preserveExact) {
    return stdout;
  }

  return stdout.trim();
}
