import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck,
  Crosshair,
  FilePenLine,
  Flame,
  FolderOpen,
  GitMerge,
  Upload,
  Radar,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Users
} from "lucide-react";
import type { WorkbenchAction } from "../workbench/derivePersonalWorkbench";

export type NextActionIconTone =
  | "draft"
  | "returned"
  | "review"
  | "merge"
  | "import"
  | "users"
  | "risk-governance"
  | "hotspot-alert"
  | "hotspot-trend"
  | "hotspot-focus"
  | "readonly"
  | "browse";

type NextActionPresentation = {
  Icon: LucideIcon;
  tone: NextActionIconTone;
};

const KNOWN_ACTIONS: Record<string, NextActionPresentation> = {
  "user-drafts": { Icon: FilePenLine, tone: "draft" },
  "user-returned": { Icon: RotateCcw, tone: "returned" },
  "user-merge-queue": { Icon: GitMerge, tone: "merge" },
  "committer-review-queue": { Icon: ClipboardCheck, tone: "review" },
  "admin-import-batches": { Icon: Upload, tone: "import" },
  "admin-user-review": { Icon: Users, tone: "users" },
  "admin-high-risk-library": { Icon: ShieldAlert, tone: "risk-governance" },
  "guest-readonly-hotspots": { Icon: Radar, tone: "browse" },
  "guest-view-parameters": { Icon: FolderOpen, tone: "readonly" },
  "quiet-view-parameters": { Icon: FolderOpen, tone: "readonly" },
  "hotspot-variant-0": { Icon: Flame, tone: "hotspot-alert" },
  "hotspot-variant-1": { Icon: TrendingUp, tone: "hotspot-trend" },
  "hotspot-variant-2": { Icon: Crosshair, tone: "hotspot-focus" }
};

const HOTSPOT_VARIANTS: NextActionPresentation[] = [
  { Icon: Flame, tone: "hotspot-alert" },
  { Icon: TrendingUp, tone: "hotspot-trend" },
  { Icon: Crosshair, tone: "hotspot-focus" }
];

function stableVariantIndex(key: string, size: number) {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % size;
}

function fallbackPresentation(action: WorkbenchAction): NextActionPresentation {
  if (action.kind === "recommendation") {
    return { Icon: Sparkles, tone: "hotspot-focus" };
  }
  if (action.source === "review") {
    return { Icon: ClipboardCheck, tone: "review" };
  }
  if (action.source === "admin") {
    return { Icon: ShieldAlert, tone: "risk-governance" };
  }
  return { Icon: FolderOpen, tone: "readonly" };
}

export function getNextActionPresentation(action: WorkbenchAction): NextActionPresentation {
  if (action.visualKey && KNOWN_ACTIONS[action.visualKey]) {
    return KNOWN_ACTIONS[action.visualKey];
  }

  const known = KNOWN_ACTIONS[action.id];
  if (known) return known;

  if (action.id.startsWith("hotspot-")) {
    return HOTSPOT_VARIANTS[stableVariantIndex(action.id.slice("hotspot-".length), HOTSPOT_VARIANTS.length)];
  }

  return fallbackPresentation(action);
}
