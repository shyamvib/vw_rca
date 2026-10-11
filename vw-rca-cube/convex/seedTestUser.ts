// PHI console redaction (active only on PHI deployments). This module does
// not import ./functions, so it needs the shim import directly.
import "./phiLogging";
import { createAccount, retrieveAccount } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const TEST_USER = {
  email: "agent-g8787y8m5ceo9wld@test.local",
  password: "T1NsdOCMHh46CvON6dTsGirx-zl73JWf",
  name: "Test Agent",
} as const;

export const seedTestUser = internalAction({
  args: {},
  returns: v.object({
    success: v.boolean(),
    message: v.string(),
  }),
  handler: async ctx => {
    try {
      await retrieveAccount(ctx, {
        provider: "test",
        account: { id: TEST_USER.email },
      });
      return { success: true, message: "Test user already exists" };
    } catch {
      // User doesn't exist, create them
    }

    try {
      // Pass the plaintext: createAccount hashes it via the "test" provider's
      // crypto (see testAuth.ts). Pre-hashing here double-hashes the secret,
      // leaving an account that retrieveAccount can never verify — sign-in
      // then dead-ends on "Account already exists".
      await createAccount(ctx, {
        provider: "test",
        account: {
          id: TEST_USER.email,
          secret: TEST_USER.password,
        },
        profile: {
          email: TEST_USER.email,
          name: TEST_USER.name,
          emailVerificationTime: Date.now(),
        },
        shouldLinkViaEmail: false,
      });
      return { success: true, message: "Test user created successfully" };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create test user: ${error}`,
      };
    }
  },
});
