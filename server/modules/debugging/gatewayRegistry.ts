import { ApiError } from "../../shared/http/errors";
import type { DebugDeviceGateway } from "./gateway";
import type { DebugConnectionProtocol } from "./protocol";

export type DebugDeviceGatewayRegistry = {
  requireGateway(protocol: DebugConnectionProtocol): DebugDeviceGateway;
  hasGateway(protocol: DebugConnectionProtocol): boolean;
};

export function createDebugDeviceGatewayRegistry(
  gateways: Partial<Record<DebugConnectionProtocol, DebugDeviceGateway>>
): DebugDeviceGatewayRegistry {
  return {
    requireGateway(protocol) {
      const gateway = gateways[protocol];
      if (!gateway) {
        throw new ApiError("PROTOCOL_UNSUPPORTED", `Debug protocol ${protocol} is not enabled.`, 409, { protocol });
      }
      return gateway;
    },
    hasGateway(protocol) {
      return Boolean(gateways[protocol]);
    }
  };
}
