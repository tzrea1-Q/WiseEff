import {
  dropLabRuntimeLogins as dropLab,
  provisionPublicationRuntimeLogins as provision,
} from "../modules/catalog-publication/runtime/provisionRuntimeLogins";
import { withTestClusterRoleCatalogLock } from "./testDatabase";

export * from "../modules/catalog-publication/runtime/provisionRuntimeLogins";

/** Lab role membership writes share the postgres lease with migration observations. */
export const provisionPublicationRuntimeLogins: typeof provision = (url, input) =>
  input?.mode === "lab"
    ? withTestClusterRoleCatalogLock(() => provision(url, input))
    : provision(url, input);

export const dropLabRuntimeLogins: typeof dropLab = (url, token) =>
  withTestClusterRoleCatalogLock(() => dropLab(url, token));
