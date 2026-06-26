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

export type RemoteCommandCapture = {
  stdout: string;
  stderr: string;
};

export function remoteShellDiagnostic(result: RemoteCommandCapture) {
  const output = [result.stderr, result.stdout].map((value) => value.trim()).filter(Boolean).join("\n");
  const diagnosticLine = output
    .split(/\r?\n/)
    .find((line) =>
      /(?:^|:\s)(?:cat|sh|\/bin\/sh): .*?(?:No such file or directory|Permission denied|not found|Read-only file system)/i.test(
        line
      )
    );
  return diagnosticLine?.trim();
}
