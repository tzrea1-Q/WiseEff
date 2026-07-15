import { stripDtsComments } from "./preprocess";

/** P1: only /include/ remains unsupported; other constructs are handled by structured parsing. */
export type UnsupportedConstructCode = "include";

export type UnsupportedConstruct = {
  code: UnsupportedConstructCode;
  message: string;
  sample: string;
};

function clipSample(text: string, max = 48): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 1)}…`;
}

/** Detect DTS constructs that remain hard-unsupported (currently only /include/). */
export function detectUnsupportedDtsConstructs(source: string): UnsupportedConstruct[] {
  const cleaned = stripDtsComments(source);
  const match = /\/include\//.exec(cleaned);
  if (!match) {
    return [];
  }
  return [
    {
      code: "include",
      message: "DTS /include/ is not supported; provide an expanded file.",
      sample: clipSample(match[0]),
    },
  ];
}
