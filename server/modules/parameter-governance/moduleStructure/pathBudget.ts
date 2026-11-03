import { ApiError } from "../../../shared/http/errors";

// The 2560-byte budget includes the organization, index tuple overhead and margin
// below PostgreSQL's 2704-byte btree tuple ceiling on an 8 KiB page. It does not
// assume text compression. Existing unchanged paths are deliberately exempt.
export function validateChangedPaths(organizationId: string, parents: Map<string, string | null>,
  rows: { id: string; path: string }[], changes: { moduleId: string; field: string }[]) {
  const created = new Set(changes.filter(change => change.field === "create").map(change => change.moduleId));
  const affected = new Set(changes.filter(change => change.field === "create" || change.field === "parentRef").map(change => change.moduleId));
  if (!affected.size) return;
  const children = new Map<string, string[]>();
  for (const [id, parent] of parents) if (parent) {
    const siblings = children.get(parent) ?? []; siblings.push(id); children.set(parent, siblings);
  }
  const queue = [...affected];
  for (let index = 0; index < queue.length; index++) for (const child of children.get(queue[index]!) ?? []) {
    if (!affected.has(child)) { affected.add(child); queue.push(child); }
  }
  const lengths = new Map(rows.filter(row => !affected.has(row.id)).map(row => [row.id, Buffer.byteLength(row.path)]));
  for (const id of affected) {
    const pending: string[] = []; let node: string | null = id;
    while (node && !lengths.has(node)) { pending.push(node); node = parents.get(node) ?? null; }
    let length = node ? lengths.get(node)! : 0;
    while (pending.length) {
      const current = pending.pop()!;
      length += (length ? 1 : 0) + (created.has(current) ? 36 : Buffer.byteLength(current));
      if (length + Buffer.byteLength(organizationId) + 32 > 2560)
        throw new ApiError("VALIDATION_FAILED", "The resulting encoded path exceeds the safe transfer limit.");
      lengths.set(current, length);
    }
  }
}
