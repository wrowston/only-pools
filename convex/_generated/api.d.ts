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
import type * as invites from "../invites.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bootstrapAvailability from "../lib/bootstrapAvailability.js";
import type * as lib_inviteCrypto from "../lib/inviteCrypto.js";
import type * as lib_inviteThrottle from "../lib/inviteThrottle.js";
import type * as lib_membershipCutoff from "../lib/membershipCutoff.js";
import type * as lib_operator from "../lib/operator.js";
import type * as lib_pickLock from "../lib/pickLock.js";
import type * as lib_poolRules from "../lib/poolRules.js";
import type * as lib_syncGate from "../lib/syncGate.js";
import type * as lib_verificationGate from "../lib/verificationGate.js";
import type * as participants from "../participants.js";
import type * as pools from "../pools.js";
import type * as providers_thesportsdb_adapter from "../providers/thesportsdb/adapter.js";
import type * as providers_thesportsdb_client from "../providers/thesportsdb/client.js";
import type * as survivorPicks from "../survivorPicks.js";
import type * as sync from "../sync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  bootstrap: typeof bootstrap;
  invites: typeof invites;
  "lib/auth": typeof lib_auth;
  "lib/bootstrapAvailability": typeof lib_bootstrapAvailability;
  "lib/inviteCrypto": typeof lib_inviteCrypto;
  "lib/inviteThrottle": typeof lib_inviteThrottle;
  "lib/membershipCutoff": typeof lib_membershipCutoff;
  "lib/operator": typeof lib_operator;
  "lib/pickLock": typeof lib_pickLock;
  "lib/poolRules": typeof lib_poolRules;
  "lib/syncGate": typeof lib_syncGate;
  "lib/verificationGate": typeof lib_verificationGate;
  participants: typeof participants;
  pools: typeof pools;
  "providers/thesportsdb/adapter": typeof providers_thesportsdb_adapter;
  "providers/thesportsdb/client": typeof providers_thesportsdb_client;
  survivorPicks: typeof survivorPicks;
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
