import type {
  DebuggingGateway,
  DetectTargetsInput,
  DeviceTarget,
  NodeReadResult,
  NodeWriteResult,
  ReadNodeInput,
  WriteNodeInput
} from "@/application/ports/DebuggingGateway";
import { detectHdcTargets, readNodeValue, writeNodeValue } from "@/hdcClient";

function requireNodePath(input: ReadNodeInput | WriteNodeInput): asserts input is (ReadNodeInput | WriteNodeInput) & { nodePath: string } {
  if (!input.nodePath?.trim()) {
    throw new Error("HDC nodePath is required.");
  }
}

export function createHdcGateway(): DebuggingGateway {
  return {
    async detectTargets(_input?: DetectTargetsInput): Promise<DeviceTarget[]> {
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
      requireNodePath(input);
      return readNodeValue(input);
    },
    async writeNode(input: WriteNodeInput): Promise<NodeWriteResult> {
      requireNodePath(input);
      return writeNodeValue(input);
    }
  };
}
