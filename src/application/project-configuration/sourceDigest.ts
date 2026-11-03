import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

/** Match the server's UTF-8 SHA-256 digest, including on HTTP self-hosted origins. */
export function digestSourceText(source: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(source)));
}
