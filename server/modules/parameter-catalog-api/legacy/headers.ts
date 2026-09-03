import {
  CATALOG_DEPRECATION_HEADER,
  CATALOG_LEGACY_CONTRACT_HEADER,
  CATALOG_LINK_HEADER,
  CATALOG_RELEASE_HEADER,
  CATALOG_SUNSET_HEADER,
  CATALOG_WARNING_HEADER,
} from "../../contracts/dtoSchemas/parameterCatalog";

import { LEGACY_SUCCESSOR_PATH, type LegacyHttpHeaders } from "./types";

export const LEGACY_SUCCESSOR_LINK = `<${LEGACY_SUCCESSOR_PATH}>; rel="successor-version"`;
export const LEGACY_DEPRECATION_VALUE = "true";
export const LEGACY_SPEC_CONTRACT = "parameter-spec-v2";
export const LEGACY_MODULE_CONTRACT = "parameter-module-v2";
export const LEGACY_IDENTITY_CONTRACT = "identity-mapping-v2";
export const LEGACY_SPEC_WARNING = '299 WiseEff "Legacy ParameterSpec contract is deprecated"';
export const LEGACY_MODULE_WARNING = '299 WiseEff "Legacy ParameterModule contract is deprecated"';
export const LEGACY_IDENTITY_WARNING = '299 WiseEff "Legacy identity-mapping contract is deprecated"';

export function boundedLegacyHeaders(input: {
  sunsetHttpDate: string;
  contract: string;
  warning: string;
  catalogReleaseId?: string;
}): LegacyHttpHeaders {
  const headers: LegacyHttpHeaders = {
    [CATALOG_DEPRECATION_HEADER]: LEGACY_DEPRECATION_VALUE,
    [CATALOG_SUNSET_HEADER]: input.sunsetHttpDate,
    [CATALOG_LINK_HEADER]: LEGACY_SUCCESSOR_LINK,
    [CATALOG_WARNING_HEADER]: input.warning,
    [CATALOG_LEGACY_CONTRACT_HEADER]: input.contract,
  };
  if (input.catalogReleaseId) {
    headers[CATALOG_RELEASE_HEADER] = input.catalogReleaseId;
  }
  return headers;
}

export function successorLinkHeaders(): LegacyHttpHeaders {
  return { [CATALOG_LINK_HEADER]: LEGACY_SUCCESSOR_LINK };
}
