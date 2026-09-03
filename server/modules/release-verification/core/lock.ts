import { createHash } from "node:crypto";
import type { VerificationPurpose } from "../../parameter-catalog-contract/index";
import type { VerificationSubject } from "./types";

export const subjectKey = (subject: VerificationSubject): string =>
  [subject.targetId, subject.deploymentClass, subject.environmentId].join("\u001f");

export const verificationLockKeys = (
  scope: "prepare" | "run",
  material: string,
): readonly [number, number] => {
  const digest = createHash("sha256").update(`s10-per:${scope}:${material}`).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
};

export const prepareLockMaterial = (
  purpose: VerificationPurpose,
  subject: VerificationSubject,
  phaseSnapshot: string,
): string => [purpose, subjectKey(subject), phaseSnapshot].join("\u001f");
