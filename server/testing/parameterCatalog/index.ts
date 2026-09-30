export {
  S2_SCH_0137_FINGERPRINT,
  S2_SCH_CONTRACT_FINGERPRINT,
  S2_SCH_0171_FINGERPRINT,
  S2_SCH_0176_FINGERPRINT,
  S2_SCH_0179_FINGERPRINT,
  S2_SCH_0180_FINGERPRINT,
  S2_SCH_0181_FINGERPRINT,
  S2_SCH_LIVE_FINGERPRINT,
  assertCheckedEmptyCatalog,
  assertCheckedEmptyDatabase,
  assertRealPostgresUrl,
  cleanupLeftoverParameterCatalogDatabases,
  connectionStringFor,
  countUserDefinedObjects,
  createCheckedEmptyDatabase,
  createDisposableParameterCatalogDatabase,
  databaseNameFromUrl,
  parameterCatalogRunDatabasePrefix,
  parameterCatalogWorkerDatabasePrefix,
  readCanonicalSchemaFingerprint,
  readCatalogServerIdentity,
  resolveCatalogDatabaseUrl,
  type CatalogServerIdentity,
  type ParameterCatalogDatabase,
} from "./database";

export {
  openIndependentCatalogSessions,
  type IndependentCatalogSession,
} from "./sessions";

export {
  CatalogCommitInjectedFailure,
  injectFailureAndRollback,
  type CatalogFailureKind,
} from "./failureInjection";

export {
  REHEARSAL_SQL_CHECKSUMS,
  assertLockedChecksum,
  loadParameterCatalogFixture,
  verifyRehearsalFixtureChecksums,
  type LoadedParameterCatalogFixture,
  type ParameterCatalogFixtureMode,
} from "./fixtureLoader";

export {
  knowledgeCatalogBundle,
  installKnowledgeDefinitionReferencesCatalogFixture,
} from "./registryProjection";
