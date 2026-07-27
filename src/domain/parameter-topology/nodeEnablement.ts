/**
 * Node enablement / reachability derived from DTS `status` (ADR-0003).
 * Vocabulary is hard-coded from the Devicetree specification — not vendor YAML.
 */

export type EnablementOverride = "unstated" | "force-enabled" | "force-disabled" | "nonstandard";

export type StatusClassification = {
  /** Whether this node's own status makes it available to probe. */
  selfEnabled: boolean;
  override: EnablementOverride;
  rawStatus: string | null;
  rawToken: string | null;
};

export type NodeEnablementInput = {
  id: string;
  parentId: string | null;
  label: string;
  rawStatus: string | null;
};

export type NodeEnablement = StatusClassification & {
  /** Self enabled and every ancestor is self-enabled. */
  reachable: boolean;
  /** Nearest disabled/nonstandard ancestor when unreachable for that reason. */
  blockingAncestorId: string | null;
  blockingAncestorLabel: string | null;
};

const ENABLED_TOKENS = new Set(["ok", "okay"]);

/** Extract the first DTS string-list token from property raw text. */
export function parseStatusToken(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const quoted = trimmed.match(/"((?:\\.|[^"\\])*)"/);
  if (quoted) return quoted[1] ?? null;
  return trimmed;
}

export function classifyStatusRaw(raw: string | null | undefined): StatusClassification {
  const rawStatus = raw == null || !String(raw).trim() ? null : String(raw).trim();
  const rawToken = parseStatusToken(rawStatus);
  if (rawToken == null) {
    return { selfEnabled: true, override: "unstated", rawStatus: null, rawToken: null };
  }
  const normalized = rawToken.toLowerCase();
  if (ENABLED_TOKENS.has(normalized)) {
    return { selfEnabled: true, override: "force-enabled", rawStatus, rawToken };
  }
  if (normalized === "disabled") {
    return { selfEnabled: false, override: "force-disabled", rawStatus, rawToken };
  }
  return { selfEnabled: false, override: "nonstandard", rawStatus, rawToken };
}

/**
 * Annotate a forest of nodes with self-enablement and ancestor reachability.
 * Parent links use `parentId`; cycles fail closed as unreachable without a blocker label.
 */
export function annotateNodeEnablements(nodes: NodeEnablementInput[]): Map<string, NodeEnablement> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const classified = new Map(
    nodes.map((node) => [node.id, classifyStatusRaw(node.rawStatus)] as const)
  );
  const result = new Map<string, NodeEnablement>();

  function resolve(id: string, stack: Set<string>): NodeEnablement {
    const cached = result.get(id);
    if (cached) return cached;

    const node = byId.get(id);
    const own = classified.get(id) ?? classifyStatusRaw(null);
    if (!node) {
      const fallback: NodeEnablement = {
        ...own,
        reachable: own.selfEnabled,
        blockingAncestorId: null,
        blockingAncestorLabel: null
      };
      result.set(id, fallback);
      return fallback;
    }

    if (stack.has(id)) {
      const cyclic: NodeEnablement = {
        ...own,
        reachable: false,
        blockingAncestorId: null,
        blockingAncestorLabel: null
      };
      result.set(id, cyclic);
      return cyclic;
    }

    if (!node.parentId || !byId.has(node.parentId)) {
      const root: NodeEnablement = {
        ...own,
        reachable: own.selfEnabled,
        blockingAncestorId: null,
        blockingAncestorLabel: null
      };
      result.set(id, root);
      return root;
    }

    stack.add(id);
    const parent = resolve(node.parentId, stack);
    stack.delete(id);

    if (!own.selfEnabled) {
      const disabled: NodeEnablement = {
        ...own,
        reachable: false,
        blockingAncestorId: null,
        blockingAncestorLabel: null
      };
      result.set(id, disabled);
      return disabled;
    }

    if (!parent.selfEnabled) {
      const blocked: NodeEnablement = {
        ...own,
        reachable: false,
        blockingAncestorId: node.parentId,
        blockingAncestorLabel: byId.get(node.parentId)?.label ?? node.parentId
      };
      result.set(id, blocked);
      return blocked;
    }

    if (!parent.reachable && parent.blockingAncestorId) {
      const blocked: NodeEnablement = {
        ...own,
        reachable: false,
        blockingAncestorId: parent.blockingAncestorId,
        blockingAncestorLabel: parent.blockingAncestorLabel
      };
      result.set(id, blocked);
      return blocked;
    }

    const ok: NodeEnablement = {
      ...own,
      reachable: true,
      blockingAncestorId: null,
      blockingAncestorLabel: null
    };
    result.set(id, ok);
    return ok;
  }

  for (const node of nodes) {
    resolve(node.id, new Set());
  }
  return result;
}

export function nodeEnablementLabel(node: {
  name: string;
  unitAddress?: string | null;
  locator?: string | null;
}): string {
  const address = node.unitAddress ? `@${node.unitAddress}` : "";
  return `${node.name}${address}` || node.locator || node.name;
}

/** Attach enablement to effective topology nodes keyed by logicalNodeId / parentLogicalNodeId. */
export function withEffectiveEnablement<
  T extends {
    id: string;
    logicalNodeId: string;
    name: string;
    unitAddress?: string;
    locator?: string;
    parentLogicalNodeId: string | null;
    rawStatus: string | null;
  }
>(nodes: T[]): Array<Omit<T, "rawStatus"> & { enablement: NodeEnablement }> {
  const annotated = annotateNodeEnablements(
    nodes.map((node) => ({
      id: node.logicalNodeId,
      parentId: node.parentLogicalNodeId,
      label: nodeEnablementLabel(node),
      rawStatus: node.rawStatus
    }))
  );
  return nodes.map((node) => {
    const { rawStatus: _rawStatus, ...rest } = node;
    const enablement = annotated.get(node.logicalNodeId) ?? {
      ...classifyStatusRaw(null),
      reachable: true,
      blockingAncestorId: null,
      blockingAncestorLabel: null
    };
    return {
      ...rest,
      enablement
    };
  });
}

/** Attach enablement to source topology nodes keyed by occurrence id / parentOccurrenceId. */
export function withSourceEnablement<
  T extends {
    id: string;
    name: string;
    unitAddress?: string;
    nodePath?: string;
    parentOccurrenceId: string | null;
    rawStatus: string | null;
  }
>(nodes: T[]): Array<Omit<T, "rawStatus"> & { enablement: NodeEnablement }> {
  const annotated = annotateNodeEnablements(
    nodes.map((node) => ({
      id: node.id,
      parentId: node.parentOccurrenceId,
      label: nodeEnablementLabel({ name: node.name, unitAddress: node.unitAddress, locator: node.nodePath }),
      rawStatus: node.rawStatus
    }))
  );
  return nodes.map((node) => {
    const { rawStatus: _rawStatus, ...rest } = node;
    return {
      ...rest,
      enablement: annotated.get(node.id) ?? {
        ...classifyStatusRaw(null),
        reachable: true,
        blockingAncestorId: null,
        blockingAncestorLabel: null
      }
    };
  });
}
