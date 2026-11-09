import React from "react";

/**
 * Shows nothing if anything inside it fails to render.
 *
 * For optional extras (an announcement banner) whose data comes from a call that can fail, for example while a new backend function has not
 * been deployed yet: Convex's useQuery throws the failure during render, which would otherwise take the whole page down with it.
 */
export class QuietBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("A page extra failed and was hidden:", error instanceof Error ? error.message : error);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}
