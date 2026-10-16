import lockup from "@/assets/vibrant-lockup.svg?raw";

/**
 * Official Vibrant lockup (brandmark + wordmark) from the design system
 * (assets/vibrant-logo.svg), drawn in currentColor so `tone` picks ink or white.
 * Brand rule: the logo is only ever ink or white, never colored.
 */
export function Logo({ tone = "ink", height = 24, className }: { tone?: "ink" | "white"; height?: number; className?: string }) {
  return (
    <span
      role="img"
      aria-label="Vibrant"
      className={className}
      style={{ display: "inline-flex", color: tone === "white" ? "var(--vw-white)" : "var(--vw-ink)", height }}
      // The SVG is a bundled asset (never user input); the markup is fixed.
      dangerouslySetInnerHTML={{ __html: lockup.replace("<svg ", `<svg height="${height}" style="display:block" `) }}
    />
  );
}
