/** Internal test/CI escape hatch; not part of ServerEnv or .env.example. */
export function isXiaozeDeterministicMode() {
  return process.env.XIAOZE_DETERMINISTIC === "true";
}
