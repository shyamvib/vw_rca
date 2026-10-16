/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as bridge from "../bridge.js";
import type * as clinicalTouch from "../clinicalTouch.js";
import type * as clinics from "../clinics.js";
import type * as config from "../config.js";
import type * as cube from "../cube.js";
import type * as dateUtils from "../dateUtils.js";
import type * as families from "../families.js";
import type * as familyLaunch from "../familyLaunch.js";
import type * as familyStops from "../familyStops.js";
import type * as feed from "../feed.js";
import type * as flags from "../flags.js";
import type * as gated from "../gated.js";
import type * as geo from "../geo.js";
import type * as geoKey from "../geoKey.js";
import type * as ingest from "../ingest.js";
import type * as insights from "../insights.js";
import type * as leadFamilies from "../leadFamilies.js";
import type * as newClinicFunnel from "../newClinicFunnel.js";
import type * as newClinicTouches from "../newClinicTouches.js";
import type * as newPace from "../newPace.js";
import type * as password from "../password.js";
import type * as plan from "../plan.js";
import type * as powerbi from "../powerbi.js";
import type * as productGrowth from "../productGrowth.js";
import type * as projection from "../projection.js";
import type * as refresh from "../refresh.js";
import type * as repAuth from "../repAuth.js";
import type * as repView from "../repView.js";
import type * as topDown from "../topDown.js";
import type * as va from "../va.js";
import type * as wins from "../wins.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  bridge: typeof bridge;
  clinicalTouch: typeof clinicalTouch;
  clinics: typeof clinics;
  config: typeof config;
  cube: typeof cube;
  dateUtils: typeof dateUtils;
  families: typeof families;
  familyLaunch: typeof familyLaunch;
  familyStops: typeof familyStops;
  feed: typeof feed;
  flags: typeof flags;
  gated: typeof gated;
  geo: typeof geo;
  geoKey: typeof geoKey;
  ingest: typeof ingest;
  insights: typeof insights;
  leadFamilies: typeof leadFamilies;
  newClinicFunnel: typeof newClinicFunnel;
  newClinicTouches: typeof newClinicTouches;
  newPace: typeof newPace;
  password: typeof password;
  plan: typeof plan;
  powerbi: typeof powerbi;
  productGrowth: typeof productGrowth;
  projection: typeof projection;
  refresh: typeof refresh;
  repAuth: typeof repAuth;
  repView: typeof repView;
  topDown: typeof topDown;
  va: typeof va;
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
