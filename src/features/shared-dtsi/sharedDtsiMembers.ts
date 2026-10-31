import type { SharedDtsiDraftInput } from "@wiseeff/dto-schemas";

type Member = NonNullable<SharedDtsiDraftInput["members"]>[number];

export const sourceMembers = (input: SharedDtsiDraftInput): Member[] => input.members ?? [{ sourceName: input.sourceName, content: input.content }];
export const withContent = (input: SharedDtsiDraftInput, index: number, content: string): SharedDtsiDraftInput => ({ ...input, content,
  ...(input.members ? { members: input.members.map((member, at) => at === index ? { ...member, content } : member) } : {}) });

export const hasMemberPath = (members: readonly Member[], path: string, exceptIndex = -1) =>
  members.some((member, index) => index !== exceptIndex && member.sourceName.normalize("NFC") === path.normalize("NFC"));

export const hasDuplicateMemberPaths = (members: readonly Member[]) =>
  new Set(members.map(member => member.sourceName.normalize("NFC"))).size !== members.length;

export const conflictingMembers = (existing: readonly Member[], incoming: readonly Member[]) =>
  incoming.filter(member => hasMemberPath(existing, member.sourceName));

export function mergeSourceMembers(existing: readonly Member[], incoming: readonly Member[]): Member[] {
  const merged = existing.map(old => {
    const next = incoming.find(member => member.sourceName.normalize("NFC") === old.sourceName.normalize("NFC"));
    return next ? { ...old, content: next.content } : old;
  });
  merged.push(...incoming.filter(member => !hasMemberPath(existing, member.sourceName)));
  return merged;
}
