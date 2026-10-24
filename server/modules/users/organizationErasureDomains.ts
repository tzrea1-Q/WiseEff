import type { Database } from "../../shared/database/client";
import type { ObjectStore } from "../logs/objectStore";
import type { ArchiveObjectStore } from "../catalog-cutover/archive";
import type { OrganizationDeletionContext } from "./organizationDeletion";
import { organizationParameterErasure } from "./organizationParameterErasure";
import { knowledgeOrganizationErasure } from "../knowledge/organizationErasure";

/** Actual handles from app composition; absence is unavailable, never a cue to
 * construct/guess a different store from the database or deployment defaults. */
export type OrganizationErasureContext = OrganizationDeletionContext & {
  objectStore?: ObjectStore;
  catalogArchiveStore?: ArchiveObjectStore;
  catalogArchiveKey?: Buffer;
};

/** Four accepted erasure domains, never a dynamic table/SQL cleanup registry.
 * Each adapter must durably stop its producers and finish DB + object cleanup
 * before returning. Account removal runs only after all adapters finish. */
export type OrganizationErasureDomainAdapter = {
  domain: "projects-parameters" | "knowledge" | "logs" | "agent-devices-feedback";
  inventoryCategories: readonly string[];
  erase(db: Database, intent: { id: string; targetOrganizationId: string; actorUserId: string; leaseOwner: string },
    runtime: OrganizationErasureContext & { renewLease(): Promise<void> }): Promise<void>;
};

export const organizationErasureDomains: readonly OrganizationErasureDomainAdapter[] = [knowledgeOrganizationErasure, organizationParameterErasure];
