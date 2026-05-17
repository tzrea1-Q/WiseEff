import type {
  DebuggingGateway,
  DeviceTarget,
  NodeReadResult,
  NodeWriteResult,
  ReadNodeInput,
  WriteNodeInput
} from "@/application/ports/DebuggingGateway";
import { detectHdcTargets, readNodeValue, writeNodeValue } from "@/hdcClient";

export function createHdcGateway(): DebuggingGateway {
  return {
    async detectTargets(): Promise<DeviceTarget[]> {
      const response = await detectHdcTargets();
      if (response.ok === false) {
        throw new Error(response.error || response.stderr || "HDC target detection failed");
      }

      return response.targets.map((target) => ({
        id: target,
        label: target === response.activeTarget ? `${target}（当前）` : target
      }));
    },
    async readNode(input: ReadNodeInput): Promise<NodeReadResult> {
      return readNodeValue(input);
    },
    async writeNode(input: WriteNodeInput): Promise<NodeWriteResult> {
      return writeNodeValue(input);
    }
  };
}
