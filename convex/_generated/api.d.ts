/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as bootstrap from "../bootstrap.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bootstrapAvailability from "../lib/bootstrapAvailability.js";
import type * as lib_operator from "../lib/operator.js";
import type * as lib_syncGate from "../lib/syncGate.js";
import type * as lib_verificationGate from "../lib/verificationGate.js";
import type * as participants from "../participants.js";
import type * as providers_thesportsdb_adapter from "../providers/thesportsdb/adapter.js";
import type * as providers_thesportsdb_client from "../providers/thesportsdb/client.js";
import type * as sync from "../sync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  bootstrap: typeof bootstrap;
  "lib/auth": typeof lib_auth;
  "lib/bootstrapAvailability": typeof lib_bootstrapAvailability;
  "lib/operator": typeof lib_operator;
  "lib/syncGate": typeof lib_syncGate;
  "lib/verificationGate": typeof lib_verificationGate;
  participants: typeof participants;
  "providers/thesportsdb/adapter": typeof providers_thesportsdb_adapter;
  "providers/thesportsdb/client": typeof providers_thesportsdb_client;
  sync: typeof sync;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
