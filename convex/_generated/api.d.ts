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
import type * as cutoverVerification from "../cutoverVerification.js";
import type * as effect_apiSports_client from "../effect/apiSports/client.js";
import type * as effect_apiSports_reliableFetch from "../effect/apiSports/reliableFetch.js";
import type * as effect_apiSports_schemas from "../effect/apiSports/schemas.js";
import type * as effect_errors from "../effect/errors.js";
import type * as effect_run from "../effect/run.js";
import type * as incidents from "../incidents.js";
import type * as invites from "../invites.js";
import type * as lib_abuseReportSanitize from "../lib/abuseReportSanitize.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_bootstrapAvailability from "../lib/bootstrapAvailability.js";
import type * as lib_cleanActivationPolicy from "../lib/cleanActivationPolicy.js";
import type * as lib_confidenceScale from "../lib/confidenceScale.js";
import type * as lib_confidenceScoring from "../lib/confidenceScoring.js";
import type * as lib_freshness from "../lib/freshness.js";
import type * as lib_identityClaims from "../lib/identityClaims.js";
import type * as lib_incidents from "../lib/incidents.js";
import type * as lib_inviteCrypto from "../lib/inviteCrypto.js";
import type * as lib_inviteDisclosure from "../lib/inviteDisclosure.js";
import type * as lib_inviteThrottle from "../lib/inviteThrottle.js";
import type * as lib_liveIngestionOperatorDetails from "../lib/liveIngestionOperatorDetails.js";
import type * as lib_liveIngestionWatchdog from "../lib/liveIngestionWatchdog.js";
import type * as lib_log from "../lib/log.js";
import type * as lib_membershipCutoff from "../lib/membershipCutoff.js";
import type * as lib_mintOrdinaryInvite from "../lib/mintOrdinaryInvite.js";
import type * as lib_myPoolsStatus from "../lib/myPoolsStatus.js";
import type * as lib_operator from "../lib/operator.js";
import type * as lib_operatorAuditInventory from "../lib/operatorAuditInventory.js";
import type * as lib_operatorAuth from "../lib/operatorAuth.js";
import type * as lib_pickLock from "../lib/pickLock.js";
import type * as lib_pinnedResultEvidence from "../lib/pinnedResultEvidence.js";
import type * as lib_poolArchive from "../lib/poolArchive.js";
import type * as lib_poolDescription from "../lib/poolDescription.js";
import type * as lib_poolEntries from "../lib/poolEntries.js";
import type * as lib_poolRules from "../lib/poolRules.js";
import type * as lib_providerBudget from "../lib/providerBudget.js";
import type * as lib_providerEvidencePolicy from "../lib/providerEvidencePolicy.js";
import type * as lib_providerQualificationCandidate from "../lib/providerQualificationCandidate.js";
import type * as lib_providerQualificationPolicy from "../lib/providerQualificationPolicy.js";
import type * as lib_providerReliabilityPolicy from "../lib/providerReliabilityPolicy.js";
import type * as lib_quotas from "../lib/quotas.js";
import type * as lib_scoringHolds from "../lib/scoringHolds.js";
import type * as lib_sentry from "../lib/sentry.js";
import type * as lib_survivorMessages from "../lib/survivorMessages.js";
import type * as lib_survivorScoring from "../lib/survivorScoring.js";
import type * as lib_syncGate from "../lib/syncGate.js";
import type * as lib_syncObservations from "../lib/syncObservations.js";
import type * as lib_verificationGate from "../lib/verificationGate.js";
import type * as liveIngestionWatchdog from "../liveIngestionWatchdog.js";
import type * as membershipAdmin from "../membershipAdmin.js";
import type * as operatorStepUp from "../operatorStepUp.js";
import type * as operatorStepUpInternal from "../operatorStepUpInternal.js";
import type * as participants from "../participants.js";
import type * as poolTemplates from "../poolTemplates.js";
import type * as pools from "../pools.js";
import type * as providerEvidence from "../providerEvidence.js";
import type * as providerQualification from "../providerQualification.js";
import type * as providerQualificationActions from "../providerQualificationActions.js";
import type * as providerReliability from "../providerReliability.js";
import type * as providers_apiSports_adapter from "../providers/apiSports/adapter.js";
import type * as providers_apiSports_index from "../providers/apiSports/index.js";
import type * as providers_apiSports_normalize from "../providers/apiSports/normalize.js";
import type * as providers_apiSports_testing_fixtures from "../providers/apiSports/testing/fixtures.js";
import type * as providers_sportsData_aliases from "../providers/sportsData/aliases.js";
import type * as providers_sportsData_catalog from "../providers/sportsData/catalog.js";
import type * as providers_sportsData_config from "../providers/sportsData/config.js";
import type * as providers_sportsData_correctionReconciliation from "../providers/sportsData/correctionReconciliation.js";
import type * as providers_sportsData_identity from "../providers/sportsData/identity.js";
import type * as providers_sportsData_identityStore from "../providers/sportsData/identityStore.js";
import type * as providers_sportsData_inMemory from "../providers/sportsData/inMemory.js";
import type * as providers_sportsData_index from "../providers/sportsData/index.js";
import type * as providers_sportsData_liveSyncPolicy from "../providers/sportsData/liveSyncPolicy.js";
import type * as providers_sportsData_reconciliation from "../providers/sportsData/reconciliation.js";
import type * as providers_sportsData_resultAuthority from "../providers/sportsData/resultAuthority.js";
import type * as providers_sportsData_scheduleSync from "../providers/sportsData/scheduleSync.js";
import type * as providers_sportsData_seasonBootstrap from "../providers/sportsData/seasonBootstrap.js";
import type * as providers_sportsData_seasonBootstrapValidation from "../providers/sportsData/seasonBootstrapValidation.js";
import type * as providers_sportsData_testing_contract from "../providers/sportsData/testing/contract.js";
import type * as providers_sportsData_testing_seasonBootstrapFixture from "../providers/sportsData/testing/seasonBootstrapFixture.js";
import type * as providers_sportsData_types from "../providers/sportsData/types.js";
import type * as resultOverrides from "../resultOverrides.js";
import type * as scoringHolds from "../scoringHolds.js";
import type * as seedDemo from "../seedDemo.js";
import type * as sentry from "../sentry.js";
import type * as survivorPicks from "../survivorPicks.js";
import type * as survivorScoring from "../survivorScoring.js";
import type * as sync from "../sync.js";
import type * as syncApiSportsLive from "../syncApiSportsLive.js";
import type * as syncLive from "../syncLive.js";
import type * as syncSchedule from "../syncSchedule.js";

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
  cutoverVerification: typeof cutoverVerification;
  "effect/apiSports/client": typeof effect_apiSports_client;
  "effect/apiSports/reliableFetch": typeof effect_apiSports_reliableFetch;
  "effect/apiSports/schemas": typeof effect_apiSports_schemas;
  "effect/errors": typeof effect_errors;
  "effect/run": typeof effect_run;
  incidents: typeof incidents;
  invites: typeof invites;
  "lib/abuseReportSanitize": typeof lib_abuseReportSanitize;
  "lib/auth": typeof lib_auth;
  "lib/bootstrapAvailability": typeof lib_bootstrapAvailability;
  "lib/cleanActivationPolicy": typeof lib_cleanActivationPolicy;
  "lib/confidenceScale": typeof lib_confidenceScale;
  "lib/confidenceScoring": typeof lib_confidenceScoring;
  "lib/freshness": typeof lib_freshness;
  "lib/identityClaims": typeof lib_identityClaims;
  "lib/incidents": typeof lib_incidents;
  "lib/inviteCrypto": typeof lib_inviteCrypto;
  "lib/inviteDisclosure": typeof lib_inviteDisclosure;
  "lib/inviteThrottle": typeof lib_inviteThrottle;
  "lib/liveIngestionOperatorDetails": typeof lib_liveIngestionOperatorDetails;
  "lib/liveIngestionWatchdog": typeof lib_liveIngestionWatchdog;
  "lib/log": typeof lib_log;
  "lib/membershipCutoff": typeof lib_membershipCutoff;
  "lib/mintOrdinaryInvite": typeof lib_mintOrdinaryInvite;
  "lib/myPoolsStatus": typeof lib_myPoolsStatus;
  "lib/operator": typeof lib_operator;
  "lib/operatorAuditInventory": typeof lib_operatorAuditInventory;
  "lib/operatorAuth": typeof lib_operatorAuth;
  "lib/pickLock": typeof lib_pickLock;
  "lib/pinnedResultEvidence": typeof lib_pinnedResultEvidence;
  "lib/poolArchive": typeof lib_poolArchive;
  "lib/poolDescription": typeof lib_poolDescription;
  "lib/poolEntries": typeof lib_poolEntries;
  "lib/poolRules": typeof lib_poolRules;
  "lib/providerBudget": typeof lib_providerBudget;
  "lib/providerEvidencePolicy": typeof lib_providerEvidencePolicy;
  "lib/providerQualificationCandidate": typeof lib_providerQualificationCandidate;
  "lib/providerQualificationPolicy": typeof lib_providerQualificationPolicy;
  "lib/providerReliabilityPolicy": typeof lib_providerReliabilityPolicy;
  "lib/quotas": typeof lib_quotas;
  "lib/scoringHolds": typeof lib_scoringHolds;
  "lib/sentry": typeof lib_sentry;
  "lib/survivorMessages": typeof lib_survivorMessages;
  "lib/survivorScoring": typeof lib_survivorScoring;
  "lib/syncGate": typeof lib_syncGate;
  "lib/syncObservations": typeof lib_syncObservations;
  "lib/verificationGate": typeof lib_verificationGate;
  liveIngestionWatchdog: typeof liveIngestionWatchdog;
  membershipAdmin: typeof membershipAdmin;
  operatorStepUp: typeof operatorStepUp;
  operatorStepUpInternal: typeof operatorStepUpInternal;
  participants: typeof participants;
  poolTemplates: typeof poolTemplates;
  pools: typeof pools;
  providerEvidence: typeof providerEvidence;
  providerQualification: typeof providerQualification;
  providerQualificationActions: typeof providerQualificationActions;
  providerReliability: typeof providerReliability;
  "providers/apiSports/adapter": typeof providers_apiSports_adapter;
  "providers/apiSports/index": typeof providers_apiSports_index;
  "providers/apiSports/normalize": typeof providers_apiSports_normalize;
  "providers/apiSports/testing/fixtures": typeof providers_apiSports_testing_fixtures;
  "providers/sportsData/aliases": typeof providers_sportsData_aliases;
  "providers/sportsData/catalog": typeof providers_sportsData_catalog;
  "providers/sportsData/config": typeof providers_sportsData_config;
  "providers/sportsData/correctionReconciliation": typeof providers_sportsData_correctionReconciliation;
  "providers/sportsData/identity": typeof providers_sportsData_identity;
  "providers/sportsData/identityStore": typeof providers_sportsData_identityStore;
  "providers/sportsData/inMemory": typeof providers_sportsData_inMemory;
  "providers/sportsData/index": typeof providers_sportsData_index;
  "providers/sportsData/liveSyncPolicy": typeof providers_sportsData_liveSyncPolicy;
  "providers/sportsData/reconciliation": typeof providers_sportsData_reconciliation;
  "providers/sportsData/resultAuthority": typeof providers_sportsData_resultAuthority;
  "providers/sportsData/scheduleSync": typeof providers_sportsData_scheduleSync;
  "providers/sportsData/seasonBootstrap": typeof providers_sportsData_seasonBootstrap;
  "providers/sportsData/seasonBootstrapValidation": typeof providers_sportsData_seasonBootstrapValidation;
  "providers/sportsData/testing/contract": typeof providers_sportsData_testing_contract;
  "providers/sportsData/testing/seasonBootstrapFixture": typeof providers_sportsData_testing_seasonBootstrapFixture;
  "providers/sportsData/types": typeof providers_sportsData_types;
  resultOverrides: typeof resultOverrides;
  scoringHolds: typeof scoringHolds;
  seedDemo: typeof seedDemo;
  sentry: typeof sentry;
  survivorPicks: typeof survivorPicks;
  survivorScoring: typeof survivorScoring;
  sync: typeof sync;
  syncApiSportsLive: typeof syncApiSportsLive;
  syncLive: typeof syncLive;
  syncSchedule: typeof syncSchedule;
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
