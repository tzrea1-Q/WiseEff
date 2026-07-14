import { parseDts } from "./parser";
import type { DtsDocument, DtsNodeCst, DtsPropertyCst, DtsValueType } from "./types";

export interface ResolvedPhandleRef {
  fromProperty: string;
  targetLabel: string;
}

export interface ResolvedProperty {
  name: string;
  valueType: DtsValueType;
  rawText: string;
  normalizedValue: string;
  /** Back-reference for CST writeback mutations. */
  cst: DtsPropertyCst;
}

export interface ResolvedNode {
  nodePath: string;
  name: string;
  unitAddress?: string;
  labels: string[];
  compatible?: string;
  status?: string;
  properties: ResolvedProperty[];
  phandleRefs: ResolvedPhandleRef[];
  cst: DtsNodeCst;
}

export interface ResolvedDts {
  nodes: ResolvedNode[];
}

interface MutableNode {
  nodePath: string;
  name: string;
  unitAddress?: string;
  labels: Set<string>;
  properties: Map<string, ResolvedProperty>;
  phandleRefs: ResolvedPhandleRef[];
  cst: DtsNodeCst;
  isLabelStub: boolean;
}

function segmentFor(node: Pick<DtsNodeCst, "name" | "unitAddress" | "refTarget" | "isOverlayRoot">): string {
  if (node.isOverlayRoot) return "";
  if (node.refTarget) return node.refTarget;
  if (node.unitAddress !== undefined) return `${node.name}@${node.unitAddress}`;
  return node.name;
}

function joinPath(parent: string, segment: string): string {
  if (!segment) return parent;
  if (!parent) return segment;
  return `${parent}/${segment}`;
}

function extractPhandles(rawText: string): string[] {
  const labels: string[] = [];
  const re = /&([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawText)) !== null) {
    labels.push(m[1]);
  }
  return labels;
}

class Resolver {
  private readonly byPath = new Map<string, MutableNode>();
  private readonly byLabel = new Map<string, MutableNode>();

  resolve(doc: DtsDocument): ResolvedDts {
    for (const node of doc.topLevel) {
      this.ingestNode(node, "");
    }
    return { nodes: this.flatten() };
  }

  private ingestNode(cst: DtsNodeCst, parentPath: string): MutableNode {
    let node: MutableNode;

    if (cst.refTarget) {
      const existing = this.byLabel.get(cst.refTarget);
      if (existing) {
        node = existing;
        node.cst = cst;
      } else {
        const path = joinPath(parentPath, cst.refTarget);
        node = this.ensurePath(path, {
          name: cst.refTarget,
          unitAddress: undefined,
          cst,
          isLabelStub: true,
        });
        this.registerLabel(cst.refTarget, node);
      }
    } else {
      const path = joinPath(parentPath, segmentFor(cst));
      let adopted: MutableNode | undefined;
      for (const label of cst.labels) {
        const existing = this.byLabel.get(label);
        if (existing?.isLabelStub) {
          adopted = existing;
          break;
        }
      }
      if (adopted) {
        this.repath(adopted, path, cst);
        node = adopted;
      } else {
        node = this.ensurePath(path, {
          name: cst.isOverlayRoot ? "/" : cst.name,
          unitAddress: cst.unitAddress,
          cst,
          isLabelStub: false,
        });
      }
      for (const label of cst.labels) {
        this.registerLabel(label, node);
      }
    }

    for (const child of cst.children) {
      if (child.kind === "property") {
        this.ingestProperty(node, child);
      } else {
        this.ingestNode(child, node.nodePath);
      }
    }

    return node;
  }

  private ensurePath(
    path: string,
    init: { name: string; unitAddress?: string; cst: DtsNodeCst; isLabelStub: boolean },
  ): MutableNode {
    const existing = this.byPath.get(path);
    if (existing) {
      existing.cst = init.cst;
      if (!init.isLabelStub) {
        existing.name = init.name;
        existing.unitAddress = init.unitAddress;
        existing.isLabelStub = false;
      }
      return existing;
    }
    const node: MutableNode = {
      nodePath: path,
      name: init.name,
      unitAddress: init.unitAddress,
      labels: new Set(),
      properties: new Map(),
      phandleRefs: [],
      cst: init.cst,
      isLabelStub: init.isLabelStub,
    };
    this.byPath.set(path, node);
    return node;
  }

