export type HdcTargetsResponse = {
  ok: boolean;
  targets: string[];
  activeTarget?: string;
  error?: string;
  stderr?: string;
};

export type HdcReadResponse = {
  ok: boolean;
  command?: string[];
  returncode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  value?: string;
  error?: string;
};

export type HdcWriteResponse = {
  ok: boolean;
  writeResult?: HdcReadResponse;
  readResult?: HdcReadResponse;
  value?: string;
  verified?: boolean;
  error?: string;
};

async function readJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

export function detectHdcTargets() {
  return fetch("/api/hdc/targets").then((response) => readJson<HdcTargetsResponse>(response));
}

export function readNodeValue(input: { target?: string; nodePath: string }) {
  return fetch("/api/hdc/read-node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then((response) => readJson<HdcReadResponse>(response));
}

export function writeNodeValue(input: { target?: string; nodePath: string; value: string; readBack: boolean }) {
  return fetch("/api/hdc/write-node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }).then((response) => readJson<HdcWriteResponse>(response));
}
