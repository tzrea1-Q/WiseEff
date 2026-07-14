import { stripDtsComments } from "./preprocess";

export type UnsupportedConstructCode =
  | "include"
  | "unit-address-node"
  | "overlay-ref"
  | "inline-label"
  | "boolean-property"
  | "multi-cell-group";

export type UnsupportedConstruct = {
  code: UnsupportedConstructCode;
  message: string;
  sample: string;
};

type Detector = {
  code: UnsupportedConstructCode;
  message: string;
  pattern: RegExp;
};

const DETECTORS: Detector[] = [
  {
    code: "include",
    message: "DTS /include/ is not supported; provide an expanded file.",
    pattern: /\/include\//,
  },
  {
    code: "unit-address-node",
    message: "Unit-address nodes (name@addr) require structured parsing (P1).",
    pattern: /[A-Za-z_][\w-]*@[^\s{]+\s*\{/,
  },
  {
    code: "overlay-ref",
    message: "Overlay references (&label) require structured parsing (P1).",
    pattern: /&[A-Za-z_][\w-]*\s*\{/,
  },
  {
    code: "inline-label",
    message: "Inline labels (label:name) require structured parsing (P1).",
    pattern: /[A-Za-z_][\w-]*:[A-Za-z_][\w-]*\s*\{/,
  },
  {
    code: "boolean-property",
    message: "Boolean/empty properties (identifier;) require structured parsing (P1).",
    pattern: /(?:^|[\s{;])([#A-Za-z_][\w,#-]*)\s*;/,
  },
  {
    code: "multi-cell-group",
    message: "Multi cell-groups (<...>,<...>) require structured parsing (P1).",
    pattern: />\s*,\s*</,
  },
];

function clipSample(text: string, max = 48): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) {
    return compact;
  }
  return `${compact.slice(0, max - 1)}…`;
}

/** Detect DTS constructs the current flat parser cannot faithfully represent. Detection only — no fixes. */
export function detectUnsupportedDtsConstructs(source: string): UnsupportedConstruct[] {
  const cleaned = stripDtsComments(source);
  const findings: UnsupportedConstruct[] = [];
  const seen = new Set<UnsupportedConstructCode>();

  for (const detector of DETECTORS) {
    if (seen.has(detector.code)) {
      continue;
    }
    const flags = detector.pattern.flags.includes("g") ? detector.pattern.flags : `${detector.pattern.flags}g`;
    const re = new RegExp(detector.pattern.source, flags);
    const match = re.exec(cleaned);
    if (!match) {
      continue;
    }
    seen.add(detector.code);
    findings.push({
      code: detector.code,
      message: detector.message,
      sample: clipSample(match[0]),
    });
  }

  return findings;
}