  private repath(node: MutableNode, newPath: string, cst: DtsNodeCst): void {
    if (node.nodePath === newPath) {
      node.cst = cst;
      node.isLabelStub = false;
      node.name = cst.isOverlayRoot ? "/" : cst.name;
      node.unitAddress = cst.unitAddress;
      return;
    }
    const oldPrefix = node.nodePath;
    this.byPath.delete(oldPrefix);
    node.nodePath = newPath;
    node.name = cst.isOverlayRoot ? "/" : cst.name;
    node.unitAddress = cst.unitAddress;
    node.cst = cst;
    node.isLabelStub = false;
    this.byPath.set(newPath, node);

    for (const [path, other] of [...this.byPath.entries()]) {
      if (path !== newPath && (path === oldPrefix || path.startsWith(`${oldPrefix}/`))) {
        this.byPath.delete(path);
        other.nodePath = newPath + path.slice(oldPrefix.length);
        this.byPath.set(other.nodePath, other);
      }
    }
  }

  private registerLabel(label: string, node: MutableNode): void {
    node.labels.add(label);
    const existing = this.byLabel.get(label);
    if (existing && existing !== node) {
      this.mergeNodes(node, existing);
    }
    this.byLabel.set(label, node);
  }

  private mergeNodes(target: MutableNode, source: MutableNode): void {
    if (target === source) return;
    for (const label of source.labels) {
      target.labels.add(label);
      this.byLabel.set(label, target);
    }
    for (const [name, prop] of source.properties) {
      if (!target.properties.has(name)) {
        target.properties.set(name, prop);
      }
    }
    target.phandleRefs.push(...source.phandleRefs.filter((r) => !target.phandleRefs.some((t) => t.fromProperty === r.fromProperty && t.targetLabel === r.targetLabel)));
    this.byPath.delete(source.nodePath);
  }

  private ingestProperty(node: MutableNode, prop: DtsPropertyCst): void {
    node.properties.set(prop.name, {
      name: prop.name,
      valueType: prop.valueType,
      rawText: prop.rawText,
      normalizedValue: prop.normalizedValue,
      cst: prop,
    });
    node.phandleRefs = node.phandleRefs.filter((r) => r.fromProperty !== prop.name);
    for (const targetLabel of extractPhandles(prop.rawText)) {
      node.phandleRefs.push({ fromProperty: prop.name, targetLabel });
    }
  }

  private flatten(): ResolvedNode[] {
    const nodes: ResolvedNode[] = [];
    for (const node of this.byPath.values()) {
      let compatible: string | undefined;
      let status: string | undefined;
      const compat = node.properties.get("compatible");
      if (compat) {
        const first = compat.normalizedValue.match(/"((?:\\.|[^"\\])*)"/);
        compatible = first ? first[1] : compat.normalizedValue;
      }
      const st = node.properties.get("status");
      if (st) {
        const first = st.normalizedValue.match(/"((?:\\.|[^"\\])*)"/);
        status = first ? first[1] : st.normalizedValue;
      }
      nodes.push({
        nodePath: node.nodePath,
        name: node.name,
        unitAddress: node.unitAddress,
        labels: [...node.labels],
        compatible,
        status,
        properties: [...node.properties.values()],
        phandleRefs: [...node.phandleRefs],
        cst: node.cst,
      });
    }
    nodes.sort((a, b) => a.nodePath.localeCompare(b.nodePath));
    return nodes;
  }
}

export function resolveDts(input: DtsDocument | string): ResolvedDts {
  const doc = typeof input === "string" ? parseDts(input) : input;
  return new Resolver().resolve(doc);
}
