import { useAuthActions } from "@convex-dev/auth/react";
import { FlaskConical, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  getEmailPasswordSignInAvailable,
  getViktorSignInAvailable,
} from "@/lib/viktor-spaces-access/config";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";

const TEST_USER = {
  email: "agent-g8787y8m5ceo9wld@test.local",
  password: "T1NsdOCMHh46CvON6dTsGirx-zl73JWf",
  name: "Test Agent",
} as const;

/**
 * Whether the one-click test-user login renders here: preview deployments
 * show it via the build-time flag, and local servers (sandbox e2e,
 * `bun run dev`/`test`/`screenshot`) always show it — they run against the
 * dev Convex deployment where the test provider is registered, but their
 * build mirrors production with VITE_IS_PREVIEW=false. Without the local
 * override, a Viktor-only app would have no local sign-in path at all.
 */
export function testUserLoginOffered(
  isPreview = import.meta.env.VITE_IS_PREVIEW === "true",
  hostname = typeof window === "undefined" ? "" : window.location.hostname,
): boolean {
  return isPreview || ["localhost", "127.0.0.1"].includes(hostname);
}

export function TestUserLoginSection() {
  const { signIn } = useAuthActions();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!testUserLoginOffered()) {
    return null;
  }

  let emailPasswordAvailable = false;
  let viktorSignInAvailable = false;
  try {
    emailPasswordAvailable = getEmailPasswordSignInAvailable();
    viktorSignInAvailable = getViktorSignInAvailable();
  } catch {
    // The preview test provider remains a valid local escape hatch even if
    // an old or hand-edited provider list is invalid. Render no separator
    // because no product provider can be trusted to follow it.
  }

  const handleTestLogin = async () => {
    setError("");
    setLoading(true);

    const formData = new FormData();
    formData.set("email", TEST_USER.email);
    formData.set("password", TEST_USER.password);
    formData.set("flow", "signIn");

    try {
      await signIn("test", formData);
    } catch {
      formData.set("flow", "signUp");
      formData.set("name", TEST_USER.name);
      try {
        await signIn("test", formData);
      } catch {
        setError("Failed to sign in as test user. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="rounded-xl border-2 border-dashed border-warning/30 bg-warning/5 p-4">
        <div className="flex items-start gap-3">
          <div className="size-9 rounded-lg bg-warning flex items-center justify-center shrink-0">
            <FlaskConical className="size-4 text-warning-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Preview Mode</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Sign in instantly to explore the app
            </p>
          </div>
        </div>
        <Button
          onClick={handleTestLogin}
          disabled={loading}
          className="w-full mt-3 bg-warning text-warning-foreground hover:bg-warning/90"
        >
          {loading && <Loader2 className="size-4 animate-spin" />}
          {loading ? "Signing in..." : "Continue as Test User"}
        </Button>
        {error && (
          <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mt-3">
            {error}
          </p>
        )}
      </div>

      {/* Label the separator after what actually renders below the preview
          box. Viktor-only apps without the OAuth client config (local dev
          without a Viktor control plane) render nothing below it, so the
          separator is dropped entirely. */}
      {(emailPasswordAvailable || viktorSignInAvailable) && (
        <div className="relative py-4">
          <Separator />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-3 text-xs text-muted-foreground">
            {emailPasswordAvailable
              ? "or continue with email"
              : "or sign in with Viktor"}
          </span>
        </div>
      )}
    </>
  );
}
