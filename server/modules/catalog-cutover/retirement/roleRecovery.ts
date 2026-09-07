import { isDeepStrictEqual } from "node:util";
import type { RecoveryRole } from "../../../../ops/self-hosted/storage/recoveryPackage";

export type RetiringRole = {
  oid: string; name: string; login: boolean; inherit: boolean; privileged: boolean;
  members: { name: string; inherit: boolean; set: boolean; admin: boolean }[];
};

/** A precondition on actual SQL observations and an authenticated package, not
 * an authority issuer. Caller-built rows must never reach a role mutation.
 */
export function legacyRolesAreRecoverable(actual: readonly RetiringRole[], packaged: readonly RecoveryRole[]): boolean {
  if (!actual.length || new Set(actual.map(role => role.name)).size !== actual.length || new Set(actual.map(role => role.oid)).size !== actual.length) return false;
  return actual.every(role => {
    const saved = packaged.find(value => value.name === role.name);
    if (!saved || typeof role.oid !== "string" || !/^[1-9][0-9]*$/.test(role.oid) || role.oid === "10"
      || role.privileged !== false || role.login !== true || role.members.some(member => member.admin !== false)) return false;
    const order = (left: { name: string }, right: { name: string }) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
    return isDeepStrictEqual({ name: role.name, login: role.login, inherit: role.inherit,
      members: role.members.map(({ name, inherit, set }) => ({ name, inherit, set })).sort(order) },
    { ...saved, members: [...saved.members].sort(order) });
  });
}
