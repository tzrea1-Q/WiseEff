declare module "jszip/lib/zipEntries.js" {
  export default class ZipEntries {
    constructor(options: { decodeFileName: (bytes: Uint8Array) => string });
    files: unknown[];
    load(bytes: Uint8Array): void;
  }
}
