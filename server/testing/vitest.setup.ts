import { beforeEach } from "vitest";

import { resetParameterIdentityCutoverCache } from "../modules/parameters/cutoverAwareIdentity";

beforeEach(() => {
  resetParameterIdentityCutoverCache();
});
