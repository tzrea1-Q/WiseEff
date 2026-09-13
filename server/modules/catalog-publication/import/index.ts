export {
  allocateOpaqueId,
  importVendorCatalog,
  vendorImpactFacts,
} from "./vendorAdapter";
export type {
  ClaimedVendorIdentity,
  ImportVendorCatalogInput,
  VendorAppliedDriverDefault,
  VendorConversionReport,
  VendorDisposition,
  VendorIdKind,
  VendorIdentityOptions,
  VendorImportError,
  VendorImportValue,
} from "./vendorAdapter";
export {
  EXCLUDED_SCHEMA_BASENAMES,
  POWER_MANAGEMENT_BASENAME,
  hashListedSchemaPaths,
  inventoryVendorCatalog,
  vendorDirectoryHash,
  vendorValueSchemaFor,
} from "./vendorYaml";
export type {
  VendorCatalogInventory,
  VendorInventoryError,
  VendorInventoryResult,
} from "./vendorYaml";
