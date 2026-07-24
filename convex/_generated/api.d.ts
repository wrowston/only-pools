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
import type * as confidencePicks from "../confidencePicks.js";
import type * as confidenceScoring from "../confidenceScoring.js";
import type * as crons from "../crons.js";
import type * as effect_errors from "../effect/errors.js";
import type * as effect_resend_client from "../effect/resend/client.js";
import type * as effect_resend_errors from "../effect/resend/errors.js";
import type * as effect_resend_schemas from "../effect/resend/schemas.js";
import type * as effect_run from "../effect/run.js";
import type * as effect_sportsdb_client from "../effect/sportsdb/client.js";
import type * as effect_sportsdb_schemas from "../effect/sportsdb/schemas.js";
import type * as helpDelivery from "../helpDelivery.js";
import type * as helpIntake from "../helpIntake.js";
import type * as helpPrompt from "../helpPrompt.js";
import type * as helpRetention from "../helpRetention.js";
import type * as http from "../http.js";
import type * as incidents from "../incidents.js";
import type * as invites from "../invites.js";
import type * as lib_abuseReportSanitize from "../lib/abuseReportSanitize.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bootstrapAvailability from "../lib/bootstrapAvailability.js";
import type * as lib_confidenceScale from "../lib/confidenceScale.js";
import type * as lib_confidenceScoring from "../lib/confidenceScoring.js";
import type * as lib_confirmationPolicy from "../lib/confirmationPolicy.js";
import type * as lib_freshness from "../lib/freshness.js";
import type * as lib_helpConfig from "../lib/helpConfig.js";
import type * as lib_helpConstants from "../lib/helpConstants.js";
import type * as lib_helpDeliveryPolicy from "../lib/helpDeliveryPolicy.js";
import type * as lib_helpReference from "../lib/helpReference.js";
import type * as lib_helpSanitize from "../lib/helpSanitize.js";
import type * as lib_helpThrottle from "../lib/helpThrottle.js";
import type * as lib_identityClaims from "../lib/identityClaims.js";
import type * as lib_incidents from "../lib/incidents.js";
import type * as lib_inviteCrypto from "../lib/inviteCrypto.js";
import type * as lib_inviteDisclosure from "../lib/inviteDisclosure.js";
import type * as lib_inviteThrottle from "../lib/inviteThrottle.js";
import type * as lib_log from "../lib/log.js";
import type * as lib_membershipCutoff from "../lib/membershipCutoff.js";
import type * as lib_mintOrdinaryInvite from "../lib/mintOrdinaryInvite.js";
import type * as lib_myPoolsStatus from "../lib/myPoolsStatus.js";
import type * as lib_operator from "../lib/operator.js";
import type * as lib_pickLock from "../lib/pickLock.js";
import type * as lib_poolArchive from "../lib/poolArchive.js";
import type * as lib_poolEntries from "../lib/poolEntries.js";
import type * as lib_poolRules from "../lib/poolRules.js";
import type * as lib_providerBudget from "../lib/providerBudget.js";
import type * as lib_quotas from "../lib/quotas.js";
import type * as lib_resendSink from "../lib/resendSink.js";
import type * as lib_sentry from "../lib/sentry.js";
import type * as lib_survivorMessages from "../lib/survivorMessages.js";
import type * as lib_survivorScoring from "../lib/survivorScoring.js";
import type * as lib_syncGate from "../lib/syncGate.js";
import type * as lib_syncObservations from "../lib/syncObservations.js";
import type * as lib_verificationGate from "../lib/verificationGate.js";
import type * as membershipAdmin from "../membershipAdmin.js";
import type * as participants from "../participants.js";
import type * as poolTemplates from "../poolTemplates.js";
import type * as pools from "../pools.js";
import type * as providers_thesportsdb_adapter from "../providers/thesportsdb/adapter.js";
import type * as providers_thesportsdb_client from "../providers/thesportsdb/client.js";
import type * as seedDemo from "../seedDemo.js";
import type * as sentry from "../sentry.js";
import type * as survivorPicks from "../survivorPicks.js";
import type * as survivorScoring from "../survivorScoring.js";
import type * as sync from "../sync.js";
import type * as syncLive from "../syncLive.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  bootstrap: typeof bootstrap;
  confidencePicks: typeof confidencePicks;
  confidenceScoring: typeof confidenceScoring;
  crons: typeof crons;
  "effect/errors": typeof effect_errors;
  "effect/resend/client": typeof effect_resend_client;
  "effect/resend/errors": typeof effect_resend_errors;
  "effect/resend/schemas": typeof effect_resend_schemas;
  "effect/run": typeof effect_run;
  "effect/sportsdb/client": typeof effect_sportsdb_client;
  "effect/sportsdb/schemas": typeof effect_sportsdb_schemas;
  helpDelivery: typeof helpDelivery;
  helpIntake: typeof helpIntake;
  helpPrompt: typeof helpPrompt;
  helpRetention: typeof helpRetention;
  http: typeof http;
  incidents: typeof incidents;
  invites: typeof invites;
  "lib/abuseReportSanitize": typeof lib_abuseReportSanitize;
  "lib/auth": typeof lib_auth;
  "lib/bootstrapAvailability": typeof lib_bootstrapAvailability;
  "lib/confidenceScale": typeof lib_confidenceScale;
  "lib/confidenceScoring": typeof lib_confidenceScoring;
  "lib/confirmationPolicy": typeof lib_confirmationPolicy;
  "lib/freshness": typeof lib_freshness;
  "lib/helpConfig": typeof lib_helpConfig;
  "lib/helpConstants": typeof lib_helpConstants;
  "lib/helpDeliveryPolicy": typeof lib_helpDeliveryPolicy;
  "lib/helpReference": typeof lib_helpReference;
  "lib/helpSanitize": typeof lib_helpSanitize;
  "lib/helpThrottle": typeof lib_helpThrottle;
  "lib/identityClaims": typeof lib_identityClaims;
  "lib/incidents": typeof lib_incidents;
  "lib/inviteCrypto": typeof lib_inviteCrypto;
  "lib/inviteDisclosure": typeof lib_inviteDisclosure;
  "lib/inviteThrottle": typeof lib_inviteThrottle;
  "lib/log": typeof lib_log;
  "lib/membershipCutoff": typeof lib_membershipCutoff;
  "lib/mintOrdinaryInvite": typeof lib_mintOrdinaryInvite;
  "lib/myPoolsStatus": typeof lib_myPoolsStatus;
  "lib/operator": typeof lib_operator;
  "lib/pickLock": typeof lib_pickLock;
  "lib/poolArchive": typeof lib_poolArchive;
  "lib/poolEntries": typeof lib_poolEntries;
  "lib/poolRules": typeof lib_poolRules;
  "lib/providerBudget": typeof lib_providerBudget;
  "lib/quotas": typeof lib_quotas;
  "lib/resendSink": typeof lib_resendSink;
  "lib/sentry": typeof lib_sentry;
  "lib/survivorMessages": typeof lib_survivorMessages;
  "lib/survivorScoring": typeof lib_survivorScoring;
  "lib/syncGate": typeof lib_syncGate;
  "lib/syncObservations": typeof lib_syncObservations;
  "lib/verificationGate": typeof lib_verificationGate;
  membershipAdmin: typeof membershipAdmin;
  participants: typeof participants;
  poolTemplates: typeof poolTemplates;
  pools: typeof pools;
  "providers/thesportsdb/adapter": typeof providers_thesportsdb_adapter;
  "providers/thesportsdb/client": typeof providers_thesportsdb_client;
  seedDemo: typeof seedDemo;
  sentry: typeof sentry;
  survivorPicks: typeof survivorPicks;
  survivorScoring: typeof survivorScoring;
  sync: typeof sync;
  syncLive: typeof syncLive;
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
