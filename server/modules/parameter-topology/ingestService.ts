import { createHash, randomUUID } from "node:crypto";

import type { AuthContext } from "../auth/types";
import {
  parseDts,
  resolveDtsConfigSet,
  type DtsConfigSetFile,
  type DtsEffectiveNode,
  type DtsNodeCst,
  type DtsPropertyCst,
  type DtsSourceChainEntry,
} from "../dts";
import type { Database, Queryable } from "../../shared/database/client";
import {
  insertConfigRevision,
  insertConfigRevisionMembers,
  insertLogicalNode,
  insertLogicalNodeRevision,
  insertNodeOccurrence,
  insertOccurrenceEffect,
  insertPropertyOccurrence,
  insertValidationDiagnostics,
  insertValidationRun,
  nextConfigRevisionNumber,
  updateConfigRevisionStatus,
} from "./repository";
import type {
  ConfigRevisionManifest,
  DtsConfigRevisionDto,
  LineColumn,
  PersistedLogicalNodeRevision,
  PersistedNodeOccurrence,
  PersistedPropertyOccurrence,
} from "./types";

export function offsetToLineColumn(source: string, offset: number): LineColumn {
  let line = 1;
  let column = 1;
  const end = Math.min(Math.max(offset, 0), source.length);
  for (let i = 0; i < end; i += 1) {
    if (source[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Locator with leading slash (`/` for root), matching `resolveDtsConfigSet` display paths. */
function displayLocator(locator: string): string {
  return locator === "" ? "/" : locator.startsWith("/") ? locator : `/${locator}`;
}

function segmentFor(node: Pick<DtsNodeCst, "name" | "unitAddress" | "refTarget" | "isOverlayRoot">): string {
  if (node.isOverlayRoot) return "";
  if (node.refTarget) return node.refTarget;
  if (node.unitAddress !== undefined) return `${node.name}@${node.unitAddress}`;
  return node.name;
}

function joinLocator(parent: string, segment: string): string {
  if (!segment) return parent;
  if (!parent) return segment;
  return `${parent}/${segment}`;
}

function parentLocator(locator: string): string | null {
  if (locator === "/") return null;
  const trimmed = locator.startsWith("/") ? locator.slice(1) : locator;
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) return "/";
  return `/${trimmed.slice(0, idx)}`;
}

type PropertyMatchKey = string;

function propertyMatchKey(
  fileName: string,
  nodeLocator: string,
  propertyName: string,
  rawText: string,
): PropertyMatchKey {
  return `${fileName}\0${nodeLocator}\0${propertyName}\0${rawText}`;
}

type CollectedOccurrences = {
  nodes: PersistedNodeOccurrence[];
  properties: PersistedPropertyOccurrence[];
  propertyQueues: Map<PropertyMatchKey, string[]>;
  nodeByPathAndFile: Map<string, string>;
  nodeIdByPropertyId: Map<string, string>;
};

function collectFileOccurrences(
  fileName: string,
  fileVersionId: string,
  content: string,
): CollectedOccurrences {
  const doc = parseDts(content);
  const nodes: PersistedNodeOccurrence[] = [];
  const properties: PersistedPropertyOccurrence[] = [];
  const propertyQueues = new Map<PropertyMatchKey, string[]>();
  const nodeByPathAndFile = new Map<string, string>();
  const nodeIdByPropertyId = new Map<string, string>();
  let nodeOrder = 0;
  let propertyOrder = 0;

  const walk = (cst: DtsNodeCst, parentLocatorNoSlash: string, parentOccurrenceId: string | null) => {
    const locatorNoSlash = cst.refTarget
      ? joinLocator(parentLocatorNoSlash, cst.refTarget)
      : joinLocator(parentLocatorNoSlash, segmentFor(cst));
    const nodePath = displayLocator(locatorNoSlash);
    const start = offsetToLineColumn(content, cst.span.start);
    const end = offsetToLineColumn(content, cst.span.end);
    const rawText = content.slice(cst.span.start, cst.span.end);
    const id = randomUUID();

    nodes.push({
      id,
      fileVersionId,
      parentOccurrenceId,
      name: cst.isOverlayRoot ? "/" : cst.refTarget ? cst.refTarget : cst.name,
      unitAddress: cst.unitAddress,
      labels: [...cst.labels],
      refTarget: cst.refTarget,
      isOverlayRoot: cst.isOverlayRoot,
      nodePath,
      startOffset: cst.span.start,
      endOffset: cst.span.end,
      startLine: start.line,
      startColumn: start.column,
      endLine: end.line,
      endColumn: end.column,
      rawText,
      astJson: {
        kind: "node",
        labels: cst.labels,
        refTarget: cst.refTarget,
        isOverlayRoot: cst.isOverlayRoot,
      },
      sourceOrder: nodeOrder,
      contentHash: contentHash(rawText),
    });
    nodeOrder += 1;
    nodeByPathAndFile.set(`${fileName}\0${nodePath}`, id);

    for (const child of cst.children) {
      if (child.kind === "property") {
        collectProperty(child, id, nodePath);
      } else if (child.kind === "node") {
        walk(child, locatorNoSlash, id);
      }
    }
  };

  function collectProperty(prop: DtsPropertyCst, nodeOccurrenceId: string, ownerPath: string) {
    const propStart = offsetToLineColumn(content, prop.span.start);
    const propEnd = offsetToLineColumn(content, prop.span.end);
    const propId = randomUUID();
    properties.push({
      id: propId,
      nodeOccurrenceId,
      fileVersionId,
      propertyName: prop.name,
      startOffset: prop.span.start,
      endOffset: prop.span.end,
      startLine: propStart.line,
      startColumn: propStart.column,
      endLine: propEnd.line,
      endColumn: propEnd.column,
      rawText: prop.rawText,
      astJson: prop.value ?? { kind: "raw", valueType: prop.valueType },
      sourceOrder: propertyOrder,
      contentHash: contentHash(prop.rawText),
    });
    propertyOrder += 1;
    nodeIdByPropertyId.set(propId, nodeOccurrenceId);
    const key = propertyMatchKey(fileName, ownerPath, prop.name, prop.rawText);
    const queue = propertyQueues.get(key) ?? [];
    queue.push(propId);
    propertyQueues.set(key, queue);
  }

  for (const top of doc.topLevel) {
    walk(top, "", null);
  }

  return { nodes, properties, propertyQueues, nodeByPathAndFile, nodeIdByPropertyId };
}

function takePropertyOccurrenceId(
  queues: Map<PropertyMatchKey, string[]>,
  entry: DtsSourceChainEntry,
): string | null {
  const key = propertyMatchKey(entry.fileName, entry.nodeLocator, entry.propertyName, entry.rawText);
  const queue = queues.get(key);
  if (queue && queue.length > 0) {
    return queue.shift() ?? null;
  }
  const loosePrefix = `${entry.fileName}\0${entry.nodeLocator}\0${entry.propertyName}\0`;
  for (const [candidateKey, candidateQueue] of queues) {
    if (candidateKey.startsWith(loosePrefix) && candidateQueue.length > 0) {
      return candidateQueue.shift() ?? null;
    }
  }
  return null;
}

function buildLogicalRevisions(
  effectiveNodes: Map<string, DtsEffectiveNode>,
  organizationId: string,
  projectId: string,
  configSetId: string,
): {
  logicalNodes: Array<{ id: string; organizationId: string; projectId: string; configSetId: string }>;
  revisions: PersistedLogicalNodeRevision[];
  revisionByLocator: Map<string, PersistedLogicalNodeRevision>;
} {
  const logicalNodes: Array<{ id: string; organizationId: string; projectId: string; configSetId: string }> = [];
  const revisions: PersistedLogicalNodeRevision[] = [];
  const revisionByLocator = new Map<string, PersistedLogicalNodeRevision>();
  const logicalIdByLocator = new Map<string, string>();

  const sorted = [...effectiveNodes.values()].sort((a, b) => a.nodeLocator.localeCompare(b.nodeLocator));
  for (const node of sorted) {
    const logicalNodeId = randomUUID();
    logicalIdByLocator.set(node.nodeLocator, logicalNodeId);
    logicalNodes.push({ id: logicalNodeId, organizationId, projectId, configSetId });
  }

  for (const node of sorted) {
    const logicalNodeId = logicalIdByLocator.get(node.nodeLocator)!;
    const parentLoc = parentLocator(node.nodeLocator);
    const compatibleProp = node.properties.get("compatible");
    const revision: PersistedLogicalNodeRevision = {
      id: randomUUID(),
      logicalNodeId,
      nodeLocator: node.nodeLocator,
      name: node.name,
      unitAddress: node.unitAddress,
      compatible:
        compatibleProp && !compatibleProp.deleted
          ? compatibleProp.normalizedValue || compatibleProp.rawText
          : undefined,
      parentLogicalNodeId: parentLoc ? (logicalIdByLocator.get(parentLoc) ?? null) : null,
    };
    revisions.push(revision);
    revisionByLocator.set(node.nodeLocator, revision);
  }

  return { logicalNodes, revisions, revisionByLocator };
}

/**
 * Persist one immutable config-set revision: members, source occurrences, logical nodes,
 * provenance effects, and resolve-stage diagnostics. Never mutates a previous revision.
 */
export async function ingestConfigRevision(
  db: Database,
  manifest: ConfigRevisionManifest,
  auth: AuthContext,
): Promise<DtsConfigRevisionDto> {
  return db.transaction(async (tx) => ingestConfigRevisionInTransaction(tx, manifest, auth));
}

/** Same as `ingestConfigRevision` but for callers already inside a DB transaction. */
export async function ingestConfigRevisionInTransaction(
  tx: Queryable,
  manifest: ConfigRevisionManifest,
  auth: AuthContext,
): Promise<DtsConfigRevisionDto> {
  return ingestConfigRevisionTx(tx, manifest, auth);
}

async function ingestConfigRevisionTx(
  tx: Queryable,
  manifest: ConfigRevisionManifest,
  auth: AuthContext,
): Promise<DtsConfigRevisionDto> {
  const revisionNumber = await nextConfigRevisionNumber(tx, manifest.configSetId);
  let revision = await insertConfigRevision(tx, {
    id: randomUUID(),
    organizationId: manifest.organizationId,
    projectId: manifest.projectId,
    configSetId: manifest.configSetId,
    revisionNumber,
    status: "resolving",
    createdByUserId: auth.user.id,
  });

  await insertConfigRevisionMembers(tx, revision.id, manifest.members);

  const files = new Map<string, DtsConfigSetFile>();
  for (const member of manifest.members) {
    files.set(member.fileName, {
      fileVersionId: member.fileVersionId,
      content: member.content,
    });
  }

  const resolved = resolveDtsConfigSet({
    entryFile: manifest.entryFile,
    includeSearchPaths: manifest.includeSearchPaths,
    overlayOrder: manifest.overlayOrder,
    files,
  });

  const hasErrors = resolved.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const runId = randomUUID();
  await insertValidationRun(tx, {
    id: runId,
    organizationId: manifest.organizationId,
    configRevisionId: revision.id,
    stage: "resolve",
    status: hasErrors ? "failed" : "passed",
  });
  await insertValidationDiagnostics(
    tx,
    runId,
    resolved.diagnostics.map((diagnostic) => ({
      ...diagnostic,
      id: randomUUID(),
      stage: "resolve",
    })),
  );

  if (hasErrors) {
    revision = await updateConfigRevisionStatus(tx, {
      id: revision.id,
      status: "invalid",
      resolvedAt: new Date().toISOString(),
    });
    return revision;
  }

  const mergedQueues = new Map<PropertyMatchKey, string[]>();
  const nodeByPathAndFile = new Map<string, string>();
  const nodeIdByPropertyId = new Map<string, string>();

  for (const member of manifest.members) {
    const collected = collectFileOccurrences(member.fileName, member.fileVersionId, member.content);
    for (const node of collected.nodes) {
      await insertNodeOccurrence(tx, revision.id, node);
    }
    for (const property of collected.properties) {
      await insertPropertyOccurrence(tx, revision.id, property);
    }
    for (const [key, queue] of collected.propertyQueues) {
      const existing = mergedQueues.get(key) ?? [];
      existing.push(...queue);
      mergedQueues.set(key, existing);
    }
    for (const [key, id] of collected.nodeByPathAndFile) {
      nodeByPathAndFile.set(key, id);
    }
    for (const [propId, nodeId] of collected.nodeIdByPropertyId) {
      nodeIdByPropertyId.set(propId, nodeId);
    }
  }

  const { logicalNodes, revisions, revisionByLocator } = buildLogicalRevisions(
    resolved.effective.nodesByLocator,
    manifest.organizationId,
    manifest.projectId,
    manifest.configSetId,
  );

  for (const logical of logicalNodes) {
    await insertLogicalNode(tx, logical);
  }
  for (const logicalRevision of revisions) {
    await insertLogicalNodeRevision(tx, revision.id, logicalRevision);
  }

  let effectOrder = 0;
  for (const node of resolved.effective.nodesByLocator.values()) {
    const logicalRevision = revisionByLocator.get(node.nodeLocator);
    if (!logicalRevision) continue;

    for (const property of node.properties.values()) {
      for (const entry of property.sourceChain) {
        const propertyOccurrenceId = takePropertyOccurrenceId(mergedQueues, entry);
        const nodeOccurrenceId =
          (propertyOccurrenceId ? nodeIdByPropertyId.get(propertyOccurrenceId) : undefined) ??
          nodeByPathAndFile.get(`${entry.fileName}\0${entry.nodeLocator}`) ??
          null;

        await insertOccurrenceEffect(tx, revision.id, {
          id: randomUUID(),
          logicalNodeRevisionId: logicalRevision.id,
          propertyName: entry.propertyName,
          effectKind: entry.effect,
          nodeOccurrenceId,
          propertyOccurrenceId,
          sourceOrder: effectOrder,
        });
        effectOrder += 1;
      }
    }
  }

  revision = await updateConfigRevisionStatus(tx, {
    id: revision.id,
    status: "resolved",
    resolvedAt: new Date().toISOString(),
  });
  return revision;
}
