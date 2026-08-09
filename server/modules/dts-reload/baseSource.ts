import { mergeEphemeralStubWithSource, withEphemeralDanglingAnchorStub } from "../dts";

export interface ReloadBaseSourceMember {
  fileName: string;
  role: string;
  sortOrder: number;
  content: string;
}

/**
 * Build one compile-ready DTS document for a project's configuration set, so the pre-flight gate
 * dry-runs the debug overlay against the same tree the project actually describes: entry file
 * first, then overlay members in manifest order.
 *
 * `&label` overlay members are folded into a single document rather than applied as compiled
 * overlays, because a project primary is often overlay-only and its labels are defined by the
 * ephemeral compile companion (see `danglingAnchorStub.ts`), which cannot be applied to a blob.
 */
export function buildReloadBaseSource(members: readonly ReloadBaseSourceMember[]): string {
  const ordered = [...members].sort(compareMembers);
  if (ordered.length === 0) {
    throw new Error("A reload base device tree needs at least one configuration-set member.");
  }

  const combined = ordered
    .map((member) => member.content)
    .reduce((left, right) => mergeEphemeralStubWithSource(left, right));

  return withEphemeralDanglingAnchorStub(combined);
}

function compareMembers(left: ReloadBaseSourceMember, right: ReloadBaseSourceMember): number {
  const leftEntry = isEntryRole(left.role) ? 0 : 1;
  const rightEntry = isEntryRole(right.role) ? 0 : 1;
  return (
    leftEntry - rightEntry ||
    left.sortOrder - right.sortOrder ||
    left.fileName.localeCompare(right.fileName)
  );
}

function isEntryRole(role: string): boolean {
  return role === "base" || role === "entry" || role === "primary";
}
