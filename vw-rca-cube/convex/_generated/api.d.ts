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
import type * as appState from "../appState.js";
import type * as auth from "../auth.js";
import type * as config from "../config.js";
import type * as constants from "../constants.js";
import type * as functions from "../functions.js";
import type * as gate from "../gate.js";
import type * as gated from "../gated.js";
import type * as http from "../http.js";
import type * as insights from "../insights.js";
import type * as ops from "../ops.js";
import type * as password from "../password.js";
import type * as phiConsoleStatics from "../phiConsoleStatics.js";
import type * as phiLogging from "../phiLogging.js";
import type * as plan from "../plan.js";
import type * as productGrowth from "../productGrowth.js";
import type * as repAuth from "../repAuth.js";
import type * as seedTestUser from "../seedTestUser.js";
import type * as testAuth from "../testAuth.js";
import type * as users from "../users.js";
import type * as viktorSpaceAuthConfig from "../viktorSpaceAuthConfig.js";
import type * as viktorSpaceAuthEnv from "../viktorSpaceAuthEnv.js";
import type * as viktorTools from "../viktorTools.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ViktorSpacesEmail: typeof ViktorSpacesEmail;
  access: typeof access;
  appState: typeof appState;
  auth: typeof auth;
  config: typeof config;
  constants: typeof constants;
  functions: typeof functions;
  gate: typeof gate;
  gated: typeof gated;
  http: typeof http;
  insights: typeof insights;
  ops: typeof ops;
  password: typeof password;
  phiConsoleStatics: typeof phiConsoleStatics;
  phiLogging: typeof phiLogging;
  plan: typeof plan;
  productGrowth: typeof productGrowth;
  repAuth: typeof repAuth;
  seedTestUser: typeof seedTestUser;
  testAuth: typeof testAuth;
  users: typeof users;
  viktorSpaceAuthConfig: typeof viktorSpaceAuthConfig;
  viktorSpaceAuthEnv: typeof viktorSpaceAuthEnv;
  viktorTools: typeof viktorTools;
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
