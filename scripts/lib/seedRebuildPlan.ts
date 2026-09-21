import { createHash } from "node:crypto";
import { z } from "zod";
import { serializeContract } from "../../server/modules/parameter-catalog-contract";

const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const pin = z.object({ id: z.string().min(1), digest }).strict();
export const seedRebuildPlanSchema = z.object({
  version: z.literal(1),
  scope: z.literal("atlas-aurora-nebula"),
  organizationId: z.string().min(1),
  actorUserId: z.string().min(1),
  candidateSha: z.string().regex(/^[a-f0-9]{40}$/),
  database: z.object({
    oid: z.string().regex(/^\d+$/), name: z.string().min(1),
    serverAddress: z.string().min(1), serverPort: z.number().int().positive(),
  }).strict(),
  seedDigest: digest,
  sourceDigest: digest,
  catalog: pin,
  targets: z.array(z.string()),
  inventoryDigest: digest,
}).strict();

export type SeedRebuildPlan = z.infer<typeof seedRebuildPlanSchema>;
export type SealedSeedRebuildPlan = SeedRebuildPlan & { digest: string };

export function seedRebuildDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(serializeContract(value as never)).digest("hex")}`;
}

export function sealSeedRebuildPlan(input: SeedRebuildPlan): SealedSeedRebuildPlan {
  const plan = seedRebuildPlanSchema.parse(input);
  if (plan.targets.slice().sort().join(",") !== "atlas,aurora,nebula") {
    throw new Error("seed-rebuild-scope-mismatch");
  }
  return { ...plan, digest: seedRebuildDigest(plan) };
}

export function confirmSeedRebuildPlan(
  stored: unknown, confirmedDigest: string, observed: SeedRebuildPlan,
): SealedSeedRebuildPlan {
  const parsed = seedRebuildPlanSchema.extend({ digest }).strict().parse(stored);
  const { digest: storedDigest, ...payload } = parsed;
  const sealed = sealSeedRebuildPlan(payload);
  if (sealed.digest !== storedDigest || storedDigest !== confirmedDigest) {
    throw new Error("seed-rebuild-plan-confirmation-mismatch");
  }
  if (sealed.digest !== sealSeedRebuildPlan(observed).digest) {
    throw new Error("seed-rebuild-plan-observation-drift");
  }
  return sealed;
}
