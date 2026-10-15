/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ViktorSpacesEmail from "../ViktorSpacesEmail.js";
import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as bridge from "../bridge.js";
import type * as clinicalTouch from "../clinicalTouch.js";
import type * as clinics from "../clinics.js";
import type * as config from "../config.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as cube from "../cube.js";
import type * as dateUtils from "../dateUtils.js";
import type * as diag from "../diag.js";
import type * as families from "../families.js";
import type * as familyStops from "../familyStops.js";
import type * as feed from "../feed.js";
import type * as flags from "../flags.js";
import type * as functions from "../functions.js";
import type * as gate from "../gate.js";
import type * as gated from "../gated.js";
import type * as geo from "../geo.js";
import type * as geoKey from "../geoKey.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as insights from "../insights.js";
import type * as leadFamilies from "../leadFamilies.js";
import type * as newClinicFunnel from "../newClinicFunnel.js";
import type * as newClinicTouches from "../newClinicTouches.js";
import type * as newPace from "../newPace.js";
import type * as password from "../password.js";
import type * as phiConsoleStatics from "../phiConsoleStatics.js";
import type * as phiLogging from "../phiLogging.js";
import type * as plan from "../plan.js";
import type * as powerbi from "../powerbi.js";
import type * as productGrowth from "../productGrowth.js";
import type * as projection from "../projection.js";
import type * as refresh from "../refresh.js";
import type * as repAuth from "../repAuth.js";
import type * as repCacheProbe from "../repCacheProbe.js";
import type * as repView from "../repView.js";
import type * as seedTestUser from "../seedTestUser.js";
import type * as testAuth from "../testAuth.js";
import type * as topDown from "../topDown.js";
import type * as users from "../users.js";
import type * as va from "../va.js";
import type * as viktorSpaceAuthConfig from "../viktorSpaceAuthConfig.js";
import type * as viktorSpaceAuthEnv from "../viktorSpaceAuthEnv.js";
import type * as viktorTools from "../viktorTools.js";
import type * as wins from "../wins.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ViktorSpacesEmail: typeof ViktorSpacesEmail;
  access: typeof access;
  auth: typeof auth;
  bridge: typeof bridge;
  clinicalTouch: typeof clinicalTouch;
  clinics: typeof clinics;
  config: typeof config;
  constants: typeof constants;
  crons: typeof crons;
  cube: typeof cube;
  dateUtils: typeof dateUtils;
  diag: typeof diag;
  families: typeof families;
  familyStops: typeof familyStops;
  feed: typeof feed;
  flags: typeof flags;
  functions: typeof functions;
  gate: typeof gate;
  gated: typeof gated;
  geo: typeof geo;
  geoKey: typeof geoKey;
  http: typeof http;
  ingest: typeof ingest;
  insights: typeof insights;
  leadFamilies: typeof leadFamilies;
  newClinicFunnel: typeof newClinicFunnel;
  newClinicTouches: typeof newClinicTouches;
  newPace: typeof newPace;
  password: typeof password;
  phiConsoleStatics: typeof phiConsoleStatics;
  phiLogging: typeof phiLogging;
  plan: typeof plan;
  powerbi: typeof powerbi;
  productGrowth: typeof productGrowth;
  projection: typeof projection;
  refresh: typeof refresh;
  repAuth: typeof repAuth;
  repCacheProbe: typeof repCacheProbe;
  repView: typeof repView;
  seedTestUser: typeof seedTestUser;
  testAuth: typeof testAuth;
  topDown: typeof topDown;
  users: typeof users;
  va: typeof va;
  viktorSpaceAuthConfig: typeof viktorSpaceAuthConfig;
  viktorSpaceAuthEnv: typeof viktorSpaceAuthEnv;
  viktorTools: typeof viktorTools;
  wins: typeof wins;
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
