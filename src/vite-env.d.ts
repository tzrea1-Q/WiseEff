declare module "node:fs" {
  export const promises: {
    writeFile(path: string, data: string, encoding: string): Promise<void>;
  };
}

declare module "node:path" {
  const path: {
    resolve(...paths: string[]): string;
  };
  export default path;
}
