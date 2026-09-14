export const isEphemeralTestDatabaseName = (name: string): boolean => {
  if (name.startsWith("wiseeff_test_wk_")) {
    return true;
  }
  return /^wiseeff_[a-z0-9]+_\d+_\d+$/i.test(name);
};
