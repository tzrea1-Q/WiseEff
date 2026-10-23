import { randomUUID } from "node:crypto";

import { createSystemInvocation } from "../auth/trustedInvocation";

import { ApiError } from "../../shared/http/errors";
import { createDeviceBridgeRepository, type DeviceBridgeRepository } from "./repository";
import { normalizeMachineLabel, pickBridgeToReuse } from "./machineIdentity";
import type { DeviceBridgePlatform } from "./types";
import type { Database } from "../../shared/database/client";
import { writeTrustedMilestoneAudit } from "../audit/auditedWrite";
import {
  bridgeTokenExpiresAt,
  createBridgeId,
  defaultBridgeTokenScopes,
  DEVICE_BRIDGE_PAIRING_TTL_MS,
  DEVICE_BRIDGE_TOKEN_TTL_DAYS,
  generatePairingCode,
  issueBridgeToken,
  sha256Hex
} from "./token";

export type PairingService = ReturnType<typeof createPairingService>;

export type PairingServiceOptions = {
  repo: DeviceBridgeRepository;
  now?: () => Date;
  pairingTtlMs?: number;
  tokenTtlDays?: number;
  randomCode?: () => string;
  issueToken?: () => string;
  createBridgeId?: () => string;
  db?: Database;
  writeAuditEvent?: typeof writeTrustedMilestoneAudit;
};

export function createPairingService(options: PairingServiceOptions) {
  const now = options.now ?? (() => new Date());
  const pairingTtlMs = options.pairingTtlMs ?? DEVICE_BRIDGE_PAIRING_TTL_MS;
  const tokenTtlDays = options.tokenTtlDays ?? DEVICE_BRIDGE_TOKEN_TTL_DAYS;
  const randomCode = options.randomCode ?? generatePairingCode;
  const issueToken = options.issueToken ?? issueBridgeToken;
  const nextBridgeId = options.createBridgeId ?? createBridgeId;
  const writeAudit = options.writeAuditEvent ?? writeTrustedMilestoneAudit;

  async function auditPair(
    bridgeId: string,
    pairing: { userId: string; organizationId: string },
    platform: string,
    arch: string,
    db: Database | undefined
  ) {
    if (!db) {
      return;
    }
    await writeAudit(db, {
      id: randomUUID(),
      organizationId: pairing.organizationId,
      projectId: null,
      invocation: createSystemInvocation({ kind: "service", name: "device-bridge-pairing" }),
      app: "device-bridge",
      kind: "device-bridge-pair",
      action: "create",
      severity: "High",
      targetType: "device-bridge",
      targetId: bridgeId,
      metadata: { platform, arch, pairingUserId: pairing.userId },
      traceId: randomUUID()
    });
  }

  return {
    async issuePairingCode(input: { userId: string; organizationId: string }) {
      const code = randomCode();
      const expiresAt = new Date(now().getTime() + pairingTtlMs);

      await options.repo.createPairingCode({
        id: randomUUID(),
        organizationId: input.organizationId,
        userId: input.userId,
        codeHash: sha256Hex(code),
        expiresAt
      });

      return {
        code,
        expiresAt: expiresAt.toISOString()
      };
    },

    async pairWithCode(input: {
      code: string;
      machineLabel: string;
      platform: DeviceBridgePlatform;
      arch: string;
      clientVersion?: string;
    }) {
      const pair = async (repo: DeviceBridgeRepository, db?: Database) => {
        const consumedAt = now();
        const pairing = await repo.consumePairingCode({
          codeHash: sha256Hex(input.code),
          consumedAt
        });

        if (!pairing) {
          throw new ApiError(
            "VALIDATION_FAILED",
            "Pairing code is invalid, expired, or already consumed."
          );
        }

        const machineLabel = normalizeMachineLabel(input.machineLabel);
        const existingBridges = await repo.listActiveBridgesForMachine({
          userId: pairing.userId,
          organizationId: pairing.organizationId,
          machineLabel,
          platform: input.platform,
          arch: input.arch
        });

        const bridgeToken = issueToken();
        const tokenExpiresAt = bridgeTokenExpiresAt(consumedAt, tokenTtlDays);

        if (existingBridges.length > 0) {
          const reuseBridge = pickBridgeToReuse(existingBridges);

          for (const bridge of existingBridges) {
            if (bridge.id === reuseBridge.id) {
              continue;
            }
            await repo.revokeBridge({
              bridgeId: bridge.id,
              userId: pairing.userId,
              organizationId: pairing.organizationId,
              revokedAt: consumedAt
            });
          }

          await repo.revokeBridgeTokensForBridge({
            bridgeId: reuseBridge.id,
            revokedAt: consumedAt
          });
          await repo.updateBridgeClientVersion({
            bridgeId: reuseBridge.id,
            clientVersion: input.clientVersion ?? null
          });
          await repo.createBridgeToken({
            id: randomUUID(),
            bridgeId: reuseBridge.id,
            tokenHash: sha256Hex(bridgeToken),
            scopes: defaultBridgeTokenScopes(),
            expiresAt: tokenExpiresAt
          });

          await auditPair(reuseBridge.id, pairing, input.platform, input.arch, db);

          return {
            bridgeId: reuseBridge.id,
            bridgeToken,
            tokenExpiresAt: tokenExpiresAt.toISOString()
          };
        }

        const bridgeId = nextBridgeId();

        await repo.createBridge({
          id: bridgeId,
          organizationId: pairing.organizationId,
          userId: pairing.userId,
          machineLabel,
          platform: input.platform,
          arch: input.arch,
          clientVersion: input.clientVersion ?? null
        });

        await repo.createBridgeToken({
          id: randomUUID(),
          bridgeId,
          tokenHash: sha256Hex(bridgeToken),
          scopes: defaultBridgeTokenScopes(),
          expiresAt: tokenExpiresAt
        });

        await auditPair(bridgeId, pairing, input.platform, input.arch, db);

        return {
          bridgeId,
          bridgeToken,
          tokenExpiresAt: tokenExpiresAt.toISOString()
        };
      };
      return options.db ? options.db.transaction(tx => pair(createDeviceBridgeRepository(tx), tx)) : pair(options.repo);
    }
  };
}
