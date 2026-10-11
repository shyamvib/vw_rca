import { ConvexProvider } from "convex/react";
import { Navigate, Route, Routes } from "react-router";
import { convex } from "@/auth/convexClient";
import { PasswordGate } from "@/pages/PasswordGate";
import { RcaDashboardPage } from "@/pages/RcaDashboardPage";

/**
 * The Space runs in public mode: the shared dashboard password is the only
 * barrier, enforced server-side on every Convex data function (convex/gated.ts).
 *
 * The public route tree has no ConvexProvider of its own, so it is added here.
 */
export function PublicAppRoutes() {
  return (
    <ConvexProvider client={convex}>
      <Routes>
        <Route
          path="/"
          element={
            <PasswordGate>
              <RcaDashboardPage />
            </PasswordGate>
          }
        />
        <Route
          path="/dashboard"
          element={
            <PasswordGate>
              <RcaDashboardPage />
            </PasswordGate>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConvexProvider>
  );
}
