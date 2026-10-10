import type { components } from "../../lib/api/schema";

type LastState = components["schemas"]["MonitorRead"]["last_state"];

interface PillStyle {
  label: string;
  className: string;
}

/**
 * Pure `last_state` → pill mapping. The pill is derived from `last_state`
 * only (last-writer-wins across the two engines); `check_config` is never
 * surfaced anywhere in the row.
 */
const PILL_STYLES: Record<string, PillStyle> = {
  healthy: { label: "Healthy", className: "border-success/30 bg-success-soft text-success" },
  unhealthy: { label: "Unhealthy", className: "border-danger/30 bg-danger-soft text-danger" },
};

const NEVER_CHECKED: PillStyle = {
  label: "Never checked",
  className: "border-line bg-raised text-muted",
};

export function StatusPill({ lastState }: { lastState: LastState }) {
  const style =
    (lastState !== null && PILL_STYLES[lastState]) || NEVER_CHECKED;
  const icon = style.label === "Healthy" ? "✓" : style.label === "Unhealthy" ? "×" : "?";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs font-semibold ${style.className}`}
    >
      <span aria-hidden="true">{icon}</span>
      {style.label}
    </span>
  );
}