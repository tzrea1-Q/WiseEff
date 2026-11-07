declare module "jszip/lib/zipEntries.js" {
  export default class ZipEntries {
    constructor(options: { decodeFileName: (bytes: Uint8Array) => string });
    files: unknown[];
    load(bytes: Uint8Array): void;
  }
}

declare module "jszip/lib/crc32.js" {
  export default function crc32(bytes: Uint8Array, previous?: number): number;
}
