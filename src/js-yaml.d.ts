declare module "js-yaml" {
  const yaml: {
    load(input: string, options?: unknown): unknown;
    dump(input: unknown, options?: unknown): string;
  };
  export default yaml;
}
