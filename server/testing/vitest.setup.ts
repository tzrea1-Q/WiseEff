import { beforeEach } from "vitest";

import { setParameterIdentityMode } from "../modules/parameter-kernel/parameterIdentityMode";

beforeEach(() => {
  setParameterIdentityMode(null);
});
