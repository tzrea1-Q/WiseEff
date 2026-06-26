import { randomUUID } from "node:crypto";

import { ApiError } from "../../shared/http/errors";
import type { DeviceBridgeRepository } from "./repository";
import { normalizeMachineLabel, pickBridgeToReuse } from "./machineIdentity";
import type { DeviceBridgePlatform } from "./types";
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
};

export function createPairingService(options: PairingServiceOptions) {
  const now = options.now ?? (() => new Date());
  const pairingTtlMs = options.pairingTtlMs ?? DEVICE_BRIDGE_PAIRING_TTL_MS;
  const tokenTtlDays = options.tokenTtlDays ?? DEVICE_BRIDGE_TOKEN_TTL_DAYS;
  const randomCode = options.randomCode ?? generatePairingCode;
  const issueToken = options.issueToken ?? issueBridgeToken;
  const nextBridgeId = options.createBridgeId ?? createBridgeId;

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
      const consumedAt = now();
      const pairing = await options.repo.consumePairingCode({
        codeHash: sha256Hex(input.code),
        consumedAt
      });

      if (!pairing) {
        throw new ApiError(
          "VALIDATION_FAILED",
          "Pairing code is invalid, expired, or already consumed.",
          400
        );
      }

      const machineLabel = normalizeMachineLabel(input.machineLabel);
      const existingBridges = await options.repo.listActiveBridgesForMachine({
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
          await options.repo.revokeBridge({
            bridgeId: bridge.id,
            userId: pairing.userId,
            organizationId: pairing.organizationId,
            revokedAt: consumedAt
          });
        }

        await options.repo.revokeBridgeTokensForBridge({
          bridgeId: reuseBridge.id,
          revokedAt: consumedAt
        });
        await options.repo.updateBridgeClientVersion({
          bridgeId: reuseBridge.id,
          clientVersion: input.clientVersion ?? null
        });
        await options.repo.createBridgeToken({
          id: randomUUID(),
          bridgeId: reuseBridge.id,
          tokenHash: sha256Hex(bridgeToken),
          scopes: defaultBridgeTokenScopes(),
          expiresAt: tokenExpiresAt
        });

        return {
          bridgeId: reuseBridge.id,
          bridgeToken,
          tokenExpiresAt: tokenExpiresAt.toISOString()
        };
      }

      const bridgeId = nextBridgeId();

      await options.repo.createBridge({
        id: bridgeId,
        organizationId: pairing.organizationId,
        userId: pairing.userId,
        machineLabel,
        platform: input.platform,
        arch: input.arch,
        clientVersion: input.clientVersion ?? null
      });

      await options.repo.createBridgeToken({
        id: randomUUID(),
        bridgeId,
        tokenHash: sha256Hex(bridgeToken),
        scopes: defaultBridgeTokenScopes(),
        expiresAt: tokenExpiresAt
      });

      return {
        bridgeId,
        bridgeToken,
        tokenExpiresAt: tokenExpiresAt.toISOString()
      };
    }
  };
}
